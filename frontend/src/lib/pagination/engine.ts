/**
 * 分页引擎。纯 TS，不依赖 Vue，也不假设任何具体排版结构——
 * 只要求 flow 里的块元素带 `data-chapter` / `data-offset`。
 *
 * 顺序纪律（design/02-architecture.md §4.2）：
 *   `字体就绪 → 几何设定 → 等一帧 → 测量 → 建索引 → 定位`
 * 任何一步提前，都会量到旧布局的尺寸。
 */

import {type BlockAnchor, blockForOffset, collectBlockAnchors, rangeForOffset} from './anchor'
import type {ReadingLayout} from './layout'

export interface PageAnchor {
    chapter: number
    offset: number
    page: number
}

export interface Coordinate {
    chapter: number
    offset: number
}

export interface Position extends Coordinate {
    page: number
}

export interface PaginateResult {
    columns: number
    spreads: number
    step: number
    spread: number
    durationMs: number
    anchorCount: number
}

export interface Typography {
    fontSize: number
    lineHeight: number
    fontFamily?: string
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
}

export class PaginationEngine {
    private layoutValue: ReadingLayout | null = null
    private stepValue = 0
    private columnsValue = 0
    private spreadIndex = 0
    private anchors: PageAnchor[] = []
    private blockAnchors: BlockAnchor[] = []
    /** 显式设定的阅读锚点。翻页会清空，重排会继承，避免「页首块」往返漂移 */
    private anchor: Coordinate | null = null

    constructor(private readonly flow: HTMLElement) {
    }

    get layout(): ReadingLayout | null {
        return this.layoutValue
    }

    get columns(): number {
        return this.columnsValue
    }

    get step(): number {
        return this.stepValue
    }

    get spread(): number {
        return this.spreadIndex
    }

    get spreads(): number {
        if (!this.layoutValue) return 0
        return Math.max(1, Math.ceil(this.columnsValue / this.layoutValue.SPREAD))
    }

    get anchorCount(): number {
        return this.anchors.length
    }

    /* ------------------------------------------------------------ 几何 */

    applyGeometry(layout: ReadingLayout): void {
        const style = this.flow.style
        // 宽度必须精确等于 SPREAD*PW + (SPREAD-1)*GAP，否则列宽会被浏览器重算
        style.width = `${layout.flowWidth}px`
        style.height = `${layout.flowHeight}px`
        style.columnWidth = `${layout.PW}px`
        style.columnGap = `${layout.GAP}px`
        style.columnFill = 'auto'
        style.overflow = 'visible'
        style.padding = '0'
        style.border = '0'
        style.setProperty('--pw', `${layout.PW}px`)
        style.setProperty('--ph', `${layout.PH}px`)
    }

    applyTypography(typography: Typography): void {
        const style = this.flow.style
        style.fontSize = `${typography.fontSize}px`
        style.lineHeight = String(typography.lineHeight)
        if (typography.fontFamily) style.fontFamily = typography.fontFamily
        style.textAlign = 'justify'
        style.setProperty('text-spacing-trim', 'trim-start')
        style.setProperty('hanging-punctuation', 'allow-end')
    }

    /* ------------------------------------------------------------ 重排 */

    async repaginate(layout: ReadingLayout, restore?: Coordinate | null): Promise<PaginateResult> {
        const started = performance.now()
        const saved = restore ?? this.anchor ?? (this.layoutValue ? this.currentPosition() : null)

        this.layoutValue = layout
        this.applyGeometry(layout)

        // 字体没加载完就测量必然偏；已加载时这个 promise 立即 resolve
        await document.fonts.ready
        await nextFrame()

        this.measure()
        this.buildIndex()

        const page = saved ? this.pageForOffset(saved.chapter, saved.offset) : 0
        const spread = this.showSpread(Math.floor(page / layout.SPREAD))
        // showSpread 会清空锚点，这里补回来：本次重排的参照点就是下一次的起点
        this.anchor = saved ? {chapter: saved.chapter, offset: saved.offset} : null

        return {
            columns: this.columnsValue,
            spreads: this.spreads,
            step: this.stepValue,
            spread,
            durationMs: Math.round(performance.now() - started),
            anchorCount: this.anchors.length,
        }
    }

    private measure(): void {
        if (!this.layoutValue) return
        const {GAP, STEP} = this.layoutValue
        this.stepValue = STEP

        this.blockAnchors = collectBlockAnchors(this.flow)

        // 多列容器的 scrollWidth 是全部列的总宽；但个别引擎在 overflow:visible 下
        // 只返回可视宽度，所以用「最后一个块所在的列」作兜底，取两者较大值。
        const byScroll = Math.round((this.flow.scrollWidth + GAP) / STEP)
        let byBlock = 1
        const last = this.blockAnchors[this.blockAnchors.length - 1]
        if (last) {
            const flowRect = this.flow.getBoundingClientRect()
            const rect = last.el.getBoundingClientRect()
            byBlock = Math.floor((rect.left - flowRect.left) / STEP) + 1
        }
        this.columnsValue = Math.max(1, byScroll, byBlock)
    }

    /**
     * 每个块测一次 rect 得到「块首在第几列」。
     * 不依赖 caretRangeFromPoint（Firefox 无此 API，遇图片返回 null）。
     */
    private buildIndex(): void {
        const step = this.stepValue
        if (!step) return

        if (!this.blockAnchors.length) this.blockAnchors = collectBlockAnchors(this.flow)
        const flowRect = this.flow.getBoundingClientRect()
        const anchors: PageAnchor[] = []

        for (const anchor of this.blockAnchors) {
            const rect = anchor.el.getBoundingClientRect()
            const xInFlow = rect.left - flowRect.left
            const page = Math.floor((xInFlow + step / 2) / step)
            anchors.push({
                chapter: anchor.chapter,
                offset: anchor.offset,
                page: Math.max(0, Math.min(page, this.columnsValue - 1)),
            })
        }
        this.anchors = anchors
    }

    /* ------------------------------------------------------------ 翻页 */

    showSpread(index: number): number {
        if (!this.layoutValue) return 0
        const max = this.spreads - 1
        const clamped = Math.max(0, Math.min(Math.round(index), max))
        this.spreadIndex = clamped
        // 手动翻页后，位置以当前页首为准，旧锚点作废
        this.anchor = null
        const offset = -clamped * this.stepValue * this.layoutValue.SPREAD
        this.flow.style.transform = `translate3d(${offset}px, 0, 0)`
        return clamped
    }

    /* ------------------------------------------------------------ 映射 */

