<script setup lang="ts">
/**
 * 分页引擎实测页（仅 DEV 注册）。
 *
 * 它同时是 Phase 4 阅读器的预演：一次性把整本书铺进 CSS columns，
 * 用引擎算列、建索引、翻页，并把「页数 / STEP / PW / PH / 重排耗时」摊在面板上。
 *
 * 三个自检按钮对应 design/03-tasklist.md Phase 3 的三条验收。
 */

import {computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef} from 'vue'

import {booksApi, type BookSummary} from '@/api/books'
import {type Block, type ParsedBook, parseEpub} from '@/lib/epub'
import {
    type LayoutPrefs,
    type PageMargin,
    type PaginateResult,
    PaginationEngine,
    type ReadingLayout,
    readingLayout,
} from '@/lib/pagination'

const books = ref<BookSummary[]>([])
const currentId = ref('')
const parsed = shallowRef<ParsedBook | null>(null)
const layout = shallowRef<ReadingLayout | null>(null)

const prefs = reactive<LayoutPrefs>({
    fontSize: 17,
    lineHeight: 1.9,
    margin: 'medium',
    spread: true,
})

const stageWidth = ref<'auto' | number>('auto')
const busy = ref(false)
const progress = ref('')
const failure = ref<string | null>(null)
const hasEngine = ref(false)

const stageEl = ref<HTMLElement | null>(null)
const flowEl = ref<HTMLElement | null>(null)
const viewportEl = ref<HTMLElement | null>(null)

let engine: PaginationEngine | null = null
let resizeObserver: ResizeObserver | null = null
let resizeTimer: number | undefined
let lastSize = ''
let testing = false

const stats = reactive({
    columns: 0,
    spreads: 0,
    spread: 0,
    step: 0,
    duration: 0,
    anchors: 0,
})

const pageNumbers = ref({left: 1, right: 2})
const position = ref({chapter: 0, offset: 0})
const headerLeft = ref('')
const headerRight = ref('')

interface TestResult {
    name: string
    pass: boolean
    detail: string
}

const testResults = ref<TestResult[]>([])

const chapterOptions = computed(() =>
    (parsed.value?.chapters ?? []).map((chapter) => ({
        index: chapter.index,
        title: chapter.title ?? `第 ${chapter.index + 1} 节`,
    })),
)
const jumpChapter = ref(0)

const widthOptions: Array<'auto' | number> = ['auto', 1920, 1440, 1280]
const marginOptions: Array<{ id: PageMargin; text: string }> = [
    {id: 'narrow', text: '窄'},
    {id: 'medium', text: '中'},
    {id: 'wide', text: '宽'},
]

const stageStyle = computed(() =>
    stageWidth.value === 'auto' ? {width: '100%'} : {width: `${stageWidth.value}px`},
)

const bookStyle = computed(() => {
    if (!layout.value) return {}
    return {width: `${layout.value.bookWidth}px`, height: `${layout.value.bookHeight}px`}
})

const parity = computed(() => {
    if (!stats.columns) return '—'
    return stats.columns % 2 === 0 ? '偶数 ✓' : '奇数（末页单页）'
})

/* ------------------------------------------------------------------ 加载 */

onMounted(async () => {
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    if (stageEl.value) {
        resizeObserver = new ResizeObserver(onResize)
        resizeObserver.observe(stageEl.value)
    }
    try {
        books.value = await booksApi.list()
        currentId.value = books.value[0]?.id ?? ''
    } catch (err) {
        failure.value = `书架读取失败：${err instanceof Error ? err.message : String(err)}`
    }

    // 方便自动化脚本与控制台排查
    ;(window as unknown as Record<string, unknown>).__pg = {
        get engine() {
            return engine
        },
        get parsed() {
            return parsed.value
        },
        get layout() {
            return layout.value
        },
        get prefs() {
            return prefs
        },
        pageOf: (chapter: number, offset: number) => engine?.pageForOffset(chapter, offset) ?? -1,
        charPageOf: (chapter: number, offset: number) => engine?.pageOfChar(chapter, offset) ?? -1,
        relayout: async (restore: { chapter: number; offset: number } | null = null) => {
            await relayout(restore)
            return engine?.currentPosition() ?? null
        },
        turn: (delta: number) => {
            turn(delta)
            return engine?.currentPosition() ?? null
        },
    }
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    window.clearTimeout(resizeTimer)
    resizeObserver?.disconnect()
    parsed.value?.revoke()
    engine = null
    hasEngine.value = false
})

