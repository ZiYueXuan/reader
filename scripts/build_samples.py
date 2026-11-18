#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""构建公版示例书。

用两份公版文本源生成可直接导入本阅读器的 EPUB：

* 《呐喊》—— 鲁迅（1938 年全集版，维基文库校对文本，服务端转简体）
  https://zh.wikisource.org/wiki/吶喊
* Alice's Adventures in Wonderland —— Lewis Carroll（Standard Ebooks 校订本）
  https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland

用法::

    .\\.venv\\Scripts\\python.exe scripts\\build_samples.py --report   # 只看解析统计
    .\\.venv\\Scripts\\python.exe scripts\\build_samples.py            # 生成 samples/*.epub

原始文本与插图会缓存在 .cache/samples/ 下，重复运行不会重复下载。
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

import sys
import time

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "samples"
SAMPLES = ROOT / "samples"

UA = {
    "User-Agent": "reader-sample-builder/1.0 (local offline build of public domain texts)"
}

WIKI = "https://api.wikimedia.org/core/v1/wikisource/zh/page/"
SE_BASE = (
    "https://raw.githubusercontent.com/standardebooks/"
    "lewis-carroll_alices-adventures-in-wonderland/master/src/epub/"
)

# 《呐喊》篇目：slug, 维基文库页面标题（繁体）, 展示用简体标题
NAHAN = [
    ("kuangren", "狂人日記", "狂人日记"),
    ("kongyiji", "孔乙己", "孔乙己"),
    ("yao", "藥", "药"),
    ("mingtian", "明天", "明天"),
    ("yijianxiaoshi", "一件小事", "一件小事"),
    ("toufa", "頭髮的故事", "头发的故事"),
    ("fengbo", "風波", "风波"),
    ("guxiang", "故鄉", "故乡"),
    ("aq", "阿Q正傳", "阿Q正传"),
    ("duanwu", "端午節", "端午节"),
    ("baiguang", "白光", "白光"),
    ("tuhemo", "兔和貓", "兔和猫"),
    ("yahexiju", "鴨的喜劇", "鸭的喜剧"),
    ("shexi", "社戲", "社戏"),
]


# --------------------------------------------------------------------------- #
# 网络
# --------------------------------------------------------------------------- #
def fetch(url: str, headers: dict | None = None, retries: int = 3) -> bytes:
    """带磁盘缓存与重试的 GET。缓存键 = URL 的 sha1。"""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(url.encode("utf-8")).hexdigest()
    path = CACHE / key
    if path.exists() and path.stat().st_size > 0:
        return path.read_bytes()

    hdrs = dict(UA)
    if headers:
        hdrs.update(headers)
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = resp.read()
            path.write_bytes(data)
            return data
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"下载失败: {url}") from last


def fetch_text(url: str, headers: dict | None = None) -> str:
    return fetch(url, headers).decode("utf-8", "replace")


# --------------------------------------------------------------------------- #
# HTML → 块级内容
# --------------------------------------------------------------------------- #
@dataclass
class Block:
    kind: str  # h1 h2 p blockquote img figcaption
    text: str = ""
    src: str = ""


SKIP_TAGS = {"style", "script", "table", "nav", "aside", "head", "link", "meta", "noscript"}
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
SKIP_IDS = {"headerContainer", "mw-navigation", "footer"}
SKIP_CLASS = {
    "licenseContainer", "mw-references-wrap", "navbox", "noprint", "pagenum",
    "ws-pagenum", "sisitem", "ws-noexport", "mw-editsection", "mw-empty-elt",
}
HEADINGS = {"h1": "h1", "h2": "h2", "h3": "h3", "h4": "h2", "h5": "h2", "h6": "h2"}


