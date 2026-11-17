# 目标站点调研：Infinite Reader（ereader.space）

调研时间：2026-11。方式：浏览器实测（截图 + 交互验证）+ 页面 CSS/JS 源码核对。

## 一、站点定位

**Infinite Reader** —— 浏览器内的「实体书阅读器」。它把 EPUB 渲染成一张书桌上的真实书籍，可以拖动视角、翻动页角，并在其上叠加高亮、便签、Markdown 笔记与 AI 阅读助手。

| 项 | 内容 |
| --- | --- |
| 站点名 | Infinite Reader |
| 页面标题 | Infinite Reader — 在线 EPUB 阅读器、读书笔记与 AI 阅读助手 |
| 核心主张 | 「一方书桌，无限可能」／「让阅读，舒服一点」 |
| 输入格式 | **仅 EPUB**（FAQ 明确不支持 PDF） |
| 使用门槛 | 免登录可试读示例书；上传自有书 / 云同步 / AI 需登录 |
| 商业化 | 无定价页、无付费墙、无订阅层级 |
| 登录方式 | 邮箱 6 位验证码 + Google OAuth；也可「继续离线」 |

核心功能骨架（按其落地页 10 章叙事的顺序，即官方自认的功能顺序）：

1. 阅读（Reading）—— 3D 书籍实体感翻页
2. 角度与纵深（Angle & depth）—— 拖动调整观察视角
3. 字体与主题（Fonts & themes）—— 阅读字体 + 桌面材质 + 环衬
4. 高亮（Highlights）—— 多种高亮色 + 下划线
5. 实时 Markdown 笔记（Live Markdown）
6. 自动保存（Auto-save）
7. Agent 阅读伙伴 —— 基于书中内容的问答，给出页码出处
8. 思维导图（Mind maps）
9. 3D 图谱（3D atlas）
10. 全屏（Fullscreen）

## 二、路由与入口

| 路由 | 说明 | 关键 Query |
| --- | --- | --- |
| `/` | 落地页（中英双语） | `?lang=zh-CN` / `?lang=en` |
| `/shelf` | 书架（我的书 / 示例书） | `?lang=`、`?sample=alice`、`?sample=zh` |
| `/book/:bookId` | 阅读器（示例书 id 形如 `bk_bw60tk`） | `?lang=` |
| `/about` | 关于 | `?lang=` |
| `/privacy` | 隐私政策 | `?lang=` |
| `/terms` | 使用条款 | `?version=2026-10-29`、`?lang=` |
| `/fonts/licenses.html` | 开源字体许可 | — |

主要入口按钮：

| 按钮文案 | 实际 href |
| --- | --- |
| 开始阅读 / Start reading | `/shelf?lang=zh-CN` |
| 翻开示例书 / Try a sample book | `/shelf?sample=alice&lang=en`（中文样书 `?sample=zh`） |
| 落地页叙事区「打开阅读器」 | 同上深链 |
| 书架上中文样书 | `/book/bk_bw60tk` |

同域 API（原站）：`/api/auth/{me,providers,email/request,email/verify,google/start,logout}`、`/api/books`、`/api/books/:id/{file,cover,progress,annotations,notes,metadata}`、`/api/costs`，示例书静态文件 `/samples/{alice,zh-sample}.epub`。

## 三、落地页版块

1. **Hero**：eyebrow「一方书桌，无限可能」，H1「阅读之中，自有无限。」，双 CTA（开始阅读 / 翻开示例书）。
2. **#experience：3D 书卷滚动叙事（01–10 章）**：滚动时书在页面上开合、翻页、换字体换桌面；带 `滚动展开` 提示、`←` `→` 按钮、章节指示 `01 / 10`、章节下拉。
3. **#possibilities 过渡句**：「不只是存书的地方。一个能陪你待着的地方。」
4. **三篇功能专栏**：「让阅读，舒服一点。」「让灵感，有处落笔。」「让好奇，多走一步。」
5. **How it works（3 步）**：带一本书来 → 找到自己的阅读节奏 → 留下真正留在心里的。
6. **FAQ（4 条）**：仅支持 EPUB；可免登录试读示例；笔记自动保存本地、登录后云同步；AI 可选。
7. **收尾 CTA**：「翻开第一页。」
8. **Footer**：About / Privacy / Terms。

