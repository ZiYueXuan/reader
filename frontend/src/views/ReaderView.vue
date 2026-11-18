<script setup lang="ts">
/**
 * 阅读器主视图。
 *
 * 分工：
 *   - stores/reader.ts 负责「打开 → 排版 → 翻页」的全部状态与引擎调用；
 *   - BookSpread / PageFlow 只负责把几何与内容渲染出来；
 *   - 本文件只做输入编排（键盘、热区、页角）、生命周期与重排触发。
 */

import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'

import BookSpread from '@/components/reader/BookSpread.vue'
import ImageLightbox from '@/components/reader/ImageLightbox.vue'
import PageFlow from '@/components/reader/PageFlow.vue'
import type {LightboxImage} from '@/components/reader/types'
import {usePrefsStore} from '@/stores/prefs'
import {useReaderStore} from '@/stores/reader'

const props = defineProps<{ id: string }>()

const prefs = usePrefsStore()
const reader = useReaderStore()

const stageEl = ref<HTMLElement | null>(null)
const spreadRef = ref<InstanceType<typeof BookSpread> | null>(null)

const turning = ref(false)
const lightbox = ref<LightboxImage | null>(null)

const hintVisible = computed(() => reader.phase === 'ready' && !prefs.prefs.turnHintSeen)
const lang = computed(() => (reader.book?.meta.language || 'zh').toLowerCase())

let turnTimer: number | undefined
let resizeTimer: number | undefined
let prefsTimer: number | undefined
let resizeObserver: ResizeObserver | null = null

/* ------------------------------------------------------------------ 打开 */

watch(
    () => reader.book,
    async (book) => {
        if (!book) return
        await nextTick()
        const flow = spreadRef.value?.flowEl
        const stage = stageEl.value
        if (!flow || !stage) return
        await reader.attach(flow, stage)
    },
)

watch(
    () => props.id,
    (id) => {
        void reader.open(id)
    },
)

onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    if (stageEl.value) {
        resizeObserver = new ResizeObserver(onResize)
        resizeObserver.observe(stageEl.value)
    }
    void reader.open(props.id)
    exposeProbe()
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    window.clearTimeout(turnTimer)
    window.clearTimeout(resizeTimer)
    window.clearTimeout(prefsTimer)
    resizeObserver?.disconnect()
    resizeObserver = null
    reader.reset()
})

/* ------------------------------------------------------------------ 翻页 */

function dismissHint(): void {
    if (!prefs.prefs.turnHintSeen) prefs.prefs.turnHintSeen = true
}

function turn(delta: number): void {
    const flow = spreadRef.value?.flowEl
    if (!flow || reader.phase !== 'ready') return
    if (delta > 0 ? !reader.canNext : !reader.canPrev) return

    // 先把 transition 落到样式里：同一帧内加类并改 transform 不会产生动画
    flow.classList.add('is-turning')
    void flow.offsetWidth
    if (!reader.turn(delta)) {
        flow.classList.remove('is-turning')
        return
    }

    turning.value = true
    window.clearTimeout(turnTimer)
    turnTimer = window.setTimeout(() => {
        flow.classList.remove('is-turning')
        turning.value = false
    }, 420)

    dismissHint()
}

/** Home / End：整本跳转不做位移动画，否则会滑过几百页 */
function jumpTo(start: boolean): void {
    if (reader.phase !== 'ready') return
    spreadRef.value?.flowEl?.classList.remove('is-turning')
    turning.value = false
    if (start) {
        reader.goFirst()
    } else {
        reader.goLast()
    }
    dismissHint()
}

function onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement | null
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

    if (lightbox.value) {
        if (event.key === 'Escape') lightbox.value = null
        return
    }

    switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
            event.preventDefault()
            turn(1)
            break
        case 'ArrowLeft':
        case 'PageUp':
            event.preventDefault()
            turn(-1)
            break
        case ' ':
            event.preventDefault()
            turn(event.shiftKey ? -1 : 1)
            break
        case 'Home':
            event.preventDefault()
            jumpTo(true)
            break
        case 'End':
            event.preventDefault()
            jumpTo(false)
            break
        default:
            // 滚轮与 ↓ 刻意不响应：容器不滚动，翻页只走显式操作
            break
    }
}

/* ------------------------------------------------------------ 重排触发 */

function onResize(): void {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
        void reader.relayoutIfResized()
    }, 150)
}

