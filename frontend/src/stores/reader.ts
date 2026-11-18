/**
 * 阅读器状态：下载 → 解析 → 引擎 → 翻页 / 重排 / 进度。
 *
 * 引擎是普通类实例（不是响应式对象），只在本模块闭包里持有；
 * 组件通过 `attach(flow, stage)` 把它挂到 DOM 上，再读 `view` 渲染。
 * 这样 Vue 的响应式只负责「展示状态」，分页计算仍然留在纯 TS 层。
 */

import {defineStore} from 'pinia'
import {computed, reactive, ref, shallowRef} from 'vue'

import {booksApi} from '@/api/books'
import {parseEpub} from '@/lib/epub'
import type {ParsedBook} from '@/lib/epub/types'
import type {Coordinate, PageMargin, PaginateResult, ReadingLayout} from '@/lib/pagination'
import {PaginationEngine, readingLayout} from '@/lib/pagination'
import {usePrefsStore} from './prefs'

export type ReaderPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface ReaderViewState {
    /** 0 起，与引擎 spread 一致 */
    spread: number
    spreads: number
    columns: number
    /** 左页页码，0 表示空白页（首列留白） */
    leftPage: number
    /** 右页页码，0 表示末屏无右页 */
    rightPage: number
    leftHeader: string
    rightHeader: string
    /** 当前阅读位置所属章名 */
    chapterTitle: string
    /** 0–1 */
    percent: number
    durationMs: number
    anchors: number
}

const EMPTY_VIEW: ReaderViewState = {
    spread: 0,
    spreads: 0,
    columns: 0,
    leftPage: 0,
    rightPage: 0,
    leftHeader: '',
    rightHeader: '',
    chapterTitle: '',
    percent: 0,
    durationMs: 0,
    anchors: 0,
}