## 四、阅读界面逐区域拆解

### 4.1 整体场景

全屏 WebGL 画布铺满视口，背景是可切换材质的**书桌**（胡桃木、亚麻、石墨、鼠尾草毡、石灰岩），带透视与光影。书置于桌面中央，有书脊厚度、纸叠厚度、封面/环衬、页边阴影、以及从纸背透过来的反向文字。

- 封面态：合着的实体书，可见封面、书脊、书页侧边纹理。
- 打开后：**双页跨页（spread）**，偶数页在左（verso），奇数页在右（recto），中间是书脊的弯曲阴影。
- 右下角常驻 **Infinite** 圆形悬浮按钮（AI 入口）。
- 左下首次提示：`拖动页角或按 ← →`；视角提示：`按住鼠标右键拖动以调整视角 / 触控板按住 Alt 拖动 / T`。两条提示看过即记入偏好，不再出现。

### 4.2 顶部 chrome（read-chrome）

- 左上：圆形**返回**按钮（回 `/shelf`）+ 圆形「展开/收起阅读工具栏」按钮。
- 右上：账号胶囊（`登录`）+ **界面语言**下拉（中文 / English）+ 「打开 Infinite」按钮。
- **没有书名标题栏，也没有章节名**——书名与章名只印在纸页的页眉里。chrome 极简，不抢正文。

### 4.3 正文排版（复刻重点）

- **双页跨页**：左/右各一页，中间书脊阴影渐变。
- **页眉（running header）**：左页印书名，右页印「章名 · 小节名」，小字号、字距略宽、颜色偏灰。
- **页脚**：页码居中，无装饰线，如 `2` / `3`。
- **正文**：中文横排、两端对齐（justify）、**首行缩进 2 字符**、每页单栏（不是双栏）、行距约 1.9–2.0、CJK 标点挤压/避头尾、中文引号。
- **章节标题页**：章名居中，字号明显大于正文，上下留白大；**章起于右页**，此时左页整页留白（只保留页眉页脚）。
- **图片与图注**：插图嵌入正文流、居中、带细边框/纸感；图注小字号居中，格式「图 1 技术能力随时间呈指数增长」；**点击图片可弹出大图预览**。
- **纸张质感**：轻微纸纹 + 边缘暗角 + 左页的「纸背透字」（3D 贴图效果，非 DOM 文本）。
- **没有字号 / 行距 / 页边距控件**：正文尺寸只受底部 dock 的 zoom（100% → 110% → … → 25%）与字体族影响。**这是原站的功能缺口，我们要补上。**

### 4.4 底部工具条 dock

居中悬浮，胶囊状，毛玻璃 `backdrop-filter: blur(18px)`，圆角 18px，距底 20px，无操作约 1–2 秒自动收起，鼠标移入/点击展开。展开后从左到右：

1. 书库（回 `/shelf`）
2. 目录与标注（打开左侧抽屉，含「目录 / 标注」双 tab）
3. 上一页 `←`
4. 进度：百分比（如 `13%`）+ 下方 3px 细进度条，填充色 `--accent`（暖金）
5. 下一页 `→`
6. 合上书籍（合书动画回封面/书架）
7. 缩小 `−` / 百分比 / 放大 `+`
8. 进入全屏阅读
9. 书籍适应屏幕
10. 阅读外观（弹出 360px 面板）
11. 视角（弹出 252px 面板）

### 4.5 左侧抽屉「目录与标注」

