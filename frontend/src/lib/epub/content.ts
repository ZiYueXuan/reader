/**
 * XHTML → Block[]。
 *
 * 清洗策略是白名单式的：只把已知块级标签提成 Block，其余行内标签的文本合并进所在块。
 * 空段落直接丢弃，避免空行占掉版面高度。
 *
 * 偏移计算：块内字符数 = `Block.text.length`，因此**渲染时必须原样输出 `text`**，
 * 不能再用 CSS 制造额外文字（如 `::before { content: '•' }` 会给列表项加上不存在的字符）。
 */

import type {Block, BlockType} from './types'
import {dirname, type EpubArchive, isExternalUrl, resolveHref} from './unzip'

const SKIP_TAGS = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'svg',
    'math',
    'noscript',
    'template',
    'head',
    'link',
    'meta',
    'title',
    'audio',
    'video',
    'canvas',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'nav',
    'map',
    'area',
])

/** 能把内容提成独立 Block 的标签；不在其中的一律按行内处理 */
const BLOCK_TAGS = new Set([
    'p',
    'pre',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'ul',
    'ol',
    'li',
    'figcaption',
    'hr',
    'img',
    'dl',
    'dt',
    'dd',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'div',
    'section',
    'article',
    'aside',
    'header',
    'footer',
    'main',
    'figure',
    'center',
    'address',
])

const HEADING_MAP: Record<string, BlockType> = {
    h1: 'h1',
    h2: 'h2',
    h3: 'h3',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
}

const NOISE_NAME_RE = /(pagenum|page-number|pagebreak)/i
const NOISE_EPUB_TYPES = new Set(['pagebreak', 'toc', 'landmarks', 'page-list'])

const LIST_TAGS = new Set(['ul', 'ol'])

function localName(el: Element): string {
    return (el.localName ?? el.nodeName).toLowerCase()
}

/** 归一化空白：软连字符删除，所有空白折叠成单个半角空格 */
export function normalizeText(raw: string): string {
    return raw.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim()
}

function isNoise(el: Element): boolean {
    const epubType =
        el.getAttribute('epub:type') ??
        el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ??
        ''
    if (epubType && epubType.split(/\s+/).some((type) => NOISE_EPUB_TYPES.has(type))) {
        return true
    }
    if (el.id && NOISE_NAME_RE.test(el.id)) return true
    const className = el.getAttribute('class')
    return Boolean(className && NOISE_NAME_RE.test(className))
}

/** 拍平一个元素内的全部行内文本，跳过脚本样式与图片 */
function inlineText(el: Element): string {
    let out = ''
    const visit = (node: Node): void => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                out += child.nodeValue ?? ''
                continue
            }
            if (child.nodeType !== Node.ELEMENT_NODE) continue
            const element = child as Element
            const tag = localName(element)
            if (SKIP_TAGS.has(tag)) continue
            if (tag === 'br') {
                out += ' '
                continue
            }
            if (tag === 'img') continue
            visit(element)
        }
    }
    visit(el)
    return normalizeText(out)
}