export const useReaderStore = defineStore('reader', () => {
    const prefs = usePrefsStore()

    const bookId = ref('')
    const book = shallowRef<ParsedBook | null>(null)
    const layout = shallowRef<ReadingLayout | null>(null)
    const phase = ref<ReaderPhase>('idle')
    const message = ref('')
    const error = ref('')
    const view = reactive<ReaderViewState>({...EMPTY_VIEW})

    const canPrev = computed(() => view.spread > 0)
    const canNext = computed(() => view.spread < view.spreads - 1)

    let engine: PaginationEngine | null = null
    let flowEl: HTMLElement | null = null
    let stageEl: HTMLElement | null = null
    /** 每章在全书中的起始字符偏移，用于算进度百分比 */
    let chapterStarts: number[] = []
    /** 首列是否留白（决定页码奇偶）：1 表示第 1 页在右页 */
    let pageBase = 0
    let lastSize = ''

    const lang = computed(() => (book.value?.meta.language || 'zh').toLowerCase())

    function fontFamily(): string {
        // 英文书必须西文优先：U+2019 交给 CJK 字体会变成全角，出现 “it’ s”
        return lang.value.startsWith('en') ? 'var(--font-reader-latin)' : 'var(--font-reader)'
    }

    /** prefs 里叫 normal，layout 里叫 medium：只在这一层做一次翻译 */
    function marginId(): PageMargin {
        return prefs.prefs.pageMargin === 'normal' ? 'medium' : prefs.prefs.pageMargin
    }

    /* ---------------------------------------------------------------- 打开 */

    async function open(id: string): Promise<void> {
        if (bookId.value === id && (phase.value === 'ready' || phase.value === 'loading')) return
        reset()
        bookId.value = id
        phase.value = 'loading'
        message.value = '下载中…'

        try {
            const response = await fetch(booksApi.fileUrl(id))
            if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
            const blob = await response.blob()

            const parsed = await parseEpub(blob, {
                onProgress: (step) => {
                    message.value = step.message
                },
            })
            if (bookId.value !== id) {
                // 解析期间用户已经切走，直接释放
                parsed.revoke()
                return
            }

            book.value = parsed
            chapterStarts = []
            let sum = 0
            for (const chapter of parsed.chapters) {
                chapterStarts.push(sum)
                sum += chapter.charLength
            }
            message.value = '排版中…'
        } catch (err) {
            phase.value = 'error'
            error.value = err instanceof Error ? err.message : String(err)
            console.error('[reader] 打开失败', err)
        }
    }

    /* ---------------------------------------------------------------- 挂载 */

    async function attach(flow: HTMLElement, stage: HTMLElement): Promise<void> {
        if (!book.value) return
        flowEl = flow
        stageEl = stage
        engine = new PaginationEngine(flow)
        lastSize = ''
        await relayout(null)
        phase.value = 'ready'
        message.value = ''
    }

    function detach(): void {
        engine = null
        flowEl = null
        stageEl = null
    }

    function reset(): void {
        detach()
        book.value?.revoke()
        book.value = null
        layout.value = null
        chapterStarts = []
        pageBase = 0
        lastSize = ''
        Object.assign(view, EMPTY_VIEW)
        phase.value = 'idle'
        message.value = ''
        error.value = ''
        bookId.value = ''
    }

    /* ---------------------------------------------------------------- 重排 */

    async function relayout(restore?: Coordinate | null): Promise<PaginateResult | null> {
        if (!engine || !stageEl || !book.value) return null

        const rect = stageEl.getBoundingClientRect()
        if (!rect.width || !rect.height) return null
        lastSize = `${Math.round(rect.width)}x${Math.round(rect.height)}`

        const next = readingLayout(
            {
                fontSize: prefs.prefs.fontSize,
                lineHeight: prefs.prefs.lineHeight,
                margin: marginId(),
                spread: prefs.prefs.spread,
            },
            {width: rect.width, height: rect.height},
        )
        layout.value = next

        engine.applyTypography({
            fontSize: prefs.prefs.fontSize,
            lineHeight: prefs.prefs.lineHeight,
            fontFamily: fontFamily(),
        })

        // 首列留白由 CSS 按 data-spread 开关，必须在测量前落到 DOM 上（同帧，不经 Vue）
        flowEl?.setAttribute('data-spread', String(next.SPREAD))
        // 重排期间绝不能带翻页过渡
        flowEl?.classList.remove('is-turning')
        const result = await engine.repaginate(next, restore)

        // 首列留白是否生效：第 1 章首块落在第 1 列 ⇒ 第 1 页在右页
        pageBase = engine.pageForOffset(0, 0) >= 1 ? 1 : 0
        sync(result)
        return result
    }

    /** 视口尺寸变化时调用；尺寸没变则跳过（避免重复重排） */
    async function relayoutIfResized(): Promise<void> {
        if (!stageEl) return
        const rect = stageEl.getBoundingClientRect()
        const key = `${Math.round(rect.width)}x${Math.round(rect.height)}`
        if (key === lastSize) return
        await relayout()
    }

    function sync(result: PaginateResult): void {
        view.columns = result.columns
        view.spreads = result.spreads
        view.durationMs = result.durationMs
        view.anchors = result.anchorCount
        refreshView()
    }

    /* ---------------------------------------------------------------- 翻页 */

    function turn(delta: number): boolean {
        if (!engine || !layout.value) return false
        const target = engine.spread + delta
        if (target < 0 || target > engine.spreads - 1) return false
        engine.showSpread(target)
        refreshView()
        return true
    }

    /** 页码是「显示页码」：page 1 是正文第一页，可能是右页也可能是左页 */
    function goToPage(page: number): void {
        if (!engine || !layout.value) return
        const column = Math.max(0, page - 1 + pageBase)
        engine.showSpread(Math.floor(column / layout.value.SPREAD))
        refreshView()
    }

    function goFirst(): void {
        if (!engine) return
        engine.showSpread(0)
        refreshView()
    }

    function goLast(): void {
        if (!engine) return
        engine.showSpread(engine.spreads - 1)
        refreshView()
    }

    function goTo(chapter: number, offset: number): void {
        if (!engine) return
        engine.goTo(chapter, offset)
        refreshView()
    }

    function goToPercent(ratio: number): void {
        if (!engine || !book.value) return
        const target = Math.max(0, Math.min(1, ratio)) * book.value.totalChars
        for (let chapter = chapterStarts.length - 1; chapter >= 0; chapter -= 1) {
            if (chapterStarts[chapter] <= target) {
                goTo(chapter, Math.floor(target - chapterStarts[chapter]))
                return
            }
        }
        goTo(0, 0)
    }

    function currentCoordinate(): Coordinate {
        if (!engine) return {chapter: 0, offset: 0}
        const position = engine.currentPosition()
        return {chapter: position.chapter, offset: position.offset}
    }

    /* ---------------------------------------------------------------- 视图 */

    function pageNumber(column: number): number {
        return column + 1 - pageBase
    }

    function chapterTitleAt(column: number): string {
        if (!engine || !book.value) return ''
        const chapter = engine.chapterAtPage(Math.max(0, column))
        return book.value.chapters[chapter]?.title ?? ''
    }

    function percentAt(chapter: number, offset: number): number {
        const total = book.value?.totalChars ?? 0
        if (!total) return 0
        const base = chapterStarts[chapter] ?? 0
        return Math.max(0, Math.min(1, (base + offset) / total))
    }

    function refreshView(): void {
        if (!engine || !layout.value || !book.value) return
        const spread = engine.spread
        const SPREAD = layout.value.SPREAD
        const base = spread * SPREAD
        // 末屏可能只有左页：右侧列不存在时页码留空，不虚构一页
        const leftColumn = base < view.columns ? base : -1
        const rightColumn = SPREAD === 2 && base + 1 < view.columns ? base + 1 : -1

        view.spread = spread
        view.leftPage = leftColumn >= 0 ? pageNumber(leftColumn) : 0
        view.rightPage = rightColumn >= 0 ? pageNumber(rightColumn) : 0
        if (SPREAD === 2) {
            view.leftHeader = view.leftPage > 0 ? book.value.meta.title : ''
            view.rightHeader = view.rightPage > 0 ? chapterTitleAt(base + 1) : ''
        } else {
            // 单页时左栏就是唯一一页，页眉给章名
            view.leftHeader = chapterTitleAt(base)
            view.rightHeader = ''
        }
        const position = engine.currentPosition()
        view.chapterTitle = book.value.chapters[position.chapter]?.title ?? ''
        view.percent = percentAt(position.chapter, position.offset)
    }

    /** 只读探针：给自动化验收与控制台排查用，不参与渲染 */
    const probe = {
        get engine(): PaginationEngine | null {
            return engine
        },
        get flow(): HTMLElement | null {
            return flowEl
        },
        get stage(): HTMLElement | null {
            return stageEl
        },
        get pageBase(): number {
            return pageBase
        },
    }

    return {
        bookId,
        book,
        layout,
        phase,
        message,
        error,
        view,
        canPrev,
        canNext,
        probe,
        open,
        attach,
        detach,
        reset,
        relayout,
        relayoutIfResized,
        turn,
        goToPage,
        goFirst,
        goLast,
        goTo,
        goToPercent,
        currentCoordinate,
    }
})
