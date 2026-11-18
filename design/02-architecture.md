# 技术方案

## 一、总体架构

```
┌────────────────────────── 浏览器（Vue 3 SPA） ──────────────────────────┐
│                                                                        │
│  ReaderView                                                            │
│  ├─ DeskLayer        书桌背景（材质贴图 + 透视 + 光影）                  │
│  ├─ BookSpread       双页跨页容器（perspective + rotateX 拟 2.5D）      │
│  │   ├─ PageSheet(左)  纸纹 + 页边阴影 + 页眉 + 页脚                     │
│  │   ├─ Spine          书脊渐变阴影                                     │
│  │   └─ PageSheet(右)                                                  │
│  ├─ FlowViewport     CSS columns 排版视口（真正的文字流）                │
│  ├─ HighlightLayer   高亮/下划线矩形叠加层（对齐 FlowViewport）          │
│  ├─ SelectionToolbar 选区浮动工具条                                     │
│  ├─ StickyNoteLayer  可拖拽便签纸片                                     │
│  └─ Chrome            TopBar / DockBar / TocDrawer / AppearancePanel    │
│                                                                        │
│  纯逻辑模块（与视图解耦，可被单测）                                      │
│  ├─ lib/epub        jszip + DOMParser → ParsedBook                     │
│  ├─ lib/pagination  CSS columns 测量 → PageIndex                       │
│  └─ lib/anchor      (chapter, offset) ⇄ 页码 ⇄ DOM Range                │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ REST (JSON + multipart)
┌────────────────────────────────▼───────────────────────────────────────┐
│                      FastAPI + SQLAlchemy + SQLite                     │
│  books / reading_progress / annotations                                │
│  data/books/{id}/book.epub, data/covers/{id}.jpg                       │
└────────────────────────────────────────────────────────────────────────┘
```

职责边界：

- **前端负责**：EPUB 解析、分页、排版、渲染、选区、标注几何计算。翻页不产生任何网络请求。
- **后端负责**：文件落盘、元数据、进度、标注的持久化与去重。**不参与排版**，只做一件额外的轻活：用 Python 标准库 `zipfile` 读 `META-INF/container.xml` → `.opf`，提取书名/作者/语言/封面，用于书架列表快速展示。

## 二、前端目录结构

```
frontend/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── public/
│   └── fonts/                       # 自托管 woff2（子集化）
│       ├── lxgw-wenkai/
│       ├── noto-serif-sc/
│       ├── noto-sans-sc/
│       ├── eb-garamond/
│       └── zcool-xiaowei/
└── src/
    ├── main.ts
    ├── App.vue
    ├── router/index.ts
    ├── api/
    │   ├── client.ts                # fetch 封装、baseURL、错误归一
    │   ├── books.ts
    │   └── annotations.ts
    ├── stores/
    │   ├── library.ts               # 书架列表、导入
    │   ├── reader.ts                # 当前书、分页状态、当前页
    │   └── prefs.ts                 # 阅读偏好（持久化到 localStorage）
    ├── lib/
    │   ├── epub/
    │   │   ├── unzip.ts             # JSZip 解包、mimetype 校验
    │   │   ├── opf.ts               # container/opf/manifest/spine/metadata
    │   │   ├── content.ts           # XHTML → 块级内容模型（含偏移）
    │   │   └── nav.ts               # nav.xhtml / toc.ncx → 两级目录
    │   ├── pagination/
    │   │   ├── layout.ts            # 版面参数计算（版心/行高/页数）
    │   │   ├── engine.ts            # CSS columns 驱动 + PageIndex 构建
    │   │   └── anchor.ts            # 偏移 ⇄ 页码 ⇄ Range
    │   └── selection/
    │       ├── rangeToOffset.ts
    │       └── offsetToRects.ts
    ├── components/
    │   ├── desk/       DeskSurface.vue  BookShadow.vue
    │   ├── reader/     ReaderView.vue  BookSpread.vue  PageSheet.vue
    │   │               PageHeader.vue  PageFooter.vue  TurnTransition.vue
    │   ├── chrome/     TopBar.vue  DockBar.vue  ProgressBar.vue
    │   ├── drawer/     TocDrawer.vue  AnnotationList.vue
    │   ├── panels/     AppearancePanel.vue  TiltPanel.vue
    │   └── annotate/   SelectionToolbar.vue  HighlightLayer.vue  StickyNote.vue
    ├── views/          LandingView.vue  ShelfView.vue  ReaderView.vue
    └── styles/
        ├── tokens.css               # CSS 变量（色板/尺寸/缓动）
        ├── fonts.css                # @font-face
        ├── reader.css               # 正文排版
        └── desk.css                 # 书桌与书的外形
```

## 三、后端目录结构

```
backend/
├── pyproject.toml
├── app/
│   ├── main.py            # FastAPI 实例、CORS、静态资源挂载
│   ├── config.py          # 路径、READER_TOKEN、CORS 白名单
│   ├── db.py              # engine / SessionLocal / Base
│   ├── models.py          # Book / ReadingProgress / Annotation
│   ├── schemas.py         # Pydantic 出入参
│   ├── routers/
│   │   ├── books.py
│   │   ├── progress.py
│   │   └── annotations.py
│   ├── services/
│   │   ├── storage.py     # 落盘、sha256、路径校验
│   │   └── epub_meta.py   # zipfile 读 opf，抽元数据与封面
│   └── deps.py            # get_db、可选 token 校验
└── data/                  # 运行期数据（gitignore）
    ├── reader.db
    ├── books/{bookId}/book.epub
    └── covers/{bookId}.jpg
```

## 四、核心机制

### 4.1 EPUB 解析 → 内容模型

```
epub 文件
  └─ mimetype                       校验必须为 application/epub+zip
  └─ META-INF/container.xml         → rootfile full-path
  └─ *.opf                          manifest(id→href,media-type) / spine(itemref 顺序) / metadata
  └─ nav.xhtml | toc.ncx            两级目录（优先 nav[epub:type=toc]）
  └─ 每个 spine 文档                XHTML 清洗 + 块级抽提
```

内容模型（**全书唯一的真相来源**）：

```ts
interface ParsedBook {
  meta: { title: string; author?: string; publisher?: string; language?: string; identifier?: string }
  chapters: Chapter[]        // 顺序 = spine 顺序
  toc: TocNode[]             // 两级
}

interface Chapter {
  index: number
  href: string
  title?: string             // 从 nav 反查，用于页眉右页
  blocks: Block[]            // 块级序列
  charLength: number         // 本章总字符数（偏移上限）
}

interface Block {
    type: 'p' | 'h1' | 'h2' | 'h3' | 'blockquote' | 'li' | 'img' | 'figcaption' | 'hr'
  text: string               // 纯文本（img 为空）
  offset: number             // 本章内起止字符偏移
  endOffset: number
  src?: string               // img 的 blob URL
  alt?: string
    width?: number;
    height?: number   // img 原始像素尺寸，排版前占位
    listStyle?: 'ul' | 'ol';
    marker?: string   // li 的样式与序号
}
```

要点：

- **偏移只在同一章节内计算**，跨章不连续。这样单章错位不会污染全书。
- **不变量**：`Block.text` 必须与渲染后的 DOM `textContent` 逐字相同。列表符号因此写进 `marker` 字段由模板输出，**不能用**
  `::before { content: '•' }` —— 否则 DOM 里多出一个不存在的字符，选区换算整体错位。
- XHTML 清洗用白名单：只把已知块级标签提成 `Block`，其余行内标签的文本合并进所在块。丢弃 `style`/`script`/`iframe`/`svg`/
  `nav`。`epub:type` 为 `pagebreak|toc|landmarks|page-list` 的元素与 `class/id` 含 `pagenum|page-number|pagebreak`
  的容器一并跳过。
- 图片转 `blob:` URL 并由 `ImageStore` 统一持有，`ParsedBook.revoke()` 一次性释放；同时记录原始宽高比，用于排版前占位（避免图片加载后跳页）。
- 抽块时顺手记录 `idOffsets: Map<元素 id, 章内偏移>`，nav 的 `#fragment` 直接查表得出 `offset`，不再二次遍历 DOM。
- 脚注链接 `a[epub:type=noteref]` 首版降级为普通行内上标，不做弹层。

### 4.2 CSS columns 分页算法（关键）

**几何定义**

| 符号 | 含义 | 取值来源 |
| --- | --- | --- |
| `PW` | 单页版心宽度 | `pageWidth - 2 * marginX` |
| `PH` | 单页版心高度 | `pageHeight - marginTop - marginBottom - headerH - footerH` |
| `GAP` | 跨页时两页之间的间隙（书脊） | 固定 `spread ? 48 : 0` |
| `STEP` | 一列的水平步长 | `PW + GAP` |
| `SPREAD` | 一屏显示几列 | 桌面 `2`，窄屏 `1` |

**关键约束**：只有让容器宽度**恰好等于** `SPREAD * PW + (SPREAD - 1) * GAP`，浏览器算出的实际列宽才精确等于 `PW`（因为 `usedColumnWidth = (容器宽 - (n-1)*gap) / n`）。这是整套算法不产生累积误差的前提。

```
setupLayout():
  flow.style.width        = SPREAD * PW + (SPREAD - 1) * GAP
  flow.style.height       = PH
  flow.style.columnWidth  = PW + 'px'
  flow.style.columnGap    = GAP + 'px'
  flow.style.columnFill   = 'auto'
  flow.style.textAlign    = 'justify'
  flow.style.textIndent   = '2em'
  flow.style.lineHeight   = prefs.lineHeight     // 默认 1.9
  flow.style.fontSize     = prefs.fontSize       // 默认 17px
  flow.style.fontFamily   = readerFontFamily(prefs.font)
  flow.style.overflow     = 'visible'            // 外部视口负责裁剪
```

```
measureColumns(flow) -> { columns, step }:
  step    = PW + GAP
  columns = Math.round((flow.scrollWidth + GAP) / step)
  return { columns, step }
```

`scrollWidth` 的取整误差用 `Math.round` 吸收；若需要更保险，用探针校准：临时插入一个 `width:0; height:0` 的块并比对两列 anchor 的 x 差值，一次性求出真实 `step`（仅在开发模式断言用）。

**翻页**

```
showSpread(index):
  offsetX = -index * step * SPREAD
  flow.style.transform = `translate3d(${offsetX}px, 0, 0)`   // 用 transform，不用 scroll
  currentSpread = index
  // 页码：左页 = 2*index + 1，右页 = 2*index + 2（1 起始）
```

用 `transform` 而非 `scrollLeft`，因为滚动会产生浏览器自带的滚动定位与 `scroll-behavior` 干扰，而 `transform` 只影响合成层，翻页动画也更便宜。

**位置映射：靠分页时建立的一次性 PageIndex，不依赖 `caretRangeFromPoint`**

`caretRangeFromPoint` 在 Firefox 是 `caretPositionFromPoint`，行为差异大且遇到图片/空行会返回 null。改为在分页完成时顺手采样：

```
buildPageIndex(flow) -> PageIndex:
  anchors = []
  for each chapter, for each block in chapter.blocks:
      el = flow.querySelector(`[data-block="${chapter.index}:${block.i}"]`)
      rect = el.getBoundingClientRect()
      xInFlow = rect.left - flow.getBoundingClientRect().left   // 两者同受 transform 影响，差值即内容坐标
      page = Math.floor((xInFlow + step / 2) / step)            // + 半列容差：块左缘必落在列边界上
      anchors.push({ chapter: chapter.index, offset: block.offset, page })
  return { anchors }        // 按 (chapter, offset) 升序
```

- 全部块级元素各测一次 `getBoundingClientRect`。一本 300 页、约 3000 个块的书，一次采样在 20–60ms 量级，只在重排时执行。
- 富文本尾部的"段内位置"再做一次精细测量即可：

```
pageForOffset(chapter, offset) -> page:
  anchor = 二分查找 anchors 中最后一个 (a.chapter, a.offset) <= (chapter, offset)
  if (offset == anchor.offset) return anchor.page
  // 只有跨段内偏移才做二次精确测量，一次开销
  range = rangeForOffset(chapter, offset)
  x = range.getBoundingClientRect().left - flowRect.left
  return max(anchor.page, Math.floor((x + 1) / step))   // 字符矩形不能加 step/2！
```

**为什么块矩形加 `step/2`、字符矩形只加 1px**
：块级元素的左缘一定压在列边界上（浮动取整误差在亚像素级），加半列容差可以吸收抖动；而单个字符的左缘可能落在列内任意位置，加半列会把右半列的字符整体误判到下一列，导致「字号往返后页码不一致」这类系统性漂移。

```
offsetForPage(page) -> { chapter, offset }:
  anchor = 二分查找第一个 anchors.page >= page
  if (anchor.page == page) return anchor
  // 页首不一定有块首：上一页的长段可能横跨到本页
  // 在 anchor 的前一个块内对字符做二分，找到第一个属于本页的字符
offsetForPage 实现为 positionAtPage 的包壳，二者共用同一套逻辑。
```

**重排（换字体/字号/行距/窗口尺寸）后位置还原**

```
repaginate():
  saved = restore ?? this.anchor ?? currentPosition()   // { chapter, offset }，来自锚点而非页码
  await document.fonts.ready                  // 字体未就绪时测量必然偏
  await preloadImages(visibleRange + 1 章)    // 图片高度稳定后再测
  restoreGeometry()
  await nextFrame()                           // 等浏览器完成一次 layout
  const { columns } = measureColumns(flow)
  pageIndex = buildPageIndex(flow)
  showSpread(Math.floor(pageForOffset(saved.chapter, saved.offset) / SPREAD))
  this.anchor = saved                         // showSpread 会清锚点，补回来
```

顺序不能变：`字体就绪 → 几何设定 → 等一帧 → 测量 → 建立索引 → 定位`。任何一步提前，都会拿到旧布局的尺寸。

**锚点记忆（实测修正）**：`showSpread` 清空、`goTo` 设定、`repaginate` 继承并回写。若不做这层记忆，`currentPosition()`
只能返回「当前页首个块」的偏移——这个块可能起始于**上一页**，链式重排会每一步都往回退一点，字号往返后页码就不一致了。

**列数兜底**：`measure()` 同时取 `round((scrollWidth + GAP) / STEP)` 与「最后一个块所在列 + 1」的较大值。部分引擎在
`overflow: visible` 下 `scrollWidth` 只反映可视宽度。

### 4.3 坐标系统与三种映射

```
              ┌──────────────┐
   持久化 ⟷   │ (chapter, offset) │  唯一可存储的坐标（进度、高亮、便签锚点）
              └──────┬───────┘
                     │ pageForOffset / offsetForPage
              ┌──────▼───────┐
   运行时 ⟷   │    page      │  只用于 UI 显示与翻页，绝不落库
              └──────┬───────┘
                     │ page → 页面矩形
              ┌──────▼───────┐
   渲染   ⟷   │  {x, y, w, h} │  相对版心左上角，页面内坐标
              └──────────────┘
```

- `percent`（进度百分比）= `(已读字符数) / (全书字符数)`，按章节累加计算，与页数无关——**这样改字号时百分比不会跳变**。
- 章节首个块的 `offset` 恒为 0，因此 `pageForOffset(chapter, 0)` 永远能定位到章首页。

### 4.4 选区 → 偏移 → 高亮矩形

**正向（选中 → 存储）**

```
1. 监听 document 的 selectionchange，拿到 Range
2. 由 range.startContainer / endContainer 向上找最近的 [data-chapter][data-block]
3. 用 TreeWalker 统计该块内从块首到 range 边界的文本字符数 → 块内偏移
4. 字符偏移 = block.offset + 块内偏移
5. 跨块/跨章：range 自然覆盖多块，按块拆分后合并为一个 locator 区间
```

块的 DOM 上挂 `data-chapter="3" data-block="17" data-offset="2481"`，避免任何一次计算都从头遍历全书。

**反向（存储 → 渲染）**

```
offsetToRects(locator) -> Rect[]
 1. 二分找到起始块与结束块
 2. 用 Range 包住文本节点区间
 3. range.getClientRects() 拿到逐行矩形（多行会返回多个）
 4. 每个 rect 减去 flowRect.left/top 得到内容坐标
 5. page = floor((x + step/2) / step)；页面内 x = x - page * step
 6. 只渲染当前 spread 可见页的矩形（其余丢弃，翻页时按需重算）
```

高亮层与 `flow` **共用同一个 transform**，逐层嵌套在同一个定位上下文里，这样缩放/翻页时高亮不会漂移。高亮块用 `mix-blend-mode: multiply` + 半透明背景，文字能透出来。

**下划线**：同一套矩形，改为 `border-bottom: 2px solid`，并把高度压到行底。

**便签**：`{x, y, rot}` 归一化到 0–1 存储，相对**页面版心**而非视口。锚点仍存 `locator`（用于跳转与虚线连线的起点）。

### 4.5 主题与偏好

```css
:root {
  --ink: #3b3229;          /* 正文墨色 */
  --ink-soft: #8c8175;     /* 页眉页脚 */
  --paper: #f7f1e3;        /* 纸色 */
  --paper-edge: #e6dcc6;
  --accent: #f0b95a;       /* 进度条 / 焦点 */
  --panel: rgba(28, 24, 21, .72);
  --hair: rgba(255, 255, 255, .12);
  --shadow: 0 40px 80px rgba(0, 0, 0, .45);
  --ease: cubic-bezier(.22, .61, .36, 1);
  --note-font: 20px;
}
```

- 桌面主题切换只改 `body[data-desk]` 下的 `--desk-bg / --desk-shade` 与背景图。
- 偏好持久化键：`reader:prefs:v1`，字段 `{font, quoteFont, fontSize, lineHeight, pageMargin, desk, endpaper, spread, turnHintSeen, tiltHintSeen, tilt}`。
- 窄屏（`< 900px`）自动降为 `SPREAD = 1`，并隐藏页码左页。

### 4.6 服务器端元数据提取（Python 标准库）

```python
with zipfile.ZipFile(path) as z:
    container = z.read("META-INF/container.xml")
    opf_path  = parse(container).find(".//{*}rootfile").get("full-path")
    opf       = z.read(opf_path)
    # 取 dc:title / dc:creator / dc:language / dc:identifier
    # 封面：manifest 中 properties 含 "cover-image" 的 item，或 meta[@name=cover] 指向的 id
```

只用 `zipfile + xml.etree`，不引入第三方 EPUB 库。失败时降级为「用文件名作书名 + 无封面」，前端解析后再回传补充 `toc_json` 与 `chapter_count`。

## 五、数据模型

```sql
CREATE TABLE books (
  id            TEXT PRIMARY KEY,          -- nanoid
  title         TEXT NOT NULL,
  author        TEXT,
  publisher     TEXT,
  language      TEXT,
  identifier    TEXT,
  file_path     TEXT NOT NULL,
  file_size     INTEGER,
  file_hash     TEXT NOT NULL UNIQUE,      -- sha256，同书去重
  cover_path    TEXT,
  toc_json      TEXT,                      -- 前端解析后回传
  chapter_count INTEGER,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE reading_progress (
  book_id     TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  chapter     INTEGER NOT NULL,
  char_offset INTEGER NOT NULL,
  percent     REAL    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE annotations (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,               -- highlight | underline | note
  color       TEXT,
  chapter     INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset   INTEGER NOT NULL,
  quote       TEXT,                        -- 冗余存原文，供标注列表展示
  note_json   TEXT,                        -- {text,x,y,rot,tags,textColor,font}
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_ann_book ON annotations(book_id, chapter, start_offset);
```

`kind = 'note'` 表示"没有底色、只有纸片便签"的批注，此时 `start_offset == end_offset` 也是合法的（便签可以挂在段落某点上）。

## 六、API 契约

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查，返回 `{ok: true, version}` |
| GET | `/api/books` | 书架列表，返回 `BookSummary[]`（含 `percent`、`coverUrl`） |
| POST | `/api/books` | `multipart/form-data`，字段 `file`。服务端算 sha256 去重，抽元数据，返回 `Book` |
| GET | `/api/books/{id}` | 单书详情（含 `toc`、`chapterCount`） |
| GET | `/api/books/{id}/file` | 返回 epub 原始字节（`application/epub+zip`），前端用于解析 |
| GET | `/api/books/{id}/cover` | 封面图；无封面返回 404，前端画占位 |
| PATCH | `/api/books/{id}` | 前端解析完成后回传 `{toc, chapterCount, title?}` |
| DELETE | `/api/books/{id}` | 删库 + 删文件（幂等） |
| GET | `/api/books/{id}/progress` | `{chapter, charOffset, percent, updatedAt}`，无记录返回 404 |
| PUT | `/api/books/{id}/progress` | 覆盖写入（前端 1s 去抖 + 翻页即写） |
| GET | `/api/books/{id}/annotations` | `Annotation[]`，按 `chapter, startOffset` 升序 |
| POST | `/api/books/{id}/annotations` | 创建，`id` 由前端生成（nanoid），天然幂等 |
| PATCH | `/api/annotations/{id}` | 更新 `color` / `note_json` |
| DELETE | `/api/annotations/{id}` | 删除 |

约定：

- 所有时间用 ISO 8601 UTC 字符串。
- 错误统一 `{error: {code, message}}`，HTTP 状态码语义化。
- 单用户模式无会话；若设置了 `READER_TOKEN`，所有 `/api/*` 需带 `Authorization: Bearer <token>`，前端从 `localStorage` 读取。
- 前端 `api/client.ts` 统一封装 baseURL（`VITE_API_BASE`，默认 `http://127.0.0.1:8000`）与错误归一，为将来加认证层留口。

## 七、本地启动

Windows 环境（无需 make）：

```
scripts/dev.ps1           # 同时拉起 uvicorn --reload 与 vite
scripts/dev-backend.ps1   # 仅后端
scripts/dev-frontend.ps1  # 仅前端
```

同时提供 `docker-compose.yml`（`backend` + `frontend` 两个服务，后端挂载 `./backend/data`）作为替代路径。

## 八、风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| CSS columns 跨浏览器差异（Chromium/Firefox 对 `column-fill: auto`、`break-inside` 处理不同） | 页数不一致、孤行 | 只保证 Chrome 系最佳；分页引擎隔离，可换成 JS 测量实现；把页数展示设为"约 N 页" |
| `scrollWidth` 取整误差 | 末页多/少一页 | `Math.round` + 开发态断言校准；末页空白容忍 |
| 图片加载后高度变化导致跳页 | 读到一半版面乱跳 | 解析时记录宽高比，`<img>` 显式 `aspect-ratio` + `loading="lazy"` + 加载完成后仅重排图片之后的内容 |
| 大书（>1MB 纯文本）分页卡顿 | 打开慢 | 分章懒排版：先排当前章与相邻章，跳章时再补；`buildPageIndex` 按章增量 |
| 字体未就绪就测量 | 页码全程偏 | 强制 `document.fonts.ready` 后再 `nextFrame()` 再测 |
| 中文避头尾/标点挤压支持有限（`text-spacing-trim`、`hanging-punctuation`） | 标点出现在行首 | 渐进增强，不支持时接受；关键段落用非断行空格兜底 |
| 高亮矩形随重排漂移 | 标注错位 | 所有几何一律从 `locator` 现算，**不缓存像素坐标**；高亮层与 flow 共享 transform |
| `break-before: recto` 在 multicol 中无效 | 章首不在右页 | 用插图占位块对齐奇偶，Phase 3 评估；不稳定就放弃这一细节 |
| 首页 3D 落地页成本高 | 拖慢主功能 | 落地页首版只做静态排版，不做滚动叙事 |
