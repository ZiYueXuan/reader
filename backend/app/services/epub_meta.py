"""用标准库读 EPUB 元数据与封面，不引入第三方解析器。

解析链路：``META-INF/container.xml`` → ``.opf`` → Dublin Core 元数据 + 清单里的封面项。
任何结构缺失都抛 :class:`EpubError`，由路由层转成 422。
"""

from __future__ import annotations

import posixpath
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

CONTAINER_PATH = "META-INF/container.xml"
DC_FIELDS = ("title", "creator", "publisher", "language", "identifier")

EXT_BY_MEDIA = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
}


class EpubError(ValueError):
    """不是可用的 EPUB，或缺少必要结构。"""


@dataclass(slots=True)
class Cover:
    data: bytes
    media_type: str
    ext: str


@dataclass(slots=True)
class EpubMeta:
    title: str
    author: str | None = None
    publisher: str | None = None
    language: str | None = None
    identifier: str | None = None
    cover: Cover | None = None
    extras: dict[str, str] = field(default_factory=dict)


def _local(tag: str) -> str:
    """去掉 ``{namespace}`` 前缀，只留本地名。"""
    return tag.rsplit("}", 1)[-1].lower()


def _parse_xml(blob: bytes, what: str) -> ET.Element:
    try:
        return ET.fromstring(blob)
    except ET.ParseError as exc:
        raise EpubError(f"{what} 不是合法的 XML：{exc}") from exc


def _text_of(element: ET.Element | None) -> str | None:
    if element is None or element.text is None:
        return None
    value = " ".join(element.text.split())
    return value or None


def _find_descendant(element: ET.Element, name: str) -> ET.Element | None:
    for node in element.iter():
        if _local(node.tag) == name:
            return node
    return None


def _read_container(zf: zipfile.ZipFile) -> str:
    try:
        blob = zf.read(CONTAINER_PATH)
    except KeyError as exc:
        raise EpubError("缺少 META-INF/container.xml，不是 EPUB 文件") from exc
    root = _parse_xml(blob, "container.xml")
    for node in root.iter():
        if _local(node.tag) == "rootfile":
            full_path = (node.get("full-path") or "").strip()
            if full_path:
                return full_path
    raise EpubError("container.xml 里没有 rootfile，不是 EPUB 文件")


def _resolve(directory: str, href: str) -> str:
    href = unquote(href.split("#", 1)[0]).strip()
    joined = posixpath.normpath(posixpath.join(directory, href))
    return joined.lstrip("/")


def _pick_cover(
        manifest: dict[str, dict[str, str]], metas: list[ET.Element], opf_dir: str
) -> tuple[str, str] | None:
    """返回 ``(zip 内路径, media-type)``。"""
    for item in manifest.values():
        if "cover-image" in (item.get("properties") or "").split():
            return _resolve(opf_dir, item.get("href", "")), item.get("media-type", "")

    declared_id = None
    for meta in metas:
        if (meta.get("name") or "").lower() == "cover":
            declared_id = meta.get("content")
            break
    if declared_id and declared_id in manifest:
        item = manifest[declared_id]
        return _resolve(opf_dir, item.get("href", "")), item.get("media-type", "")

    for item in manifest.values():
        media = (item.get("media-type") or "").lower()
        item_id = (item.get("id") or "").lower()
        if media.startswith("image/") and ("cover" in item_id or "cover" in item.get("href", "").lower()):
            return _resolve(opf_dir, item.get("href", "")), media
    return None


def read_metadata(path: Path) -> EpubMeta:
    if not path.exists():
        raise EpubError("书籍文件不存在")

    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            if not names:
                raise EpubError("压缩包是空的")

            if "mimetype" in names:
                declared = zf.read("mimetype").decode("ascii", "ignore").strip()
                if declared and declared != "application/epub+zip":
                    raise EpubError(f"mimetype 不是 application/epub+zip，而是 {declared!r}")

            opf_path = _read_container(zf)
            if opf_path not in names:
                raise EpubError(f"OPF 文件 {opf_path} 不在压缩包里")
            opf = _parse_xml(zf.read(opf_path), "OPF")
            opf_dir = posixpath.dirname(opf_path)

            metadata = _find_descendant(opf, "metadata")
            if metadata is None:
                raise EpubError("OPF 里没有 metadata")

            found: dict[str, str] = {}
            metas: list[ET.Element] = []
            manifest: dict[str, dict[str, str]] = {}
            for node in metadata.iter():
                name = _local(node.tag)
                if name in DC_FIELDS and name not in found:
                    value = _text_of(node)
                    if value:
                        found[name] = value
                elif name == "meta":
                    metas.append(node)

            for node in opf.iter():
                if _local(node.tag) != "item":
                    continue
                item_id = node.get("id")
                if item_id:
                    manifest[item_id] = {
                        "href": node.get("href") or "",
                        "media-type": node.get("media-type") or "",
                        "properties": node.get("properties") or "",
                    }

            title = found.get("title") or path.stem
            meta = EpubMeta(
                title=title,
                author=found.get("creator"),
                publisher=found.get("publisher"),
                language=found.get("language"),
                identifier=found.get("identifier"),
            )

            picked = _pick_cover(manifest, metas, opf_dir)
            if picked:
                cover_path, media_type = picked
                media_type = media_type.lower()
                ext = EXT_BY_MEDIA.get(media_type)
                if cover_path and ext and cover_path in names:
                    meta.cover = Cover(
                        data=zf.read(cover_path), media_type=media_type, ext=ext
                    )
            return meta
    except zipfile.BadZipFile as exc:
        raise EpubError("不是合法的 ZIP/EPUB 文件") from exc
    except OSError as exc:
        raise EpubError(f"读取书籍文件失败：{exc}") from exc