    pageForOffset(chapter: number, offset: number): number {
        if (!this.anchors.length) return 0

        const anchors = this.anchors
        let lo = 0
        let hi = anchors.length - 1
        let best = 0
        while (lo <= hi) {
            const mid = (lo + hi) >> 1
            const anchor = anchors[mid]
            if (
                anchor.chapter < chapter ||
                (anchor.chapter === chapter && anchor.offset <= offset)
            ) {
                best = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }

        const anchor = anchors[best]
        if (anchor.chapter === chapter && anchor.offset === offset) return anchor.page

        // 段内偏移：只做一次精确测量
        const precise = this.pageOfChar(chapter, offset)
        if (precise < 0) return anchor.page
        return Math.max(anchor.page, precise)
    }

    offsetForPage(page: number): Position {
        const target = Math.max(0, page)
        // 不要简单取「第一个 page >= target 的块」：长段跨页时会直接跳到下一块，
        // 丢掉本页的段内位置；positionAtPage 会在跨页块内二分到本页首字符。
        return {...this.positionAtPage(target), page: target}
    }

    /** 某页起始处所属的章序号，用于页眉章名 */
    chapterAtPage(page: number): number {
        return this.offsetForPage(page).chapter
    }

    /** 当前 spread 左页首字符的坐标（有锚点时以锚点为准） */
    currentPosition(): Position {
        if (!this.layoutValue) return {chapter: 0, offset: 0, page: 0}
        if (this.anchor) {
            return {
                chapter: this.anchor.chapter,
                offset: this.anchor.offset,
                page: this.pageForOffset(this.anchor.chapter, this.anchor.offset),
            }
        }
        const page = this.spreadIndex * this.layoutValue.SPREAD
        const start = this.positionAtPage(page)
        return {...start, page}
    }

    /** 跳到某个字符偏移所在的 spread，返回落在第几页 */
    goTo(chapter: number, offset: number): Position {
        if (!this.layoutValue) return {chapter, offset, page: 0}
        const page = this.pageForOffset(chapter, offset)
        this.showSpread(Math.floor(page / this.layoutValue.SPREAD))
        this.anchor = {chapter, offset}
        return {chapter, offset, page}
    }

    /**
     * 某页第一个可见字符的坐标。页首不一定有块首：
     * 当上一页的长段横跨到本页时，在块内二分到第一个属于本页的字符。
     */
    private positionAtPage(page: number): Coordinate {
        if (!this.anchors.length) return {chapter: 0, offset: 0}

        let lo = 0
        let hi = this.anchors.length - 1
        let found = -1
        while (lo <= hi) {
            const mid = (lo + hi) >> 1
            if (this.anchors[mid].page >= page) {
                found = mid
                hi = mid - 1
            } else {
                lo = mid + 1
            }
        }
        if (found < 0) {
            const last = this.anchors[this.anchors.length - 1]
            return {chapter: last.chapter, offset: last.offset}
        }

        const first = this.anchors[found]
        if (first.page === page) return {chapter: first.chapter, offset: first.offset}

        const prevIndex = found - 1
        if (prevIndex < 0) return {chapter: first.chapter, offset: first.offset}

        const prev = this.anchors[prevIndex]
        const block = blockForOffset(this.blockAnchors, prev.chapter, prev.offset)
        if (!block || block.end <= block.offset) {
            return {chapter: first.chapter, offset: first.offset}
        }

        let left = block.offset
        let right = block.end - 1
        while (left < right) {
            const mid = (left + right) >> 1
            const pageOfMid = this.pageOfChar(block.chapter, mid)
            if (pageOfMid < 0) return {chapter: block.chapter, offset: block.offset}
            if (pageOfMid >= page) right = mid
            else left = mid + 1
        }
        return {chapter: block.chapter, offset: left}
    }

    /**
     * 单个字符落在第几列（测不到返回 -1）。
     * 注意：字符的 x 可能落在列内任意位置，不能像块矩形那样加 STEP/2 偏置，
     * 否则右半列的字符会被误判到下一列。
     */
    pageOfChar(chapter: number, offset: number): number {
        if (!this.stepValue) return -1
        const range = rangeForOffset(this.blockAnchors, chapter, offset)
        if (!range) return -1
        const rect = range.getBoundingClientRect()
        if (!rect.width && !rect.height) return -1
        const flowRect = this.flow.getBoundingClientRect()
        const xInFlow = rect.left - flowRect.left
        const page = Math.floor((xInFlow + 1) / this.stepValue)
        return Math.max(0, Math.min(page, this.columnsValue - 1))
    }

    /** 当前 spread 的页码（1 起），单页时 right 为 0 */
    pageNumbers(): { left: number; right: number } {
        if (!this.layoutValue) return {left: 1, right: 0}
        const start = this.spreadIndex * this.layoutValue.SPREAD
        return {
            left: start + 1,
            right: this.layoutValue.SPREAD === 2 ? start + 2 : 0,
        }
    }

    /** 某偏移处字符的屏幕矩形，用于验证「同一句话还在视口内」 */
    rangeRect(chapter: number, offset: number): DOMRect | null {
        const range = rangeForOffset(this.blockAnchors, chapter, offset)
        return range ? range.getBoundingClientRect() : null
    }

    /** 精确测量某个偏移所在的页（调试用，会触发 Range 测量） */
    locate(chapter: number, offset: number): Position {
        const page = this.pageForOffset(chapter, offset)
        const block = blockForOffset(this.blockAnchors, chapter, offset)
        return {chapter: block?.chapter ?? chapter, offset: block?.offset ?? offset, page}
    }
}

export type {LayoutPrefs, ReadingLayout} from './layout'
export {readingLayout} from './layout'
