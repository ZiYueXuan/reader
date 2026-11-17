"""数据表定义。字段语义见 design/02-architecture.md 第五节。

时间统一存 ISO 8601 UTC 字符串，避免 SQLite 的时区歧义。
"""

from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Book(Base):
    __tablename__ = "books"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    author: Mapped[str | None] = mapped_column(String(512))
    publisher: Mapped[str | None] = mapped_column(String(512))
    language: Mapped[str | None] = mapped_column(String(32))
    identifier: Mapped[str | None] = mapped_column(String(255))

    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    cover_path: Mapped[str | None] = mapped_column(String(1024))

    toc_json: Mapped[str | None] = mapped_column(Text)
    chapter_count: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[str] = mapped_column(String(32), default=now_iso, nullable=False)
    updated_at: Mapped[str] = mapped_column(
        String(32), default=now_iso, onupdate=now_iso, nullable=False
    )


class ReadingProgress(Base):
    __tablename__ = "reading_progress"

    book_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("books.id", ondelete="CASCADE"), primary_key=True
    )
    chapter: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    char_offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    percent: Mapped[float] = mapped_column(nullable=False, default=0.0)
    updated_at: Mapped[str] = mapped_column(
        String(32), default=now_iso, onupdate=now_iso, nullable=False
    )


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    book_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # highlight | underline | note
    color: Mapped[str | None] = mapped_column(String(16))

    chapter: Mapped[int] = mapped_column(Integer, nullable=False)
    start_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    end_offset: Mapped[int] = mapped_column(Integer, nullable=False)

    quote: Mapped[str | None] = mapped_column(Text)
    note_json: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(String(32), default=now_iso, nullable=False)
    updated_at: Mapped[str] = mapped_column(
        String(32), default=now_iso, onupdate=now_iso, nullable=False
    )

    __table_args__ = (
        Index("idx_ann_book", "book_id", "chapter", "start_offset"),
    )