async function openBook(): Promise<void> {
    const book = books.value.find((item) => item.id === currentId.value)
    if (!book || busy.value) return

    busy.value = true
    failure.value = null
    progress.value = '下载中…'
    parsed.value?.revoke()
    parsed.value = null
    engine = null
    hasEngine.value = false
    layout.value = null
    testResults.value = []
    await nextTick()

    try {
        const response = await fetch(booksApi.fileUrl(book.id))
        if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
        const blob = await response.blob()

        const result = await parseEpub(blob, {
            onProgress: (step) => {
                progress.value = step.message
            },
        })
        parsed.value = result

        const stage = stageEl.value
        if (!stage) throw new Error('舞台未就绪')
        layout.value = readingLayout(prefs, {
            width: stage.clientWidth,
            height: stage.clientHeight,
        })
        await nextTick()

        if (!flowEl.value) throw new Error('flow 未渲染')
        engine = new PaginationEngine(flowEl.value)
        hasEngine.value = true
        lastSize = ''
        await relayout(null)
        jumpChapter.value = 0
    } catch (err) {
        failure.value = err instanceof Error ? err.message : String(err)
        console.error('[pagination] 打开失败', err)
    } finally {
        busy.value = false
        progress.value = ''
    }
}

/* ------------------------------------------------------------------ 重排 */

async function relayout(restore: { chapter: number; offset: number } | null): Promise<void> {
    const stage = stageEl.value
    if (!engine || !stage) return

    lastSize = `${stage.clientWidth}x${stage.clientHeight}`
    const next = readingLayout(prefs, {width: stage.clientWidth, height: stage.clientHeight})
    layout.value = next
    const lang = (parsed.value?.meta.language || 'zh').toLowerCase()
    engine.applyTypography({
        fontSize: prefs.fontSize,
        lineHeight: prefs.lineHeight,
        // 英文书必须西文优先：U+2019 交给 CJK 字体就会变成 1em 全角，出现 “it’ s”
        fontFamily: lang.startsWith('en') ? 'var(--font-reader-latin)' : 'var(--font-reader)',
    })

    const result = await engine.repaginate(next, restore)
    sync(result)
    console.info('[pagination] 重排', {
        columns: result.columns,
        spreads: result.spreads,
        spread: result.spread,
        PW: next.PW,
        PH: next.PH,
        STEP: next.STEP,
        SPREAD: next.SPREAD,
        durationMs: result.durationMs,
    })
}

function sync(result: PaginateResult): void {
    const currentLayout = layout.value
    const currentParsed = parsed.value
    if (!engine || !currentLayout || !currentParsed) return

    stats.columns = result.columns
    stats.spreads = result.spreads
    stats.spread = result.spread
    stats.step = result.step
    stats.duration = result.durationMs
    stats.anchors = result.anchorCount

    pageNumbers.value = engine.pageNumbers()
    const current = engine.currentPosition()
    position.value = {chapter: current.chapter, offset: current.offset}

    const spreadStart = result.spread * currentLayout.SPREAD
    headerLeft.value = currentParsed.meta.title
    const headIndex = currentLayout.SPREAD === 2 ? spreadStart + 1 : spreadStart
    headerRight.value = currentParsed.chapters[engine.chapterAtPage(headIndex)]?.title ?? ''
}

function syncCurrent(): void {
    if (!engine) return
    sync({
        columns: engine.columns,
        spreads: engine.spreads,
        step: engine.step,
        spread: engine.spread,
        durationMs: stats.duration,
        anchorCount: engine.anchorCount,
    })
}

function onResize(): void {
    if (testing || !engine) return
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
        const stage = stageEl.value
        if (!stage || !engine) return
        const key = `${stage.clientWidth}x${stage.clientHeight}`
        if (key === lastSize) return
        void relayout(engine.currentPosition())
    }, 150)
}

/* ------------------------------------------------------------------ 控制 */

async function applyPrefs(patch: Partial<LayoutPrefs>): Promise<void> {
    if (!engine) return
    const restore = engine.currentPosition()
    Object.assign(prefs, patch)
    await relayout(restore)
}

async function setMargin(margin: PageMargin): Promise<void> {
    await applyPrefs({margin})
}

async function setStageWidth(width: 'auto' | number): Promise<void> {
    if (!engine) return
    const restore = engine.currentPosition()
    stageWidth.value = width
    await nextTick()
    await relayout(restore)
}

function turn(delta: number): void {
    if (!engine) return
    engine.showSpread(engine.spread + delta)
    syncCurrent()
}

function goHome(): void {
    engine?.showSpread(0)
    syncCurrent()
}

function goEnd(): void {
    if (!engine) return
    engine.showSpread(engine.spreads - 1)
    syncCurrent()
}

function jumpToChapter(): void {
    if (!engine) return
    engine.goTo(jumpChapter.value, 0)
    syncCurrent()
}

function onKeydown(event: KeyboardEvent): void {
    if (!engine) return
    const target = event.target as HTMLElement | null
    if (target && ['SELECT', 'INPUT', 'TEXTAREA'].includes(target.tagName)) return

    switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
            event.preventDefault()
            turn(1)
            break
        case 'ArrowLeft':
        case 'PageUp':
            event.preventDefault()
            turn(-1)
            break
        case 'Home':
            event.preventDefault()
            goHome()
            break
        case 'End':
            event.preventDefault()
            goEnd()
            break
        default:
            break
    }
}

/* ------------------------------------------------------------------ 自检 */

interface Sample {
    label: string
    chapter: number
    offset: number
    page: number
    visible: boolean
}

function offsetVisible(chapter: number, offset: number): boolean {
    if (!engine || !layout.value) return false
    const page = engine.pageForOffset(chapter, offset)
    const start = engine.spread * layout.value.SPREAD
    const pageOnScreen = page >= start && page < start + layout.value.SPREAD
    const rect = engine.rangeRect(chapter, offset)
    const box = viewportEl.value?.getBoundingClientRect()
    if (!rect || !box) return pageOnScreen

    // 用字符中心点判定：行框下缘可能溢出可视区几个像素
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const inside = cx >= box.left - 1 && cx <= box.right + 1 && cy >= box.top - 1 && cy <= box.bottom + 1
    return pageOnScreen && inside
}

function pushResult(name: string, pass: boolean, samples: Sample[], extra = ''): void {
    const detail = samples
        .map(
            (sample) =>
                `${sample.label} → ch${sample.chapter}@${sample.offset} / p${sample.page + 1}${
                    sample.visible ? '' : '（不可见）'
                }`,
        )
        .join(' · ')
    testResults.value = [{name, pass, detail: extra ? `${detail}｜${extra}` : detail}]
}

async function testFontRoundTrip(): Promise<void> {
    const pagination = engine
    const book = parsed.value
    if (!pagination || !book) return
    testing = true

    const chapter = Math.min(2, book.chapters.length - 1)
    const target = {chapter, offset: 260}
    pagination.goTo(target.chapter, target.offset)
    syncCurrent()

    const samples: Sample[] = []
    const capture = (label: string): Sample => ({
        label,
        chapter: pagination.currentPosition().chapter,
        offset: pagination.currentPosition().offset,
        page: pagination.pageForOffset(target.chapter, target.offset),
        visible: offsetVisible(target.chapter, target.offset),
    })

    try {
        samples.push(capture(`${prefs.fontSize}px`))
        for (const size of [15, 17, 19, 17]) {
            prefs.fontSize = size
            // 固定锚点：模拟“读者停在同一位置”，不拿页首块链式传递
            await relayout(target)
            samples.push(capture(`${size}px`))
        }

        const baseline = samples[0]
        const final = samples[samples.length - 1]
        const visible = samples.every((sample) => sample.visible)
        const finalSame = final.page === baseline.page
        pushResult(
            '字号 15→17→19→17',
            visible && finalSame,
            samples,
            finalSame
                ? `锚点 ch${target.chapter}@${target.offset} 全程可见，回到 17px 页码一致`
                : `回到 17px 页码 ${final.page + 1} ≠ ${baseline.page + 1}`,
        )
    } finally {
        testing = false
    }
}

async function testViewportWidth(): Promise<void> {
    const pagination = engine
    const book = parsed.value
    if (!pagination || !book) return
    testing = true

    const target = {chapter: Math.min(2, book.chapters.length - 1), offset: 260}
    const samples: Sample[] = []

    try {
        for (const width of [1920, 1440, 1280, 1920]) {
            stageWidth.value = width
            await nextTick()
            await relayout(target)
            samples.push({
                label: `${width}px`,
                chapter: pagination.currentPosition().chapter,
                offset: pagination.currentPosition().offset,
                page: pagination.pageForOffset(target.chapter, target.offset),
                visible: offsetVisible(target.chapter, target.offset),
            })
        }

        const baseline = samples[0]
        const final = samples[samples.length - 1]
        pushResult(
            '视口 1920→1440→1280→1920',
            final.page === baseline.page && samples.every((sample) => sample.visible),
            samples,
            `锚点 ch${target.chapter}@${target.offset}`,
        )
    } finally {
        testing = false
    }
}

async function testStability(): Promise<void> {
    const pagination = engine
    if (!pagination) return
    testing = true

    const restore = pagination.currentPosition()
    const counts: number[] = []
    const durations: number[] = []

    try {
        for (let index = 0; index < 3; index += 1) {
            await relayout(restore)
            counts.push(stats.columns)
            durations.push(stats.duration)
        }
        const stable = counts.every((count) => count === counts[0])
        testResults.value = [
            {
                name: '重排稳定性 ×3',
                pass: stable,
                detail: `页数 ${counts.join(' / ')}｜耗时 ${durations.join(' / ')} ms｜${parity.value}`,
            },
        ]
    } finally {
        testing = false
    }
}

/* ------------------------------------------------------------------ 渲染辅助 */

/** 校验核心不变量：块元素的 textContent 与 Block.text 逐字相同 */
async function testTextInvariant(): Promise<void> {
    const book = parsed.value
    const flow = flowEl.value
    if (!book || !flow) return

    const broken: string[] = []
    let checked = 0

    for (const chapter of book.chapters) {
        for (let index = 0; index < chapter.blocks.length; index += 1) {
            const block = chapter.blocks[index]
            const el = flow.querySelector<HTMLElement>(
                `[data-chapter="${chapter.index}"][data-block="${index}"]`,
            )
            checked += 1
            if (!el) {
                broken.push(`ch${chapter.index}#${index} 缺元素`)
            } else if ((el.textContent ?? '') !== block.text) {
                broken.push(
                    `ch${chapter.index}#${index} dom=${(el.textContent ?? '').length} 模型=${block.text.length}`,
                )
            }
            if (broken.length >= 5) break
        }
        if (broken.length >= 5) break
    }

    testResults.value = [
        {
            name: '文本不变量 DOM textContent ≡ Block.text',
            pass: broken.length === 0,
            detail:
                broken.length === 0
                    ? `核对 ${checked} 个块，逐字一致`
                    : `共 ${broken.length} 处不一致：${broken.join('；')}`,
        },
    ]
}

function chromeStyle(column: number): Record<string, string> {
    if (!layout.value) return {}
    const {margins, STEP, PW, headerH} = layout.value
    return {
        left: `${margins.x + column * STEP}px`,
        top: `${margins.y}px`,
        width: `${PW}px`,
        height: `${headerH}px`,
    }
}

function folioStyle(column: number): Record<string, string> {
    if (!layout.value) return {}
    const {margins, STEP, PW, PH, headerH, footerH} = layout.value
    return {
        left: `${margins.x + column * STEP}px`,
        top: `${margins.y + headerH + PH}px`,
        width: `${PW}px`,
        height: `${footerH}px`,
    }
}

const viewportStyle = computed(() => {
    if (!layout.value) return {}
    const {margins, headerH, flowWidth, flowHeight} = layout.value
    return {
        left: `${margins.x}px`,
        top: `${margins.y + headerH}px`,
        width: `${flowWidth}px`,
        height: `${flowHeight}px`,
    }
})

const spineStyle = computed(() => {
    if (!layout.value) return {}
    const {margins, pageWidth, GAP} = layout.value
    return {left: `${margins.x + pageWidth}px`, width: `${GAP}px`}
})

function imgStyle(block: Block): Record<string, string> {
    return block.width && block.height ? {aspectRatio: `${block.width} / ${block.height}`} : {}
}

function blockClass(block: Block): string[] {
    return ['b', `b-${block.type}`]
}
</script>

<template>
    <div class="debug">
        <aside class="panel">
            <p class="eyebrow">DEV · PAGINATION</p>
            <h1>分页引擎</h1>

            <section class="group">
                <label class="label">书籍</label>
                <select v-model="currentId" :disabled="busy">
                    <option v-for="book in books" :key="book.id" :value="book.id">
                        {{ book.title }}
                    </option>
                </select>
                <button class="primary" :disabled="busy || !currentId" @click="openBook">
                    {{ busy ? '处理中…' : '打开并排版' }}
                </button>
                <p v-if="progress" class="muted">{{ progress }}</p>
            </section>

            <section v-if="hasEngine" class="group">
                <label class="label">字号</label>
                <div class="row">
                    <button
                        v-for="size in [15, 17, 19, 21]"
                        :key="size"
                        class="chip"
                        :class="{active: prefs.fontSize === size}"
                        @click="applyPrefs({fontSize: size})"
                    >
                        {{ size }}
                    </button>
                </div>

                <label class="label">行距</label>
                <div class="row">
                    <button
                        v-for="height in [1.7, 1.9, 2.1]"
                        :key="height"
                        class="chip"
                        :class="{active: prefs.lineHeight === height}"
                        @click="applyPrefs({lineHeight: height})"
                    >
                        {{ height }}
                    </button>
                </div>

                <label class="label">页边距</label>
                <div class="row">
                    <button
                        v-for="item in marginOptions"
                        :key="item.id"
                        class="chip"
                        :class="{active: prefs.margin === item.id}"
                        @click="setMargin(item.id)"
                    >
                        {{ item.text }}
                    </button>
                </div>

                <label class="label">版式 / 视口</label>
                <div class="row">
                    <button class="chip" :class="{active: prefs.spread}" @click="applyPrefs({spread: true})">
                        双页
                    </button>
                    <button class="chip" :class="{active: !prefs.spread}" @click="applyPrefs({spread: false})">
                        单页
                    </button>
                    <button
                        v-for="width in widthOptions"
                        :key="width"
                        class="chip"
                        :class="{active: stageWidth === width}"
                        @click="setStageWidth(width)"
                    >
                        {{ width === 'auto' ? '自适应' : width }}
                    </button>
                </div>

                <label class="label">跳到章首</label>
                <div class="row">
                    <select v-model.number="jumpChapter" class="grow" @change="jumpToChapter">
                        <option v-for="item in chapterOptions" :key="item.index" :value="item.index">
                            {{ item.index }} · {{ item.title }}
                        </option>
                    </select>
                </div>
            </section>

            <section v-if="hasEngine" class="group">
                <label class="label">实时数据</label>
                <dl class="stats">
                    <div>
                        <dt>页数</dt>
                        <dd>{{ stats.columns }}</dd>
                    </div>
                    <div>
                        <dt>spreads</dt>
                        <dd>{{ stats.spreads }}</dd>
                    </div>
                    <div>
                        <dt>当前 spread</dt>
                        <dd>{{ stats.spread }}</dd>
                    </div>
                    <div>
                        <dt>页码</dt>
                        <dd>{{ pageNumbers.left }}
                            <template v-if="pageNumbers.right"> / {{ pageNumbers.right }}</template>
                        </dd>
                    </div>
                    <div>
                        <dt>PW × PH</dt>
                        <dd>{{ layout?.PW }} × {{ layout?.PH }}</dd>
                    </div>
                    <div>
                        <dt>STEP / SPREAD</dt>
                        <dd>{{ stats.step }} / {{ layout?.SPREAD }}</dd>
                    </div>
                    <div>
                        <dt>锚点</dt>
                        <dd>{{ stats.anchors }}</dd>
                    </div>
                    <div>
                        <dt>重排耗时</dt>
                        <dd>{{ stats.duration }} ms</dd>
                    </div>
                    <div>
                        <dt>页数奇偶</dt>
                        <dd>{{ parity }}</dd>
                    </div>
                </dl>
                <p class="muted">
                    位置：ch{{ position.chapter }} @ {{ position.offset }}
                </p>
                <div class="row">
                    <button class="chip" @click="turn(-1)">← 上一跨页</button>
                    <button class="chip" @click="turn(1)">下一跨页 →</button>
                </div>
            </section>

            <section v-if="hasEngine" class="group">
                <label class="label">自检</label>
                <div class="row">
                    <button class="ghost" @click="testFontRoundTrip">字号往返</button>
                    <button class="ghost" @click="testViewportWidth">视口宽度</button>
                    <button class="ghost" @click="testStability">重排稳定性</button>
                    <button class="ghost" @click="testTextInvariant">文本不变量</button>
                </div>
                <div
                    v-for="result in testResults"
                    :key="result.name"
                    class="result"
                    :class="result.pass ? 'pass' : 'fail'"
                >
                    <p class="result-head">
                        {{ result.pass ? 'PASS' : 'FAIL' }} · {{ result.name }}
                    </p>
                    <p class="result-detail">{{ result.detail }}</p>
                </div>
            </section>

            <p v-if="failure" class="failure">{{ failure }}</p>
            <p class="muted hint">← → / Space / Home / End 翻页</p>
        </aside>

        <div class="stage-wrap">
            <div ref="stageEl" class="stage" :style="stageStyle">
                <div v-if="parsed && layout" class="book" :style="bookStyle" :lang="parsed.meta.language || 'zh'">
                    <div class="paper"/>
                    <div class="spine" :style="spineStyle"/>

                    <div class="chrome" :style="chromeStyle(0)">{{ headerLeft }}</div>
                    <div v-if="layout.SPREAD === 2" class="chrome right" :style="chromeStyle(1)">
                        {{ headerRight }}
                    </div>

                    <div class="folio" :style="folioStyle(0)">{{ pageNumbers.left }}</div>
                    <div v-if="layout.SPREAD === 2" class="folio" :style="folioStyle(1)">
                        {{ pageNumbers.right }}
                    </div>

                    <div ref="viewportEl" class="viewport" :style="viewportStyle">
                        <div ref="flowEl" class="flow">
                            <section
                                v-for="chapter in parsed.chapters"
                                :key="chapter.index"
                                :data-chapter="chapter.index"
                            >
                                <template v-for="(block, index) in chapter.blocks" :key="index">
                                    <img
                                        v-if="block.type === 'img'"
                                        :class="blockClass(block)"
                                        :src="block.src"
                                        :alt="block.alt ?? ''"
                                        :data-chapter="chapter.index"
                                        :data-block="index"
                                        :data-offset="block.offset"
                                        :style="imgStyle(block)"
                                    />
                                    <hr
                                        v-else-if="block.type === 'hr'"
                                        :class="blockClass(block)"
                                        :data-chapter="chapter.index"
                                        :data-block="index"
                                        :data-offset="block.offset"
                                    />
                                    <p
                                        v-else
                                        :class="blockClass(block)"
                                        :data-chapter="chapter.index"
                                        :data-block="index"
                                        :data-offset="block.offset"
                                    >
                                        {{ block.text }}
                                    </p>
                                </template>
                            </section>
                        </div>
                    </div>
                </div>

                <p v-else class="stage-hint">
                    {{ busy ? progress || '正在排版…' : '在左侧选一本书，点「打开并排版」' }}
                </p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.debug {
    display: flex;
    height: 100vh;
    overflow: hidden;
}

/* ------------------------------------------------------------------ 面板 */
.panel {
    width: 330px;
    flex: none;
    padding: 26px 22px 40px;
    overflow-y: auto;
    background: rgba(18, 15, 13, 0.86);
    border-right: 1px solid var(--hair);
    backdrop-filter: blur(12px);
    font-size: 13px;
}

.eyebrow {
    font-family: var(--font-classic);
    font-size: 10.5px;
    letter-spacing: 0.28em;
    color: var(--muted);
}

h1 {
    margin-top: 10px;
    font-family: var(--font-serif-sc);
    font-size: 24px;
    font-weight: 400;
    letter-spacing: 0.05em;
}

.group {
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.label {
    display: block;
    margin: 12px 0 7px;
    font-size: 11px;
    letter-spacing: 0.16em;
    color: var(--muted);
}

.label:first-child {
    margin-top: 0;
}

select,
input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 9px;
    border: 1px solid var(--hair);
    background: rgba(0, 0, 0, 0.32);
    color: #f4ead6;
    font: inherit;
    font-size: 12.5px;
}

.row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
}

.row .grow {
    flex: 1;
}

.chip {
    padding: 6px 11px;
    border-radius: 999px;
    border: 1px solid var(--hair);
    font-size: 12px;
    color: #e9dfcc;
    background: rgba(255, 255, 255, 0.03);
    transition: background-color 160ms var(--ease);
}

