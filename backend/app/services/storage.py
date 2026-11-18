"""书籍文件落盘：临时文件、sha256 去重、目录安全。

约定：每本书独占 ``data/books/{id}/book.epub``，封面在 ``data/covers/{id}.{ext}``。
``id`` 由本模块生成，服务端从不接受客户端传入的路径片段。
"""

from __future__ import annotations

import hashlib
import re
import secrets
import shutil
import tempfile
from pathlib import Path
from typing import Protocol

from ..config import settings

CHUNK = 1 << 20
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,32}$")
TMP_PREFIX = "upload-"


class UploadError(ValueError):
    """上传过程中的业务错误，路由层转成 4xx。"""


class AsyncReader(Protocol):
    async def read(self, size: int) -> bytes: ...


def new_id() -> str:
    return secrets.token_urlsafe(12)


def is_valid_id(book_id: str) -> bool:
    return bool(ID_RE.match(book_id))


def book_dir(book_id: str) -> Path:
    if not is_valid_id(book_id):
        raise UploadError(f"非法的书籍 id: {book_id!r}")
    return settings.books_dir / book_id


def book_file(book_id: str) -> Path:
    return book_dir(book_id) / "book.epub"


def cover_file(book_id: str, ext: str) -> Path:
    return settings.covers_dir / f"{book_id}{ext}"


def existing_cover(book_id: str) -> Path | None:
    if not is_valid_id(book_id):
        return None
    for candidate in settings.covers_dir.glob(f"{book_id}.*"):
        return candidate
    return None


async def spool(upload: AsyncReader) -> tuple[Path, str, int]:
    """把上传流写入临时文件，同时算 sha256 与大小。

    返回 ``(临时文件路径, sha256, 字节数)``，调用方负责后续移动或删除。
    """
    settings.ensure_dirs()
    fd, name = tempfile.mkstemp(dir=settings.data_dir, prefix=TMP_PREFIX)
    tmp = Path(name)
    digest = hashlib.sha256()
    size = 0

    try:
        with open(fd, "wb") as fh:
            while True:
                chunk = await upload.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise UploadError(
                        f"文件超过 {MAX_UPLOAD_BYTES // (1024 * 1024)} MB 上限"
                    )
                digest.update(chunk)
                fh.write(chunk)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    if size == 0:
        tmp.unlink(missing_ok=True)
        raise UploadError("上传的文件是空的")

    return tmp, digest.hexdigest(), size


def install(tmp: Path, book_id: str) -> Path:
    """把临时文件移动到书籍目录。"""
    target_dir = book_dir(book_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "book.epub"
    shutil.move(str(tmp), target)
    return target


def discard(tmp: Path) -> None:
    tmp.unlink(missing_ok=True)


def remove_book_files(book_id: str) -> None:
    """删除书目录与封面，幂等。"""
    if not is_valid_id(book_id):
        return
    shutil.rmtree(settings.books_dir / book_id, ignore_errors=True)
    for cover in settings.covers_dir.glob(f"{book_id}.*"):
        cover.unlink(missing_ok=True)


def cleanup_stale_temps() -> None:
    """启动时清掉上次异常退出遗留的临时上传文件。"""
    settings.ensure_dirs()
    for stale in settings.data_dir.glob(f"{TMP_PREFIX}*"):
        if stale.is_file():
            stale.unlink(missing_ok=True)