/** 列表项自身的文本：排除嵌套列表，避免父项吞掉子项文字 */
function ownText(li: Element): string {
    let out = ''
    for (const child of Array.from(li.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            out += child.nodeValue ?? ''
            continue
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue
        const el = child as Element
        if (LIST_TAGS.has(localName(el))) continue
        if (SKIP_TAGS.has(localName(el))) continue
        out += inlineText(el)
    }
    return normalizeText(out)
}

function findBody(doc: Document): Element | null {
    if (doc.body) return doc.body
    const all = doc.getElementsByTagName('*')
    for (let i = 0; i < all.length; i += 1) {
        if (localName(all[i]) === 'body') return all[i]
    }
    return null
}

function guessMime(path: string): string {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    switch (ext) {
        case 'png':
            return 'image/png'
        case 'gif':
            return 'image/gif'
        case 'webp':
            return 'image/webp'
        case 'svg':
        case 'svgz':
            return 'image/svg+xml'
        case 'bmp':
            return 'image/bmp'
        case 'avif':
            return 'image/avif'
        default:
            return 'image/jpeg'
    }
}

/* ------------------------------------------------------------------ 图片缓存 */

export interface ImageAsset {
    url: string
    width?: number
    height?: number
}

export class ImageStore {
    private cache = new Map<string, Promise<ImageAsset | null>>()
    private ownedUrls: string[] = []
    private loaded = 0

    constructor(
        private readonly archive: EpubArchive,
        private readonly mediaTypes: Map<string, string>,
    ) {
    }

    /** 已经成功转成 blob URL 的图片数量 */
    get size(): number {
        return this.loaded
    }

    load(path: string): Promise<ImageAsset | null> {
        const cached = this.cache.get(path)
        if (cached) return cached
        const task = this.create(path)
        this.cache.set(path, task)
        return task
    }

    private async create(path: string): Promise<ImageAsset | null> {
        if (isExternalUrl(path)) return {url: path}
        try {
            const blob = await this.archive.blob(path, this.mediaTypes.get(path) ?? guessMime(path))
            const url = URL.createObjectURL(blob)
            this.ownedUrls.push(url)
            this.loaded += 1
            const size = await measureImage(url)
            return size ? {url, ...size} : {url}
        } catch (err) {
            console.warn('[epub] 图片读取失败', path, err)
            return null
        }
    }

    revoke(): void {
        for (const url of this.ownedUrls) URL.revokeObjectURL(url)
        this.ownedUrls = []
        this.cache.clear()
        this.loaded = 0
    }
}

function measureImage(url: string): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
            const {naturalWidth: width, naturalHeight: height} = img
            resolve(width > 0 && height > 0 ? {width, height} : null)
        }
        img.onerror = () => resolve(null)
        img.src = url
    })
}

/* ------------------------------------------------------------------ 抽块 */

export interface ContentContext {
    archive: EpubArchive
    mediaTypes: Map<string, string>
    images: ImageStore
}

export interface ExtractedChapter {
    blocks: Block[]
    /** 元素的 id → 章内字符偏移，给 nav 的 #fragment 定位用 */
    idOffsets: Map<string, number>
    charLength: number
}

interface ListState {
    style: 'ul' | 'ol'
    index: number
}

class ChapterExtractor {
    readonly blocks: Block[] = []
    readonly idOffsets = new Map<string, number>()
    private offset = 0
    private pending: Array<{ block: Block; path: string }> = []

    constructor(private readonly ctx: ContentContext, private readonly baseDir: string) {
    }

    get charLength(): number {
        return this.offset
    }

    run(root: Element): void {
        if (root.id) this.idOffsets.set(root.id, 0)
        this.walkContainer(root)
    }

    async settleImages(): Promise<void> {
        await Promise.all(
            this.pending.map(async ({block, path}) => {
                const asset = await this.ctx.images.load(path)
                if (!asset) return
                block.src = asset.url
                if (block.width === undefined && asset.width && asset.height) {
                    block.width = asset.width
                    block.height = asset.height
                }
            }),
        )
        this.pending = []
    }

    private push(type: BlockType, text: string, el: Element | null, extra: Partial<Block> = {}): void {
        const clean = normalizeText(text)
        if (!clean && type !== 'img' && type !== 'hr') return
        const start = this.offset
        this.blocks.push({
            type,
            text: clean,
            offset: start,
            endOffset: start + clean.length,
            ...extra,
        })
        if (el) this.recordIds(el, start)
        this.offset = start + clean.length
    }

    /** 元素（含子孙）的 id 一律映射到块首偏移，目录跳转才会落在块开头 */
    private recordIds(el: Element, at: number): void {
        if (el.id) this.idOffsets.set(el.id, at)
        for (const child of Array.from(el.querySelectorAll('[id]'))) {
            if (child.id) this.idOffsets.set(child.id, at)
        }
    }