.chip:hover {
    background: rgba(255, 255, 255, 0.1);
}

.chip.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
}

.primary {
    width: 100%;
    margin-top: 10px;
    padding: 9px 14px;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font-size: 13px;
}

.primary:disabled {
    opacity: 0.5;
    cursor: progress;
}

.ghost {
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--hair);
    font-size: 12px;
}

.stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 10px;
    margin: 0;
}

.stats div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 9px;
    border-radius: 9px;
    background: rgba(0, 0, 0, 0.26);
}

.stats dt {
    font-size: 10.5px;
    letter-spacing: 0.1em;
    color: var(--muted);
}

.stats dd {
    margin: 0;
    font-family: var(--font-classic);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
}

.muted {
    color: var(--muted);
    font-size: 12px;
    margin-top: 8px;
}

.failure {
    margin-top: 16px;
    padding: 9px 12px;
    border-radius: 9px;
    background: rgba(170, 66, 56, 0.2);
    border: 1px solid rgba(214, 106, 96, 0.35);
    color: #f2cec9;
    font-size: 12px;
}

.result {
    margin-top: 10px;
    padding: 9px 11px;
    border-radius: 9px;
    font-size: 11.5px;
    line-height: 1.7;
}

.result.pass {
    background: rgba(120, 170, 110, 0.14);
    border: 1px solid rgba(140, 200, 130, 0.3);
    color: #d6eccf;
}

.result.fail {
    background: rgba(170, 66, 56, 0.18);
    border: 1px solid rgba(214, 106, 96, 0.35);
    color: #f2cec9;
}

.result-head {
    font-weight: 600;
    letter-spacing: 0.04em;
}

.result-detail {
    margin-top: 4px;
    opacity: 0.9;
}

.hint {
    margin-top: 22px;
}