class BlockExtractor(HTMLParser):
    """把 XHTML/HTML 摊平成块级序列。

    Block.text 是纯文本：em/strong 等行内强调只保留文字，不写入标签，
    否则会被 esc() 转义成字面 “<em>…</em>” 漏进正文（渲染时可见）。
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[Block] = []
        self._skip = 0
        self._cur: Block | None = None
        self._buf: list[str] = []
        self._in_quote = 0

    # -- 内部 -- #
    def _flush(self) -> None:
        if self._cur is None:
            return
        text = "".join(self._buf)
        text = re.sub(r"[ \t\u00a0\u3000]*\n[ \t\u00a0\u3000]*", "\n", text)
        text = re.sub(r"[ \t\u00a0\u3000]{2,}", " ", text).strip()
        if text or self._cur.kind == "img":
            self.blocks.append(Block(self._cur.kind, text, self._cur.src))
        self._cur = None
        self._buf = []

    def _open(self, kind: str) -> None:
        self._flush()
        self._cur = Block(kind)

    # -- HTMLParser 回调 -- #
    def handle_starttag(self, tag: str, attrs_list) -> None:
        attrs = {k: (v or "") for k, v in attrs_list}
        if self._skip:
            # 自闭合标签没有对应的结束标签，不能计入跳过深度
            if tag not in VOID_TAGS:
                self._skip += 1
            return
        if (
                tag in SKIP_TAGS
                or attrs.get("id", "") in SKIP_IDS
                or any(c in SKIP_CLASS for c in attrs.get("class", "").split())
        ):
            self._skip = 1
            return
        self._on_open_tag(tag, attrs)

    def handle_startendtag(self, tag: str, attrs_list) -> None:
        if self._skip or tag in SKIP_TAGS:
            return
        self._on_open_tag(tag, {k: (v or "") for k, v in attrs_list})

    def _on_open_tag(self, tag: str, attrs: dict) -> None:
        if tag in HEADINGS:
            self._open(HEADINGS[tag])
        elif tag == "p":
            if attrs.get("epub:type") == "title":
                self._open("h2")
            elif self._in_quote:
                self._open("blockquote")
            else:
                self._open("p")
        elif tag == "blockquote":
            self._in_quote += 1
        elif tag == "img":
            src = attrs.get("src", "")
            if src:
                self._flush()
                self.blocks.append(Block("img", src=src))
        elif tag == "figcaption":
            self._open("figcaption")
        elif tag == "br":
            if self._cur is not None:
                self._buf.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self._skip:
            self._skip -= 1
            return
        if tag in HEADINGS or tag in ("p", "figcaption"):
            self._flush()
        elif tag == "blockquote":
            self._in_quote = max(0, self._in_quote - 1)

    def handle_data(self, data: str) -> None:
        if self._skip or self._cur is None:
            return
        self._buf.append(data)

    def close(self) -> None:
        super().close()
        self._flush()


NAV_NOISE = re.compile(
    r"^(←|→|姊妹计划|本作品收錄於|本作品收录于|Public domain|この作品|作者[:：])"
)
EXT_RE = re.compile(r"^(https?://|//)")


def clean_blocks(blocks: list[Block]) -> list[Block]:
    out: list[Block] = []
    for b in blocks:
        if b.kind == "img":
            if EXT_RE.match(b.src) or b.src.startswith("data:"):
                continue
            out.append(b)
            continue
        if not b.text:
            continue
        if b.kind in ("p", "h2", "h1") and NAV_NOISE.match(b.text):
            continue
        out.append(b)
    # 去掉紧邻的空 figcaption
    result: list[Block] = []
    for i, b in enumerate(out):
        if b.kind == "figcaption" and (i == 0 or out[i - 1].kind != "img"):
            if len(b.text) < 4:
                continue
        result.append(b)
    return result


def parse_html(text: str) -> list[Block]:
    p = BlockExtractor()
    p.feed(text)
    p.close()
    return clean_blocks(p.blocks)


def text_len(blocks: list[Block]) -> int:
    return sum(len(re.sub(r"<[^>]+>", "", b.text)) for b in blocks)


# --------------------------------------------------------------------------- #
# 源 1：《呐喊》
# --------------------------------------------------------------------------- #
def wiki_page(title: str) -> list[Block]:
    url = WIKI + urllib.parse.quote(title, safe="") + "/html"
    raw = fetch_text(url, {"Accept-Language": "zh-hans"})
    return parse_html(raw)


def extract_preface() -> list[Block]:
    """自序在《吶喊》总页里（校对页转写），从「自序」标题之后截取。"""
    blocks = wiki_page("吶喊")
    start = None
    for i, b in enumerate(blocks):
        if b.kind == "h1" or b.kind == "h2":
            if b.text.strip() in ("自序", "自序"):
                start = i + 1
                break
    if start is None:
        return []
    tail = blocks[start:]
    # 遇到版权/导航段就停
    cut = len(tail)
    for i, b in enumerate(tail):
        if "本作品" in b.text and len(b.text) < 40:
            cut = i
            break
    return tail[:cut]


def build_nahan() -> tuple[dict, list[tuple[str, str, list[Block]]], dict]:
    chapters: list[tuple[str, str, list[Block]]] = []

    preface = extract_preface()
    if text_len(preface) > 1200:
        chapters.append(("preface", "自序", preface))
        head = " / ".join(b.text[:24] for b in preface[:2])
        print(f"  · {'自序':<10} {text_len(preface):6d} 字 / {len(preface):4d} 块   || {head}")
    else:
        print(f"  ! 自序 文本不足（{text_len(preface)} 字），跳过")

    for slug, page_title, display_title in NAHAN:
        try:
            blocks = wiki_page(page_title)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {display_title} 抓取失败: {exc}")
            continue
        print(f"  · {display_title:<10} {text_len(blocks):6d} 字 / {len(blocks):4d} 块")
        chapters.append((slug, display_title, blocks))

    meta = {
        "uid": "urn:reader:sample:nahan",
        "title": "呐喊",
        "creator": "鲁迅",
        "language": "zh-CN",
        "publisher": "北新书局（1923）· 公版",
        "description": "鲁迅第一部小说集，收录 1918—1922 年间所作的十四篇小说。文本取自维基文库校对版，公版。",
        "nav_title": "呐喊",
    }
    return meta, chapters, {}


# --------------------------------------------------------------------------- #
# 源 2：Alice in Wonderland
# --------------------------------------------------------------------------- #
ALICE_CHAPTERS = 12


def se_file(rel: str) -> str:
    return fetch_text(SE_BASE + rel)


def resolve_img(src: str) -> str:
    """../images/illustration-2.svg → images/illustration-2.svg"""
    return "images/" + os.path.basename(src)


def build_alice() -> tuple[dict, list[tuple[str, str, list[Block]]], dict]:
    # 章节标题直接从各章 h1/h2 取，无需解析 opf 的 manifest
    chapters: list[tuple[str, str, list[Block]]] = []
    images: dict[str, bytes] = {}
    used_imgs: set[str] = set()

    for n in range(1, ALICE_CHAPTERS + 1):
        xhtml = se_file(f"text/chapter-{n}.xhtml")
        blocks = parse_html(xhtml)
        # 章节开头连续两个标题块：序数 + 章名（hgroup 结构）
        ordinal = ""
        subtitle = ""
        rest = list(blocks)
        while rest and rest[0].kind in ("h1", "h2"):
            if not ordinal:
                ordinal = rest[0].text
            elif not subtitle:
                subtitle = rest[0].text
            rest.pop(0)
        title = f"{ordinal} · {subtitle}" if subtitle else (subtitle or ordinal)

        kept: list[Block] = []
        for b in rest:
            if b.kind == "img":
                # 只保留第一章的插图，控制示例书体积
                if n != 1:
                    continue
                b.src = resolve_img(b.src)
                if b.src not in used_imgs:
                    used_imgs.add(b.src)
                    images[b.src] = fetch(SE_BASE + b.src)
            kept.append(b)
        print(f"  · {title:<34} {text_len(kept):6d} 字符 / {len(kept):4d} 块")
        chapters.append((f"ch{n:02d}", title, kept))

    meta = {
        "uid": "urn:reader:sample:alice",
        "title": "Alice's Adventures in Wonderland",
        "creator": "Lewis Carroll",
        "language": "en-GB",
        "publisher": "Macmillan（1865）· Standard Ebooks 校订版",
        "description": "Public-domain text from Standard Ebooks. Illustrations by John Tenniel (chapter 1 only, trimmed for size).",
        "nav_title": "Alice's Adventures in Wonderland",
    }
    return meta, chapters, images


# --------------------------------------------------------------------------- #
# EPUB 3 打包
# --------------------------------------------------------------------------- #
CSS = """\
html { font-size: 100%; }
body { margin: 0; padding: 0; }
h1 { font-size: 1.9em; font-weight: 400; margin: 2.4em 0 0.6em; text-align: center; letter-spacing: 0.06em; }
h2 { font-size: 1.25em; font-weight: 400; margin: 1.8em 0 1.2em; text-align: center; }
p { margin: 0; text-indent: 2em; text-align: justify; line-height: 1.9; }
figure.illus { margin: 1.6em auto; text-align: center; break-inside: avoid; }
figure.illus img { max-width: 82%; height: auto; }
figcaption, p.caption { font-size: 0.85em; text-indent: 0; text-align: center; color: #6b6258; margin-top: 0.6em; }
blockquote { margin: 1.2em 2em; }
blockquote p { text-indent: 0; }
em { font-style: italic; }
"""


def esc(s: str) -> str:
    return html_lib.escape(s, quote=False)


def blocks_to_xhtml(blocks: list[Block]) -> str:
    out: list[str] = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if b.kind == "img":
            cap = ""
            if i + 1 < len(blocks) and blocks[i + 1].kind == "figcaption":
                cap = f"<figcaption>{esc(blocks[i + 1].text)}</figcaption>"
                i += 1
            out.append(
                '<figure class="illus">'
                f'<img src="../{esc(b.src)}" alt=""/>'
                f"{cap}</figure>"
            )
        elif b.kind == "figcaption":
            out.append(f'<p class="caption">{esc(b.text)}</p>')
        elif b.kind == "blockquote":
            out.append(f"<blockquote><p>{esc(b.text)}</p></blockquote>")
        else:
            tag = b.kind if b.kind in ("h1", "h2") else "p"
            out.append(f"<{tag}>{esc(b.text)}</{tag}>")
        i += 1
    return "\n".join(out)


def xhtml_doc(title: str, body: str) -> str:
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">\n'
        f"<head><title>{esc(title)}</title>"
        '<link rel="stylesheet" type="text/css" href="../style.css"/></head>\n'
        f"<body>\n{body}\n</body>\n</html>\n"
    )


def nav_doc(meta: dict, chapters: list[tuple[str, str, list[Block]]], nested: bool) -> str:
    items = "".join(
        f'<li><a href="text/{slug}.xhtml">{esc(title)}</a></li>\n' for slug, title, _ in chapters
    )
    if nested:
        inner = (
            f'<ol><li><a href="text/{chapters[0][0]}.xhtml">{esc(meta["nav_title"])}</a>'
            f"<ol>\n{items}</ol></li></ol>"
        )
    else:
        inner = f"<ol>\n{items}</ol>"
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">\n'
        f"<head><title>目录</title></head>\n<body>\n"
        '<nav epub:type="toc" id="toc"><h1>目录</h1>\n'
        f"{inner}\n</nav>\n</body>\n</html>\n"
    )


def cover_svg(meta: dict) -> bytes:
    title = meta["title"]
    creator = meta["creator"]
    size = 76 if len(title) <= 8 else 58
    svg = f"""<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800">
  <rect width="1200" height="1800" fill="#2c2724"/>
  <rect x="70" y="70" width="1060" height="1660" fill="none" stroke="#f0b95a" stroke-width="2"/>
  <rect x="92" y="92" width="1016" height="1616" fill="none" stroke="#f0b95a" stroke-opacity="0.28"/>
  <text x="600" y="760" fill="#f4ead6" font-family="'Songti SC','SimSun',serif"
        font-size="{size * 2}" text-anchor="middle" letter-spacing="10">{esc(title)}</text>
  <line x1="470" y1="860" x2="730" y2="860" stroke="#f0b95a" stroke-width="2"/>
  <text x="600" y="960" fill="#c8baa4" font-family="'Songti SC','SimSun',serif"
        font-size="42" text-anchor="middle" letter-spacing="6">{esc(creator)}</text>
  <text x="600" y="1620" fill="#8c8175" font-family="'Songti SC','SimSun',serif"
        font-size="30" text-anchor="middle" letter-spacing="12">公 版 样 本</text>
</svg>
"""
    return svg.encode("utf-8")


def write_epub(
        path: Path,
        meta: dict,
        chapters: list[tuple[str, str, list[Block]]],
        images: dict[str, bytes],
        nested_nav: bool,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest: list[str] = []
    spine: list[str] = []

    manifest.append('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
    manifest.append('<item id="css" href="style.css" media-type="text/css"/>')
    manifest.append(
        '<item id="cover" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/>'
    )
    for slug, _, _ in chapters:
        manifest.append(
            f'<item id="{slug}" href="text/{slug}.xhtml" media-type="application/xhtml+xml"/>'
        )
        spine.append(f'<itemref idref="{slug}"/>')
    for name in images:
        mid = "img-" + re.sub(r"[^a-z0-9]+", "-", name.rsplit(".", 1)[0].lower())
        mtype = "image/svg+xml" if name.endswith(".svg") else "image/jpeg"
        manifest.append(f'<item id="{mid}" href="{name}" media-type="{mtype}"/>')

    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">{esc(meta["uid"])}</dc:identifier>
    <dc:title>{esc(meta["title"])}</dc:title>
    <dc:creator>{esc(meta["creator"])}</dc:creator>
    <dc:language>{meta["language"]}</dc:language>
    <dc:publisher>{esc(meta["publisher"])}</dc:publisher>
    <dc:description>{esc(meta["description"])}</dc:description>
    <meta property="dcterms:modified">2026-11-17T00:00:00Z</meta>
    <meta name="cover" content="cover"/>
  </metadata>
  <manifest>
    {"".join(manifest)}
  </manifest>
  <spine>
    {"".join(spine)}
  </spine>
</package>
"""

    with zipfile.ZipFile(path, "w") as zf:
        # mimetype 必须是第一个条目且不压缩
        info = zipfile.ZipInfo("mimetype")
        info.compress_type = zipfile.ZIP_STORED
        zf.writestr(info, "application/epub+zip")

        zf.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
            "  <rootfiles>\n"
            '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n'
            "  </rootfiles>\n</container>\n",
            compress_type=zipfile.ZIP_DEFLATED,
        )
        zf.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/nav.xhtml", nav_doc(meta, chapters, nested_nav), compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/style.css", CSS, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/images/cover.svg", cover_svg(meta), compress_type=zipfile.ZIP_DEFLATED)

        for slug, title, blocks in chapters:
            body = blocks_to_xhtml(blocks)
            zf.writestr(
                f"OEBPS/text/{slug}.xhtml",
                xhtml_doc(title, body),
                compress_type=zipfile.ZIP_DEFLATED,
            )
        for name, data in images.items():
            zf.writestr(f"OEBPS/{name}", data, compress_type=zipfile.ZIP_DEFLATED)