    private walkContainer(owner: Element, list?: ListState): void {
        let buffer = ''
        const flush = (): void => {
            const text = normalizeText(buffer)
            buffer = ''
            if (text) this.push('p', text, null)
        }

        for (const child of Array.from(owner.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                buffer += child.nodeValue ?? ''
                continue
            }
            if (child.nodeType !== Node.ELEMENT_NODE) continue
            const el = child as Element
            const tag = localName(el)
            if (SKIP_TAGS.has(tag) || isNoise(el)) continue
            if (tag === 'br') {
                buffer += ' '
                continue
            }
            if (!BLOCK_TAGS.has(tag)) {
                buffer += inlineText(el)
                continue
            }
            flush()
            this.emitBlock(el, tag, list)
        }
        flush()
    }

    private emitBlock(el: Element, tag: string, list?: ListState): void {
        if (el.id) this.idOffsets.set(el.id, this.offset)

        if (HEADING_MAP[tag]) {
            this.push(HEADING_MAP[tag], inlineText(el), el)
            return
        }

        switch (tag) {
            case 'p':
            case 'pre':
            case 'dt':
            case 'dd':
            case 'td':
            case 'th': {
                const text = inlineText(el)
                if (text) this.push('p', text, el)
                this.emitNestedImages(el)
                break
            }
            case 'blockquote':
                if (this.hasBlockChild(el)) this.walkContainer(el, list)
                else this.push('blockquote', inlineText(el), el)
                break
            case 'ul':
            case 'ol':
                this.walkContainer(el, {style: tag === 'ol' ? 'ol' : 'ul', index: 0})
                break
            case 'li':
                this.emitListItem(el, list ?? {style: 'ul', index: 0})
                break
            case 'figcaption':
                this.push('figcaption', inlineText(el), el)
                break
            case 'hr':
                this.push('hr', '', el)
                break
            case 'img':
                this.emitImage(el)
                break
            case 'tr': {
                const cells = Array.from(el.children)
                    .map((cell) => inlineText(cell))
                    .filter(Boolean)
                if (cells.length) this.push('p', cells.join(' '), el)
                break
            }
            default:
                // figure / div / section / article / dl / table 等容器：继续往下走
                this.walkContainer(el, list)
        }
    }

    private emitListItem(li: Element, list: ListState): void {
        const text = ownText(li)
        const marker = list.style === 'ol' ? `${list.index + 1}.` : '•'
        list.index += 1
        if (text) this.push('li', text, li, {listStyle: list.style, marker})
        this.emitNestedImages(li)

        for (const child of Array.from(li.children)) {
            const tag = localName(child)
            if (tag === 'ul' || tag === 'ol') {
                this.walkContainer(child, {style: tag === 'ol' ? 'ol' : 'ul', index: 0})
            }
        }
    }

    private emitNestedImages(el: Element): void {
        for (const img of Array.from(el.querySelectorAll('img'))) {
            this.emitImage(img)
        }
    }

    private emitImage(img: Element): void {
        const src = img.getAttribute('src')
        if (!src) return
        const block: Block = {
            type: 'img',
            text: '',
            offset: this.offset,
            endOffset: this.offset,
            alt: img.getAttribute('alt')?.trim() || undefined,
        }
        const width = Number(img.getAttribute('width') ?? 0)
        const height = Number(img.getAttribute('height') ?? 0)
        if (width > 0 && height > 0) {
            block.width = width
            block.height = height
        }
        if (img.id) this.idOffsets.set(img.id, this.offset)
        this.blocks.push(block)
        this.pending.push({
            block,
            path: isExternalUrl(src) ? src : resolveHref(this.baseDir, src),
        })
    }

    private hasBlockChild(el: Element): boolean {
        return Array.from(el.children).some((child) => BLOCK_TAGS.has(localName(child)))
    }
}

export async function extractChapter(
    doc: Document,
    xhtmlPath: string,
    ctx: ContentContext,
): Promise<ExtractedChapter> {
    const root = findBody(doc) ?? doc.documentElement
    const extractor = new ChapterExtractor(ctx, dirname(xhtmlPath))
    extractor.run(root)
    await extractor.settleImages()
    return {
        blocks: extractor.blocks,
        idOffsets: extractor.idOffsets,
        charLength: extractor.charLength,
    }
}