- `position: fixed`，`top: 14px`、`bottom: 14px`、`left: 14px`、`width: 340px`、`border-radius: 20px`、`backdrop-filter: blur(22px)`；上方有 chrome 时 `top: 60px`。
- 顶部 tab：`目录` / `标注`。
- 目录 `ul.toc`：条目为 `button`，`padding: 9px 10px; font-size: 14px`；**支持两级**——父级 `.toc-parent` 加粗 600，子级 `ul.toc-children` 缩进 16px 并带左侧竖导线。
- 点击目录 = `goToToc(chapter, blockIndex)` → `pageForOffset()` 换算页码 → **直接翻到该页**（不是锚点滚动）。
- 标注 `ul.marks`：每条 = 颜色圆点 + 引文（衬线 15px）+ 笔记摘要（手写体 18px，色 `#ffe27a`），点击跳回原文。

### 4.6 阅读外观面板（360px）

- 5 列网格 `.appearance-options`。
- **桌面主题 5 种**（带材质 swatch）：

| id | 名称 | 材质 | 主色 | 浅色 |
| --- | --- | --- | --- | --- |
| walnut | Walnut 胡桃木 | wood | `#514944` | 否 |
| ash | Linen 亚麻 | linen | `#b7b0a2` | 是 |
| ink | Graphite 石墨 | matte | `#363a3b` | 否 |
| baize | Sage 鼠尾草毡 | felt | `#93a592` | 是 |
| stone | Limestone 石灰岩 | stone | `#cccec8` | 是 |

- **阅读字体 5 种**（下拉，带说明文案）：

| 名称 | 字体栈 | 说明 |
| --- | --- | --- |
| 经典书刊 | EB Garamond + 系统宋体 | 西文衬线 |
| 思源宋体 | Noto Serif SC | 端正、适合长文 |
| 思源黑体 | Noto Sans SC | 清晰、简洁 |
| 霞鹜文楷 | LXGW WenKai | 温润、手写韵味（**默认**） |
| 站酷小薇体 | ZCOOL XiaoWei | 轻盈、书卷气 |

- **引用字体**下拉（霞鹜文楷 / 跟随正文）。
- **环衬 endpaper 5 色**：ivory / sand / slate / sage / burgundy（默认 ivory）。
- 底部链接「开源字体与许可」→ `/fonts/licenses.html`。
- 偏好持久化键：`infinite-reader:prefs:v1` → `{readerFont, quoteFont, tilt, turnHintSeen, tiltHintSeen, desk, endpaper}`。

### 4.7 视角面板（252px）

3 个预设 chip：`Top-down`（tilt=0.02）/ `Default`（0.44）/ `Oblique`（0.9），下方滑块范围 **0 → 1.08**，作用于 three.js 相机俯仰角。

### 4.8 选区 / 高亮 / 笔记

选中正文文字 → 浮现浮动工具条 `.pop`：

- **高亮 / 下划线** 分段切换 `.seg`
- **颜色色板** `.swatches`（22px 圆点）：yellow `#ffe45c`、pink `#ff9cbc`、green `#9be58b`、blue `#8ccbff`、orange `#ffba70`、violet `#c9a8ff`
- **Ask Infinite**：紫色渐变 `linear-gradient(135deg,#7c5cff,#b46bff)`，高 34px、圆角 11px
- **加便签**
- 跨页选择时显示 `.selection-turn-hint`（提示翻页继续选）
- 选区用 `.pseudo-sel .sel-rect`（multiply 混合的赭色矩形）绘制——因为正文是 canvas 贴图，浏览器原生选区不可见

**便签（note-editor）**：像纸片贴在桌面/页边。