/* ------------------------------------------------------------------ 舞台 */
.stage-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow: hidden;
}

.stage {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto;
    overflow: hidden;
}

.stage-hint {
    color: var(--muted);
    font-size: 13px;
}

.book {
    position: relative;
    flex: none;
    /* 页眉/页脚用的字体：默认沿西文字体在前的经典栈 */
    --font-page-ui: var(--font-classic);
}

/* 英文书：标题与页码也要西文优先，否则卷名里的 Alice’s 会变全角撇号 */
.book:lang(en) {
    --font-page-ui: var(--font-latin-serif), var(--font-classic);
    --font-heading: var(--font-latin-serif), var(--font-serif-sc);
}

.paper {
    position: absolute;
    inset: 0;
    border-radius: 5px;
    background: radial-gradient(120% 100% at 50% 0%, #fbf6ea, #f6efdf 55%, #efe6d2 100%);
    box-shadow: 0 34px 60px rgba(0, 0, 0, 0.46),
    0 6px 14px rgba(0, 0, 0, 0.3);
}

.spine {
    position: absolute;
    top: 0;
    bottom: 0;
    background: linear-gradient(
        to right,
        rgba(90, 70, 48, 0.16),
        rgba(90, 70, 48, 0.04) 40%,
        rgba(90, 70, 48, 0.18)
    );
    pointer-events: none;
}

.chrome {
    position: absolute;
    display: flex;
    align-items: center;
    font-family: var(--font-page-ui);
    font-size: 11px;
    letter-spacing: 0.14em;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.chrome.right {
    justify-content: flex-end;
}

.folio {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-page-ui);
    font-size: 11.5px;
    letter-spacing: 0.1em;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
}

.viewport {
    position: absolute;
    overflow: hidden;
}

.flow {
    /* 宽高、column-width/gap 由引擎写入 */
    color: var(--ink);
    transform: translate3d(0, 0, 0);
    will-change: transform;
    font-kerning: normal;
    /* 英文两端对齐靠断字，否则窄行会被拉开成河 */
    hyphens: auto;
}

/* ------------------------------------------------------------------ 排版 */
.flow :deep(.b) {
    margin: 0;
    overflow-wrap: break-word;
}

.flow :deep(p.b) {
    text-indent: 2em;
}

/* 章首段不缩进（中英排版惯例） */
.flow :deep(section > .b:first-child),
.flow :deep(section > .b-h1 + .b) {
    text-indent: 0;
}

.flow :deep(.b-li) {
    text-indent: 0;
    padding-left: 1.2em;
}

.flow :deep(.b-h1) {
    margin: 0.6em 0 1.4em;
    font-family: var(--font-heading);
    font-size: 1.5em;
    font-weight: 400;
    letter-spacing: 0.08em;
    text-align: center;
    text-indent: 0;
}

.flow :deep(.b-h2) {
    margin: 0.5em 0 1em;
    font-family: var(--font-heading);
    font-size: 1.24em;
    font-weight: 400;
    letter-spacing: 0.06em;
    text-align: center;
    text-indent: 0;
}

.flow :deep(.b-h3) {
    margin: 0.5em 0 0.6em;
    font-family: var(--font-heading);
    font-size: 1.1em;
    font-weight: 400;
    text-indent: 0;
}

.flow :deep(.b-blockquote) {
    margin: 0.5em 1.4em;
    text-indent: 0;
    color: var(--ink-soft);
}

.flow :deep(.b-figcaption) {
    margin: 0.5em 0 1.1em;
    text-align: center;
    font-size: 0.82em;
    text-indent: 0;
    color: var(--ink-soft);
    break-inside: avoid;
}

.flow :deep(.b-img) {
    display: block;
    max-width: 100%;
    max-height: calc(var(--ph, 600px) * 0.82);
    margin: 0.9em auto;
    break-inside: avoid;
}

.flow :deep(.b-hr) {
    width: 38%;
    margin: 1.2em auto;
    border: 0;
    border-top: 1px solid var(--paper-edge);
}
</style>
