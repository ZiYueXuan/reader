"""请求与响应的数据形状。

字段名统一 camelCase，与前端 TypeScript 类型一一对应。

``percent`` 一律是 0–1 的小数（不是 0–100），展示时由前端乘 100。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class TocNode(BaseModel):
    title: str
    chapter: int = 0
    offset: int = 0
    children: list["TocNode"] = Field(default_factory=list)


class BookSummary(BaseModel):
    """书架列表项。"""

    id: str
    title: str
    author: str | None = None
    language: str | None = None
    chapterCount: int | None = None
    fileSize: int | None = None
    percent: float = 0.0
    coverUrl: str | None = None
    createdAt: str
    updatedAt: str


class BookDetail(BookSummary):
    """单书详情，多出目录与出版信息。"""

    publisher: str | None = None
    identifier: str | None = None
    toc: list[TocNode] = Field(default_factory=list)


class BookUpdate(BaseModel):
    """前端解析完 EPUB 后回传的缓存信息。字段都可缺省。"""

    title: str | None = Field(default=None, min_length=1, max_length=512)
    chapterCount: int | None = Field(default=None, ge=0)
    toc: list[TocNode] | None = None


class ProgressIn(BaseModel):
    chapter: int = Field(ge=0)
    charOffset: int = Field(ge=0)
    percent: float = Field(default=0.0, ge=0.0, le=1.0)


class ProgressOut(ProgressIn):
    updatedAt: str