# --------------------------------------------------------------------------- #
# 校验
# --------------------------------------------------------------------------- #
def verify(path: Path) -> None:
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        assert names[0] == "mimetype", "mimetype 不是第一个条目"
        assert zf.getinfo("mimetype").compress_type == zipfile.ZIP_STORED, "mimetype 被压缩了"
        assert zf.read("mimetype") == b"application/epub+zip"
        opf = zf.read("OEBPS/content.opf").decode("utf-8")
        assert "nav.xhtml" in opf and 'properties="nav"' in opf
        xhtmls = [n for n in names if n.startswith("OEBPS/text/")]
        total = 0
        for n in xhtmls:
            body = zf.read(n).decode("utf-8")
            total += len(re.sub(r"<[^>]+>", "", body))
            assert "<html" in body and "</html>" in body
            # 行内标签一旦被写进 Block.text，就会被 esc() 转义成字面文本
            assert "&lt;em&gt;" not in body, f"{n} 含字面的 <em> 标签"
            assert "&lt;strong&gt;" not in body, f"{n} 含字面的 <strong> 标签"
        print(
            f"  校验通过: {len(xhtmls)} 章 / 正文约 {total} 字符 / "
            f"{len(names)} 个条目 / {path.stat().st_size / 1024:.0f} KB"
        )


# --------------------------------------------------------------------------- #
# 入口
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description="构建公版示例 EPUB")
    ap.add_argument("--report", action="store_true", help="只输出解析统计，不写文件")
    ap.add_argument("--only", choices=["nahan", "alice"], help="只构建其中一本")
    args = ap.parse_args()

    jobs = []
    if args.only != "alice":
        jobs.append(("nahan", SAMPLES / "nahan.epub", build_nahan, True))
    if args.only != "nahan":
        jobs.append(("alice", SAMPLES / "alice.epub", build_alice, False))

    for name, path, builder, nested in jobs:
        print(f"[{name}] 解析中…")
        meta, chapters, images = builder()
        print(f"[{name}] {len(chapters)} 章 / {len(images)} 图")
        if args.report:
            continue
        write_epub(path, meta, chapters, images, nested)
        verify(path)

    if not args.report:
        print(f"\n输出目录: {SAMPLES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
