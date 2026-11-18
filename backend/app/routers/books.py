"""书籍入库与书架接口。

设计要点：
- 重复上传按 ``file_hash`` 幂等，返回已有条目（HTTP 200 而不是 201）；
- 所有文件路径都由服务端 id 拼出，客户端传入的 id 必须过正则；
- 元数据解析失败时删掉刚落盘的文件，不留垃圾。
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_token
from ..models import Book, ReadingProgress, now_iso
from ..schemas import BookDetail, BookSummary, BookUpdate, TocNode
from ..services import epub_meta, storage

router = APIRouter(tags=["books"], dependencies=[Depends(require_token)])

MEDIA_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}


# --------------------------------------------------------------------------- #
# 映射
# --------------------------------------------------------------------------- #
def _clip(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    return value[:limit]


def _cover_url(book: Book) -> str | None:
    return f"/api/books/{book.id}/cover" if book.cover_path else None


def _summary(book: Book, percent: float) -> BookSummary:
    return BookSummary(
        id=book.id,
        title=book.title,
        author=book.author,
        language=book.language,
        chapterCount=book.chapter_count,
        fileSize=book.file_size,
        percent=round(percent, 4),
        coverUrl=_cover_url(book),
        createdAt=book.created_at,
        updatedAt=book.updated_at,
    )


def _detail(book: Book, percent: float) -> BookDetail:
    toc: list[TocNode] = []
    if book.toc_json:
        try:
            toc = [TocNode.model_validate(node) for node in json.loads(book.toc_json)]
        except (ValueError, TypeError):
            toc = []
    return BookDetail(
        **_summary(book, percent).model_dump(),
        publisher=book.publisher,
        identifier=book.identifier,
        toc=toc,
    )


def _percent_of(db: Session, book_id: str) -> float:
    row = db.get(ReadingProgress, book_id)
    return row.percent if row else 0.0


def _load_book(db: Session, book_id: str) -> Book:
    book = db.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="这本书不在书架上")
    return book


def _saved_path(book: Book) -> Path:
    path = storage.book_file(book.id)
    if not path.exists():
        raise HTTPException(status_code=410, detail="书籍文件已丢失，请重新导入")
    return path


# --------------------------------------------------------------------------- #
# 路由
# --------------------------------------------------------------------------- #
@router.get("/books", response_model=list[BookSummary])
def list_books(db: Session = Depends(get_db)) -> list[BookSummary]:
    rows = db.execute(
        select(Book, ReadingProgress.percent)
        .outerjoin(ReadingProgress, ReadingProgress.book_id == Book.id)
        .order_by(Book.created_at.desc())
    ).all()
    return [_summary(book, percent or 0.0) for book, percent in rows]


@router.post("/books", response_model=BookDetail)
async def upload_book(
        response: Response,
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
) -> BookDetail:
    if not file.filename:
        raise HTTPException(status_code=422, detail="缺少文件名")

    try:
        tmp, digest, size = await storage.spool(file)
    except storage.UploadError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    finally:
        await file.close()

    existing = db.scalar(select(Book).where(Book.file_hash == digest))
    if existing is not None:
        storage.discard(tmp)
        response.status_code = status.HTTP_200_OK
        return _detail(existing, _percent_of(db, existing.id))

    book_id = storage.new_id()
    target = storage.install(tmp, book_id)
    try:
        meta = epub_meta.read_metadata(target)
    except epub_meta.EpubError as exc:
        storage.remove_book_files(book_id)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    cover_path: str | None = None
    if meta.cover is not None:
        cover_file = storage.cover_file(book_id, meta.cover.ext)
        cover_file.write_bytes(meta.cover.data)
        cover_path = f"covers/{cover_file.name}"

    book = Book(
        id=book_id,
        title=_clip(meta.title, 512) or "未命名",
        author=_clip(meta.author, 512),
        publisher=_clip(meta.publisher, 512),
        language=_clip(meta.language, 32),
        identifier=_clip(meta.identifier, 255),
        file_path=f"books/{book_id}/book.epub",
        file_size=size,
        file_hash=digest,
        cover_path=cover_path,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    db.add(book)
    db.commit()
    db.refresh(book)

    response.status_code = status.HTTP_201_CREATED
    return _detail(book, 0.0)


@router.get("/books/{book_id}", response_model=BookDetail)
def get_book(book_id: str, db: Session = Depends(get_db)) -> BookDetail:
    book = _load_book(db, book_id)
    return _detail(book, _percent_of(db, book_id))


@router.patch("/books/{book_id}", response_model=BookDetail)
def update_book(
        book_id: str, payload: BookUpdate, db: Session = Depends(get_db)
) -> BookDetail:
    book = _load_book(db, book_id)
    if payload.title is not None:
        book.title = payload.title
    if payload.chapterCount is not None:
        book.chapter_count = payload.chapterCount
    if payload.toc is not None:
        book.toc_json = json.dumps(
            [node.model_dump() for node in payload.toc], ensure_ascii=False
        )
    db.commit()
    db.refresh(book)
    return _detail(book, _percent_of(db, book_id))


@router.delete("/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: str, db: Session = Depends(get_db)) -> Response:
    book = db.get(Book, book_id)
    if book is not None:
        db.delete(book)
        db.commit()
    storage.remove_book_files(book_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/books/{book_id}/file", response_class=FileResponse)
def download_book(book_id: str, db: Session = Depends(get_db)) -> FileResponse:
    book = _load_book(db, book_id)
    path = _saved_path(book)
    return FileResponse(
        path,
        media_type="application/epub+zip",
        filename=f"{book.title}.epub",
    )


@router.get("/books/{book_id}/cover", response_class=FileResponse)
def book_cover(book_id: str, db: Session = Depends(get_db)) -> FileResponse:
    book = _load_book(db, book_id)
    cover = storage.existing_cover(book.id)
    if cover is None or not cover.exists():
        raise HTTPException(status_code=404, detail="这本书没有封面")
    media_type = MEDIA_BY_EXT.get(cover.suffix.lower(), "application/octet-stream")
    return FileResponse(
        cover,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )
