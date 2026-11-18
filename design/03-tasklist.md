# 任务清单

按「最快看到一本能翻页的书」排序，而不是按技术分层排序。每个 Phase 结束都必须有一条可手动验证的验收标准，验收不过不进下一阶段。

## 总体节奏

| Phase | 内容 | 预估 | 里程碑 |
| --- | --- | --- | --- |
| 0 | 前后端骨架 + 一键启动 | 0.5–1 天 | `dev.ps1` 起来，`/api/health` 通 |
| 1 | 书架与书籍入库 | 1.5 天 | 能上传 epub，书架出现封面 |
| 2 | EPUB 解析 | 1.5 天 | 控制台能打印章节树与块数 |
| 3 | 分页引擎（CSS columns） | 2–3 天 | 拿到稳定的页数与页码 |
| 4 | 阅读器视图与翻页 | 2–3 天 | **能读完一整本书** |
| 5 | dock + 目录抽屉 | 1.5–2 天 | 目录能跳准，进度条联动 |
| 6 | 阅读外观设置 | 1–1.5 天 | 改字号不丢位置 |
| 7 | 高亮 / 下划线 / 便签 | 3 天 | 重排后标注仍准确 |
| 8 | 进度同步与续读 | 0.5 天 | 关掉浏览器再开，回到原处 |
| 9 | 书桌 2.5D 精修 + 视角 | 1–2 天 | 静态截图相似度 >80% |
| 10 | （可选）真 3D WebGL | 3–5 天 | — |

合计约 15–19 个工作日。Phase 4 结束即为「首版可用」。

## Phase 0 · 前后端骨架

- [x] `frontend/`：Vite + Vue 3 + TS，接入 Pinia、Vue Router，配 `@` 别名、严格 TS 与 `vue-tsc` 类型检查
- [x] `backend/`：`pyproject.toml`，FastAPI + uvicorn + SQLAlchemy，`app/main.py` 提供 `/api/health`，CORS 放行 `http://localhost:5173`
- [x] SQLAlchemy 建表（`books` / `reading_progress` / `annotations`），启动时 `create_all`
- [x] `scripts/dev.ps1`：并行拉起 uvicorn `--reload` 与 vite；`scripts/dev-backend.ps1`、`scripts/dev-frontend.ps1`
- [x] `docker-compose.yml`（backend + frontend，后端挂载 `./backend/data`）
- [x] 公版示例书：`scripts/build_samples.py` → `samples/{nahan,alice}.epub`，构建后自带 mimetype / 条目 / 章节数校验
- [ ] 字体：暂用 `styles/tokens.css` 里的系统字体栈兜底（`--font-wenkai` / `--font-serif-sc` / `--font-sans-sc` / `--font-classic` / `--font-xiaowei` 已定义）。woff2 子集化与 `@font-face` 放到 Phase 6 做外观设置时一并接入，避免 Phase 0 拉几十 MB 中文字体
- [x] `styles/tokens.css` 落地 [02-architecture.md](02-architecture.md) 4.5 节的 CSS 变量
- [ ] `.gitignore` 补 `backend/data/`、`node_modules/`、`.venv/`（已覆盖）

**验收**：`.\scripts\dev.ps1` 一条命令起双端；浏览器打开 5173 是空白应用，`curl 127.0.0.1:8000/api/health` 返回 200；`backend/data/reader.db` 已生成且含三张表。

## Phase 1 · 书架与书籍入库

后端：

- [x] `services/storage.py`：sha256 计算、`data/books/{id}/book.epub` 落盘、路径穿越校验
- [x] `services/epub_meta.py`：`zipfile` + `xml.etree` 读 container → opf → `dc:title/creator/language/identifier` + 封面
  item
- [x] 封面转存 `data/covers/{id}.jpg`（若为 png/webp 原样存，扩展名跟随）
- [x] API：`GET /api/books`（带 `percent`）、`POST /api/books`、`GET /api/books/{id}`、`GET /api/books/{id}/file`、
  `GET /api/books/{id}/cover`、`PATCH /api/books/{id}`、`DELETE /api/books/{id}`
- [x] 重复上传按 `file_hash` 幂等返回已有书籍
- [x] 非 epub / 缺 mimetype → 422 并给出可读错误

前端：

- [x] `ShelfView`：封面网格、书名/作者、未读进度环、空态插画
- [x] 上传：`<input type="file" accept=".epub,application/epub+zip">` + 全窗口拖放遮罩
- [x] `stores/library.ts`：列表拉取、上传中状态、失败提示
- [x] `api/client.ts`：baseURL 可配、错误归一、超时

**验收**：拖入一本 epub → 2 秒内书架出现带封面与书名的新条目；再次拖入同一文件不产生重复条目；刷新后仍在。

> 首版补记：删除书籍带二次确认；错误响应统一为 `{error:{code,message}}`；`percent` 约定 0–1；封面按实际 media-type 存
`.jpg/.png/.svg/...`，`GET /cover` 回传对应 `Content-Type`。

## Phase 2 · EPUB 解析

- [x] `lib/epub/unzip.ts`：JSZip 解包，校验 `mimetype` 内容为 `application/epub+zip`
- [x] `lib/epub/opf.ts`：container.xml → opf 路径 → manifest/spine/metadata 解析，spine 顺序决定章节顺序
- [x] `lib/epub/content.ts`：XHTML → `Block[]`
  - 白名单清洗（丢弃 `style/script/iframe/svg`）
  - 每个块累计 `offset` / `endOffset`（章内字符偏移）
  - 图片转 `blob:` URL，记录原始宽高比
  - 空段落（纯空白）剔除，避免空行占版
- [x] `lib/epub/nav.ts`：优先 `nav[epub:type=toc]`，回退 `toc.ncx`；输出两级 `TocNode[]`，映射到 `{chapter, offset}`
- [x] 章名反查：用 nav 的 href 匹配 spine 文档，得到每章标题（供右页页眉）
- [x] 解析完成后 `PATCH /api/books/{id}` 回传 `{toc, chapterCount}`，服务端缓存

**验收**：对中文样本与英文样本各解析一次，控制台输出章节数、总块数、两级目录树、总字符数；所有插图能显示；无 XHTML 解析异常抛出（异常记 warn 继续）。

**实测（开发态自检页 `/debug/parse`，仅 DEV 注册）**：

| 书     | 章节 | 块   | 字符      | 目录根/总 | 插图               | 耗时     |
|-------|----|-----|---------|-------|------------------|--------|
| 呐喊    | 15 | 982 | 69 340  | 1/16  | 0                | 72 ms  |
| Alice | 12 | 794 | 142 735 | 12/12 | 3（blob URL 正常渲染） | 109 ms |

> 实现补记：
> - `mimetype` 缺失或内容不对直接报错；ZIP 外层多套目录时按 `container.xml` 实际位置推断前缀；路径查找不区分大小写（真实
    EPUB 常出现 href 与条目大小写不一致）。
> - 按 XML 声明里的 `encoding` 解码，GBK 中文 EPUB 不会被读成乱码；XHTML 按 XML 解析失败时退回 HTML 解析。
> - 片段定位改用抽块时顺手记下的 `idOffsets`（元素 id → 字符偏移），不再二次遍历 DOM。
> - 图片尺寸优先取 `<img width/height>`，否则等 `Image.onload` 拿 `naturalWidth/Height`；blob URL 统一由 `ImageStore` 持有，
    `ParsedBook.revoke()` 一次性释放。
> - 字符数校验：对全书 XHTML 去标签后的字符数减去“块边界多计的一个空格”，与解析结果相差 14 / 9 个字符（来自段落 trim 与
    `<br>` 归一），无整段丢失。
> - 渲染约束：`Block.text` 必须原样输出为文本节点，不能用 `::before` 之类补列表符号，否则偏移映射会错位。

## Phase 3 · 分页引擎

**这是全项目唯一的硬骨头，必须做成不依赖 Vue 的纯模块，可脱离 UI 单测。**

- [ ] `lib/pagination/layout.ts`：`readingLayout(prefs, viewport) → {PW, PH, GAP, STEP, SPREAD, headerH, footerH, margins}`
- [ ] `lib/pagination/engine.ts`
  - [ ] `applyGeometry(flow, layout)`：容器宽 = `SPREAD*PW + (SPREAD-1)*GAP`，`column-width = PW`，`column-gap = GAP`，`column-fill: auto`
  - [ ] `measureColumns(flow)`：`columns = round((scrollWidth + GAP) / STEP)`
  - [ ] `showSpread(i)`：`translate3d(-i * STEP * SPREAD, 0, 0)`
  - [ ] `buildPageIndex(flow)`：遍历块级元素测 rect → `anchors[{chapter, offset, page}]`
  - [ ] `pageForOffset` / `offsetForPage`：二分 + 单块精确测量
  - [ ] `repaginate()`：`fonts.ready → 几何 → nextFrame → 测量 → 建索引 → 恢复位置`
- [ ] `lib/pagination/anchor.ts`：`rangeForOffset(chapter, offset)`，用 `data-chapter/data-block/data-offset` 定位
- [ ] 排版样式：`text-align: justify`、`text-indent: 2em`、`line-height` 可配、`text-spacing-trim: trim-start`（渐进增强）、`break-inside: avoid` 给图片与图注
- [ ] 重排去抖（resize 150ms）+ 分章懒排版（首版可先整本排，超 2s 时再优化）
- [ ] 开发态断言面板：页数、STEP、PW/PH、单次重排耗时

**验收**：
1. 任意一本样本书，总页数为偶数（或至少稳定复现）；
2. 连续测试：字号 15→17→19→17，每次回到的字偏移一致；
3. 窗口从 1920 拖到 1280，当前位置字偏移不变；
4. 单次重排耗时 < 300ms（300 页量级）。

## Phase 4 · 阅读器视图与翻页

- [ ] `BookSpread`：左页 / 书脊 / 右页三栏结构，`perspective` + 轻微 `rotateX` 拟 2.5D
- [ ] `PageSheet`：纸色背景、纸纹（SVG `feTurbulence` 生成 base64 贴图）、内侧页边暗角、外侧投影
- [ ] `FlowViewport`：真正承载 CSS columns 的视口，`overflow: hidden`，与 `PageSheet` 严格对齐
- [ ] `PageHeader`：左页书名、右页章名；小字号、字距 `0.08em`、色 `--ink-soft`
- [ ] `PageFooter`：页码居中（左页偶数、右页奇数）
- [ ] 章首页规则：章标题居中大字号、上下大留白；**章起于右页**（先做「章节标题块 `break-before: column`」，奇偶对齐留到 Phase 9）
- [ ] 翻页交互
  - [ ] `←/→`、`Space/Shift+Space`、`PageUp/PageDown`、`Home/End`
  - [ ] 点击左右页缘（左右各 12% 宽度热区）
  - [ ] 拖动页角（首版只做跟随位移 + 松手判定，不做卷曲）
  - [ ] 滚轮与 `↓` **刻意不响应**，容器 `overflow: hidden`
- [ ] `TurnTransition`：CSS transform 横向位移 + 阴影强度变化，时长 380ms，`--ease`；`prefers-reduced-motion` 时降为淡入
- [ ] 图片点击 → 全屏预览弹层（含图注）
- [ ] `stores/reader.ts`：`currentSpread`、`totalColumns`、`percent`、`goNext/goPrev/goTo(chapter, offset)`

**验收**：用键盘从封面一路翻到末页不报错、不空白、不错位；每个 spread 都完整可读，没有半行被切；图片与图注不跨页断裂；点击左右页缘与方向键行为一致。

## Phase 5 · dock 与目录抽屉

- [ ] `DockBar`：胶囊 + `backdrop-filter: blur(18px)` + 圆角 18px + 距底 20px
- [ ] 按钮从左到右：书库 / 目录与标注 / `←` / 进度百分比 + 3px 进度条 / `→` / 合上书籍 / `−` zoom / `+` zoom / 全屏 / 适应屏幕 / 阅读外观
- [ ] 无操作 2s 自动收起，鼠标进入或点击唤出（收起时要保证可以再次唤出，别做成原站那种「点不到」）
- [ ] `TocDrawer`：`top 14 / bottom 14 / left 14 / width 340 / radius 20 / blur 22`，双 tab「目录 / 标注」
- [ ] 目录：两级，子级缩进 16px + 左侧 1px 竖导线；点击 → `pageForOffset` → `showSpread`
- [ ] 标注 tab：色点 + 引文 + 便签摘要，点击回跳（Phase 7 数据接上后自动生效，先渲染空态）
- [ ] 全屏：`requestFullscreen()`；适应屏幕：重置 zoom 并按视口重算 layout

**验收**：点目录任意一条（含跨章、含二级）都能跳到目标页首；进度条百分比与当前页/总页一致；dock 收起后 `←/→` 仍可用。

## Phase 6 · 阅读外观设置

- [ ] `AppearancePanel`：360px 弹出层，5 列网格
- [ ] 桌面主题 5 种：walnut `#514944` / ash `#b7b0a2` / ink `#363a3b` / baize `#93a592` / stone `#cccec8`，每种带材质 swatch 与 `pale` 浅色 UI 标记
- [ ] 阅读字体 5 种下拉（经典书刊 / 思源宋体 / 思源黑体 / 霞鹜文楷 / 站酷小薇）+ 说明文案
- [ ] 引用字体下拉（霞鹜文楷 / 跟随正文）
- [ ] **原站没有、我们要补的**：字号（14–22px）、行距（1.5–2.2）、页边距（窄/中/宽）三档控件 + 护眼暖色开关
- [ ] 环衬 5 色：ivory / sand / slate / sage / burgundy
- [ ] 所有改动：`stores/prefs.ts` 写 `localStorage["reader:prefs:v1"]`，并触发 `repaginate()` 保留字偏移
- [ ] 面板底部「开源字体与许可」链接到本地 `licenses.html`

**验收**：连续切换 5 种字体 × 3 档字号，每次都停留在同一句话上（肉眼可验证同一段落）；刷新页面偏好保持；窄屏自动单页。

## Phase 7 · 高亮 / 下划线 / 便签

后端：

- [ ] API：`GET/POST /api/books/{id}/annotations`、`PATCH/DELETE /api/annotations/{id}`
- [ ] `id` 由前端生成（nanoid），POST 幂等
- [ ] 列表按 `chapter, start_offset` 排序返回

前端：

- [ ] `lib/selection/rangeToOffset.ts`：`Selection → locator{chapter, start, end}`，支持跨块；跨章时按章拆分
- [ ] `lib/selection/offsetToRects.ts`：`locator → Rect[]`（页面内坐标），只算当前 spread
- [ ] `SelectionToolbar`：选区上方浮出，含「高亮 / 下划线」分段切换、6 色色板（yellow `#ffe45c` / pink `#ff9cbc` / green `#9be58b` / blue `#8ccbff` / orange `#ffba70` / violet `#c9a8ff`）、「加便签」；AI 入口留占位按钮（禁用态）
- [ ] `HighlightLayer`：与 flow 共享 transform，逐行矩形叠加，`mix-blend-mode: multiply`；下划线走 `border-bottom`
- [ ] 已存在标注的点击 → 就地删除 / 改色
- [ ] `StickyNote`：纸片样式，可拖动、右下角缩放，`{x,y,rot}` 归一化存 0–1
- [ ] 便签与原文之间画虚线 SVG 曲线（`stroke-dasharray: 3 6`）
- [ ] 便签内容：Markdown 实时渲染、标签（最多 5 个）、文字色网格、笔记字体
- [ ] 自动保存：输入去抖 350ms；状态 `saving/saved/error` 显示在便签角落；失败重试 2 次后提示
- [ ] `stores/reader.ts` 维护 `annotations` 索引，按 `chapter` 分组加速

**验收**：
1. 选中一段跨两行的文字 → 高亮 → 两行都被覆盖，不溢出到页边；
2. 换字体、改字号、改窗口宽 → 高亮仍在同一段文字上（**这是对坐标系统的终检**）；
3. 便签拖动后刷新页面位置不变；
4. 目录抽屉「标注」tab 能看到该条并点击回跳。

## Phase 8 · 进度同步与续读

- [ ] API：`GET/PUT /api/books/{id}/progress`
- [ ] 翻页后 1s 去抖 `PUT`，字段 `{chapter, charOffset, percent}`；`beforeunload` 用 `sendBeacon` 兜底
- [ ] 打开书籍时读 progress → `pageForOffset` → 定位；无记录则从头
- [ ] 书架进度环用 `percent` 渲染，`>90%` 视为「读完了」样式
- [ ] 本地 `localStorage` 兜底：网络失败时先存本地，下次打开优先本地再对齐服务端

**验收**：读到第 37 页关掉标签页，重开书回到第 37 页；换一个浏览器（同后端）也能回到该位置。

## Phase 9 · 书桌 2.5D 精修与视角

- [ ] 桌面 5 种材质 webp 背景 + 中心暗角 + 桌面边缘渐变
- [ ] 书的外形：书脊厚度、纸叠侧边纹理、封面/环衬可见边、四角轻微翘起
- [ ] 页边阴影：内侧书脊渐变 + 外侧投影 + 底部投影
- [ ] 纸纹与「纸背透字」：左页叠加极淡的反向文字纹理（用 CSS 生成廉价近似，不用 WebGL）
- [ ] `TiltPanel`：252px 弹出层，三个预设（俯视 / 默认 / 斜视）+ 0–1.08 滑块，映射到 `rotateX` 角度
- [ ] 按住右键拖动 / `Alt` + 拖动改视角，不影响阅读位置
- [ ] 首次进入的提示文案（拖动页角或按 ← →、调整视角），看过记入 prefs
- [ ] 章起于右页的奇偶对齐（用满高占位块 + `break-before: column`，不稳定则放弃并在文档标注）

**验收**：与目标站点截图并排对比，静态相似度目测 >80%；视角滑块拖动时书形变自然、文字不糊；任何视角下点击翻页命中正确。

## Phase 10 · （可选）真 3D WebGL

- [ ] three.js 引入，替换 `BookSpread` 为书模型 + 页面 canvas texture
- [ ] 页面像素来源：把 `FlowViewport` 的每一列用 `foreignObject` 或离屏 canvas 栅格化
- [ ] **代价明确**：一旦走贴图，原生选区消失，必须补一层透明 DOM 文字层，`lib/selection` 要改为按文字层矩形命中
- [ ] 翻页卷曲 shader（可只做页角局部弯曲）
- [ ] 前提：Phase 3–8 的模块边界清晰、无视觉层泄漏，否则此阶段等于重写

**验收**：翻页有真实的页角卷曲与纸张弯曲光影；帧率稳定 60fps（1440p）；高亮与便签在新渲染路径下位置仍然正确。

## 贯穿全程的质量要求

- [ ] `lib/epub`、`lib/pagination`、`lib/anchor` 三个纯逻辑模块必须有单测，输入固定 HTML 片段 + 固定 layout，断言页数与偏移映射
- [ ] 每完成一个 Phase 用同一本样本书做一次「翻到第 50 页 → 改字号 → 再改回来」的回归
- [ ] 不做的事：不引入 UI 组件库（组件全自研，保持观感统一）、不引入 Tailwind、不引入状态持久化插件
- [ ] 提交粒度：一个 Phase 至少一次提交，提交信息用 `feat(reader): ...` / `fix(pagination): ...` 形式