watch(
    () => [
        prefs.prefs.fontSize,
        prefs.prefs.lineHeight,
        prefs.prefs.pageMargin,
        prefs.prefs.font,
        prefs.prefs.spread,
    ],
    () => {
        window.clearTimeout(prefsTimer)
        prefsTimer = window.setTimeout(() => {
            void reader.relayout()
        }, 120)
    },
)

function openImage(image: LightboxImage): void {
    lightbox.value = image
}

/* ------------------------------------------------------------------ 探针 */

function exposeProbe(): void {
    if (!import.meta.env.DEV) return
        ;
    (window as unknown as Record<string, unknown>).__reader = {
        store: reader,
        probe: reader.probe,
        turn,
        jumpTo,
        get layout() {
            return reader.layout
        },
        get view() {
            return reader.view
        },
    }
}
</script>

<template>
    <main class="reader">
        <div ref="stageEl" class="stage">
            <BookSpread
                v-if="reader.book"
                ref="spreadRef"
                :layout="reader.layout"
                :lang="lang"
                :left-page="reader.view.leftPage"
                :right-page="reader.view.rightPage"
                :left-header="reader.view.leftHeader"
                :right-header="reader.view.rightHeader"
                :can-prev="reader.canPrev"
                :can-next="reader.canNext"
                :turning="turning"
                @turn="turn"
            >
                <PageFlow :chapters="reader.book.chapters" @image="openImage"/>
            </BookSpread>
        </div>

        <header class="topbar">
            <RouterLink class="back" to="/" aria-label="返回书架">←</RouterLink>
            <p class="title">{{ reader.book?.meta.title }}</p>
            <p class="percent">{{ Math.round(reader.view.percent * 100) }}%</p>
        </header>

        <p v-if="hintVisible" class="hint">← → 翻页 · 空格下一页 · 拖动页角</p>

        <div v-if="reader.phase === 'loading'" class="overlay">
            <p class="overlay-text">{{ reader.message || '正在打开…' }}</p>
        </div>
        <div v-else-if="reader.phase === 'error'" class="overlay">
            <p class="overlay-text">{{ reader.error }}</p>
            <RouterLink class="overlay-link" to="/">返回书架</RouterLink>
        </div>

        <ImageLightbox
            v-if="lightbox"
            :src="lightbox.src"
            :alt="lightbox.alt"
            :caption="lightbox.caption"
            @close="lightbox = null"
        />
    </main>
</template>

<style scoped>
.reader {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}

.stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* 注意：这里不能加 perspective。
   引擎用「字符 rect 与 flow rect 的差」算列号，而 perspective 会按 y 缩放 x，
   在 flow 被 translate 出几万像素后又逐列累积误差（实测最多偏 1/4 列）。
   倾斜只能是仿射变换，真正的 2.5D 透视留到 Phase 9 重做测量层再说。 */

/* ------------------------------------------------------------------ 顶栏 */

.topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 20px;
    pointer-events: none;
}

.back {
    display: grid;
    flex: none;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid var(--hair);
    background: rgba(0, 0, 0, 0.22);
    font-size: 15px;
    pointer-events: auto;
    transition: border-color 200ms var(--ease);
}

.back:hover {
    border-color: var(--accent);
    color: var(--accent);
}

.title {
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-serif-sc);
    font-size: 12.5px;
    letter-spacing: 0.08em;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.percent {
    margin-left: auto;
    font-family: var(--font-classic);
    font-size: 12px;
    letter-spacing: 0.06em;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}

/* ------------------------------------------------------------------ 提示 */

.hint {
    position: absolute;
    left: 50%;
    bottom: 24px;
    z-index: 10;
    padding: 8px 16px;
    border-radius: 999px;
    border: 1px solid var(--hair);
    background: rgba(20, 16, 13, 0.55);
    backdrop-filter: blur(10px);
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--muted);
    white-space: nowrap;
    pointer-events: none;
    transform: translateX(-50%);
    animation: hint-in 500ms var(--ease);
}

@keyframes hint-in {
    from {
        opacity: 0;
        transform: translate(-50%, 8px);
    }
}

/* -------------------------------------------------------------- 加载/错误 */

.overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: rgba(18, 15, 13, 0.55);
    backdrop-filter: blur(3px);
}

.overlay-text {
    font-size: 13px;
    letter-spacing: 0.06em;
    color: var(--muted);
}

.overlay-link {
    padding: 7px 15px;
    border-radius: 999px;
    border: 1px solid var(--hair);
    font-size: 12.5px;
    transition: border-color 200ms var(--ease);
}

.overlay-link:hover {
    border-color: var(--accent);
    color: var(--accent);
}
</style>