- 位置与旋转按百分比存储（`x*100`、`rot*1000`）
- 与原文之间用**虚线曲线** `.note-connectors path{stroke-dasharray:3 6}` + `.note-drag-handle` 连接
- 可拖动移动、右下角 `.note-resize-handle` 缩放
- 内容是 **Markdown**（textarea 实时渲染）
- 支持标签 `.note-tag`（最多 5 个，逗号分割）、4×14 文字色网格、笔记字体（inherit / 霞鹜文楷 / 马善政楷体 / 龙藏手写 / 志莽行书 / Caveat / 思源宋体 / 思源黑体，默认 wenkai），字号 `--note-font: 20px`
- 自动保存：输入去抖 350ms（新建 40ms），状态 `saving / saved / error`；失败进 outbox 队列重试，`beforeunload` 用 `navigator.sendBeacon` keepalive 兜底

批注数据模型（可直接照抄）：

```js
{
  id,
  kind: 'highlight' | 'underline' | 'note',
  color,
  locator: { chapter, start, end },   // 章节索引 + 字符偏移
  createdAt,
  note?: { text, x, y, rot, tags, textColor, font }
}
```

### 4.9 AI 面板（Infinite）

- 从右侧滑出，宽度 ≥ 440px；书整体左移让位。
- 顶部：当前书名 + 扩展/关闭。
- 未登录态：`你的阅读伙伴` + `登录后即可用 AI 探索本书，并保存对话记录。` + 登录按钮。
- 底部输入框 `询问这本书…`，支持中断生成（`send` / `stop` 图标切换）。
- 两种上下文：`kind: 'passage'`（针对选中段落，用伪选区高亮）与 `kind: 'book'`（整书问答）。
- 宣称回答会检索原文并标注出处页码。

## 五、交互实测结论

| 操作 | 反应 | 证据 |
| --- | --- | --- |
| `→` | 翻下一页（封面 → 序章跨页） | 实测 |
| `←` | 翻上一页 | 实测 |
| `↓` / 滚轮 | **无反应，不滚动** | 实测 + 容器 `overflow: hidden` |
| 其他按键 | `↑` `↓` `PageUp` `PageDown` `Home` `End` `Space` `T` 都在键盘集合里（Space 翻页，T 切视角） | 代码 |
| 点击正文文字区 | **不翻页**；容器 `pointer-events: none`，仅 `.text-layer.interactive` 时可选中文字 | CSS + 实测 |
| 点击画布左右区域 / 页角 | 由命中测试决定：右半页右侧/页角 = 下一页，左半页左侧 = 上一页，伴随页角 flutter 动画 | 代码 `pagePoint(1,.84,.02)` / `flutterCorner()` |
| 按住右键拖动 | 调整视角（不改阅读位置） | 实测 |
| `Alt` + 拖动 / 按 `T` | 同样调视角 / 切换预设 | 提示文案 |
| 点击插图 | 弹出图片预览 | 可达性树显示为 `button "预览图片：…"` |
| 点击「合上书籍」 | 合书动画 → 封面/书架 | 实测 |
| 页面切换方式 | **固定分页**，整本被切成 `pages[]`，一屏一个 spread，完全不可滚动 | `overflow: hidden` + `ArrowRight` 有效 + `paginate()` 返回 `pages[{chapter,start,end}]` |
| 移动端 | 窄屏走 `reflowTarget` 单页重排 + `phoneControls`（左右点击热区），位置存 `ir:phone-position:<user>:<bookId>` | 代码 |

## 六、原站技术栈证据

| 方向 | 结论 | 证据 |
| --- | --- | --- |
| 框架 | **React 19 + Vite（rolldown-vite）纯客户端 SPA**，无 SSR | `/<root>/assets/main-*.js`、`rolldown-runtime-*.js`、`__vite__mapDeps`、`vite:preloadError`；无 `/_next/`、无 `__NEXT_DATA__`、无 `nuxt`、无 `__sveltekit` |
| 路由 | 手写正则 `^\/book\/([^/]+)\/?$` + History `pushState/replaceState` | JS 源码 |
| 状态 | 自研 `createStore` + `useSyncExternalStore`，`window.__store` 可调试；无 Redux/Zustand | JS 源码 |
| 3D | **three.js WebGL** 渲染整本书与页面贴图 | 懒加载 `three.core-*.js`、`<canvas class="desk-canvas">` |
| 文字层 | DOM 中每个字是一个绝对定位 `<span class="w">`，`color: #0000; pointer-events: none`——只为选区/高亮命中服务，肉眼看到的字来自 canvas 贴图 | CSS 实测 |
| EPUB 解析 | **完全自研，未用 epub.js**：zip → OPF → spine → XHTML → 提取块级内容、图片、脚注、TOC | `loader-*.js` |
| 分页 | **自研测量式断行**：`paginate(parsed, layout, …)` → `pages[{chapter,start,end,special}]`，配套 `pageForOffset / pointForPage / pageToLeafTurned / leafCount`；定位为「章节索引 + 字符偏移」，非 CFI、非 CSS 分页 | `layout-*.js` |
| 字体 | 自托管 woff2，按 unicode-range 切片（EB Garamond、Noto Serif SC、Noto Sans SC、LXGW WenKai、ZCOOL XiaoWei、Ma Shan Zheng、Long Cang、Zhi Mang Xing、Caveat、Inter）；`fonts-*.js` 提供 `ensureBookFonts / readerFontFamily / quoteFontFamily`，换字体时等待字体加载完成再重排 | CSS/JS |
| 样式 | 手写 CSS + CSS 变量（`:root{--ink:#f4ead6; --accent:#f0b95a; --panel; --hair; --muted; --shadow; --ease}`）；毛玻璃 `backdrop-filter`；**无 Tailwind、无 framer-motion、无 Radix/shadcn** | className 为语义化 BEM-ish |
| 桌面材质 | webp 背景图（walnut/ash/ink/baize/stone），three.js 材质 `roughness` 0.88–1，`pale` 标记切浅色 UI | 资源清单 |
| 存储 | 偏好 `localStorage["infinite-reader:prefs:v1"]`；未登录书籍/文件/批注在 IndexedDB `infinite-reader`；书架布局 `localStorage["ir.shelf.layout"]`；登录后 REST + outbox 队列 `infinite-reader:outbox:v1` + `sendBeacon` 兜底 | JS 源码 |
| 导入 | 书架 `<input type="file" accept=".epub,application/epub+zip">` + 全窗口拖放遮罩（`Drop your EPUB on the desk`）；未登录提示 `Sign in to add a book.` | 实测 + 代码 |

## 七、登录 / 计费差异

站点**没有定价页、订阅或付费墙**，差异只在「登录 vs 未登录」：

| 能力 | 未登录（本地模式） | 登录 |
| --- | --- | --- |
| 示例书阅读 | 可 | 可 |
| 上传自有 EPUB | 不可 | 可 |
| 元数据提取（书名/作者/译者/出版社/ISBN） | — | 可 |
| 高亮与笔记 | IndexedDB 本地 | 云端同步 + 多设备 |
| AI 助手（问答/导图/slides/3D 图谱） | 仅登录引导 | 可 |
| 成本面板 | — | 仅内测邮箱可见的 `费用 · DEBUG` |

## 八、对我们的启示

1. **值得 1:1 复刻的部分**：双页 spread + 页眉页脚 + 首行缩进两端对齐 + 底部 dock 的按钮编排 + 340px 目录抽屉 + 360px 外观面板的 5×5 网格 + 6 色高亮 + 可拖动便签。
2. **不值得复刻的部分**：canvas 画字 + 透明文字层（我们改用 DOM 排版，见 ADR-002）、outbox 离线队列（单用户自用无必要）、AI 面板（非目标）。
3. **要补的缺口**：字号 / 行距 / 页边距控件；原站只有 zoom 与字体族。
4. **可直接照抄的数值**：桌面主题色值、6 种高亮色、面板尺寸（340/360/252px）、毛玻璃参数、批注数据模型。
