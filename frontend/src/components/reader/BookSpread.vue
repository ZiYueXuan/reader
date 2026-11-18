<script setup lang="ts">
/**
 * 摊开的书：纸面 / 书脊 / 页眉 / 页码 / 正文视口 / 翻页热区 / 页角拖动。
 *
 * 所有几何都来自 `ReadingLayout`（引擎的同一套数字），
 * 这里绝不自算尺寸，否则视口与 columns 会错开。
 *
 * 视口只裁剪、不滚动：翻页靠 `.page-flow` 的 translate3d 做横向位移。
 */

import {computed, type CSSProperties, onBeforeUnmount, ref} from 'vue'

import type {ReadingLayout} from '@/lib/pagination'

const props = defineProps<{
    layout: ReadingLayout | null
    lang: string
    leftPage: number
    rightPage: number
    leftHeader: string
    rightHeader: string
    canPrev: boolean
    canNext: boolean
    turning: boolean
}>()

const emit = defineEmits<{ turn: [number] }>()

const bookEl = ref<HTMLElement | null>(null)
const flowEl = ref<HTMLElement | null>(null)
const dragging = ref(false)

const spread = computed(() => props.layout?.SPREAD === 2)

const bookStyle = computed<CSSProperties>(() => {
    const layout = props.layout
    if (!layout) return {}
    return {width: `${layout.bookWidth}px`, height: `${layout.bookHeight}px`}
})

const spineStyle = computed<CSSProperties | undefined>(() => {
    const layout = props.layout
    if (!layout || layout.SPREAD !== 2) return undefined
    return {left: `${layout.margins.x + layout.PW}px`, width: `${layout.GAP}px`}
})

const viewportStyle = computed<CSSProperties | undefined>(() => {
    const layout = props.layout
    if (!layout) return undefined
    return {
        left: `${layout.margins.x}px`,
        top: `${layout.margins.y + layout.headerH}px`,
        width: `${layout.flowWidth}px`,
        height: `${layout.flowHeight}px`,
    }
})

function sideLeft(column: number): string {
    const layout = props.layout
    return layout ? `${layout.margins.x + column * layout.STEP}px` : '0'
}

function chromeStyle(column: number): CSSProperties | undefined {
    const layout = props.layout
    if (!layout) return undefined
    return {
        left: sideLeft(column),
        top: `${layout.margins.y}px`,
        width: `${layout.PW}px`,
        height: `${layout.headerH}px`,
    }
}

function folioStyle(column: number): CSSProperties | undefined {
    const layout = props.layout
    if (!layout) return undefined
    return {
        left: sideLeft(column),
        top: `${layout.margins.y + layout.headerH + layout.flowHeight}px`,
        width: `${layout.PW}px`,
        height: `${layout.footerH}px`,
    }
}

/* ------------------------------------------------------------------ 翻页 */

function requestTurn(delta: number): void {
    if (delta > 0 && !props.canNext) return
    if (delta < 0 && !props.canPrev) return
    emit('turn', delta)
}

/* -------------------------------------------------------------- 页角拖动 */

let dragPointer = -1
let dragStartX = 0
let dragDx = 0

function resetDrag(): void {
    dragging.value = false
    dragPointer = -1
    bookEl.value?.style.setProperty('--drag', '0px')
}

function onCornerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    dragging.value = true
    dragPointer = event.pointerId
    dragStartX = event.clientX
    dragDx = 0
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    event.preventDefault()
}

function onCornerMove(event: PointerEvent): void {
    if (!dragging.value || event.pointerId !== dragPointer) return
    dragDx = event.clientX - dragStartX
    // 首版只做跟随位移（卷曲留到 Phase 8/10），幅度压小以免像在拖整本书
    const follow = Math.max(-56, Math.min(56, dragDx * 0.22))
    bookEl.value?.style.setProperty('--drag', `${follow.toFixed(1)}px`)
}

function onCornerUp(event: PointerEvent): void {
    if (!dragging.value || event.pointerId !== dragPointer) return
    const dx = dragDx
    resetDrag()

    if (dx <= -60) {
        requestTurn(1)
        return
    }
    if (dx >= 60) {
        requestTurn(-1)
        return
    }
    // 轻点页角 = 下一页
    if (Math.abs(dx) < 6) requestTurn(1)
}

onBeforeUnmount(() => {
    resetDrag()
})

defineExpose({flowEl})
</script>

<template>
    <div
        ref="bookEl"
        class="book"
        :class="{turning, dragging, 'is-measuring': !layout}"
        :style="bookStyle"
        :lang="lang"
    >
        <div class="paper"/>
        <div class="grain" aria-hidden="true"/>
        <div v-if="spread" class="spine" :style="spineStyle" aria-hidden="true"/>

        <div
            v-if="layout && leftHeader"
            class="chrome"
            :style="chromeStyle(0)"
            aria-hidden="true"
        >
            {{ leftHeader }}
        </div>
        <div
            v-if="layout && spread && rightHeader"
            class="chrome right"
            :style="chromeStyle(1)"
            aria-hidden="true"
        >
            {{ rightHeader }}
        </div>

        <div v-if="layout && leftPage > 0" class="folio" :style="folioStyle(0)">
            {{ leftPage }}
        </div>
        <div v-if="layout && spread && rightPage > 0" class="folio" :style="folioStyle(1)">
            {{ rightPage }}
        </div>

        <div class="viewport" :style="viewportStyle">
            <div ref="flowEl" class="page-flow">
                <slot/>
            </div>
        </div>

        <button
            type="button"
            class="zone left"
            :class="{edge: !canPrev}"
            aria-label="上一页"
            tabindex="-1"
            @click="requestTurn(-1)"
        />
        <button
            type="button"
            class="zone right"
            :class="{edge: !canNext}"
            aria-label="下一页"
            tabindex="-1"
            @click="requestTurn(1)"
        />

        <div
            class="corner"
            aria-hidden="true"
            @pointerdown="onCornerDown"
            @pointermove="onCornerMove"
            @pointerup="onCornerUp"
            @pointercancel="onCornerUp"
        />
    </div>
</template>

<style scoped>
.book {
    position: relative;
    flex: none;
    /* 页眉/页码字体：默认西文在前的经典栈，英文书在 :lang(en) 里换成纯西文 */
    --font-page-ui: var(--font-classic);
    /* 2.5D：只允许仿射变换（无 perspective）。
       引擎靠 rect 差算列号，透视会按 y 缩放 x 并在远距离累积成差列，
       所以这里只保留一个极小的 rotateX 作为 Phase 9 的挂点。 */
    transform: translate3d(var(--drag, 0px), 0, 0) rotateX(2.2deg);
    transform-origin: 50% 100%;
    transition: transform 260ms var(--ease);
    will-change: transform;
}

.book:lang(en) {
    --font-page-ui: var(--font-latin-serif), var(--font-classic);
    --font-heading: var(--font-latin-serif), var(--font-serif-sc);
}

.book.dragging {
    transition: none;
}

/* 首次测量前（layout 还没算出来）先藏起来，但不影响 getBoundingClientRect */
.book.is-measuring {
    visibility: hidden;
}

/* ------------------------------------------------------------------ 纸 */

.paper {
    position: absolute;
    inset: 0;
    border-radius: 5px;
    background: radial-gradient(120% 100% at 50% 0%, #fbf6ea, #f6efdf 55%, #efe6d2 100%);
    box-shadow: 0 34px 60px rgba(0, 0, 0, 0.46),
    0 6px 14px rgba(0, 0, 0, 0.3),
    inset 0 0 46px rgba(120, 96, 64, 0.1);
    transition: box-shadow 380ms var(--ease);
}

/* 翻页时纸面阴影加深，模拟纸张被抬起 */
.book.turning .paper {
    box-shadow: 0 44px 74px rgba(0, 0, 0, 0.52),
    0 10px 20px rgba(0, 0, 0, 0.34),
    inset 0 0 60px rgba(110, 86, 56, 0.14);
}

/* 纸纹：feTurbulence 生成噪声，mix-blend 让它渗进纸色 */
.grain {
    position: absolute;
    inset: 0;
    border-radius: 5px;
    pointer-events: none;
    opacity: 0.55;
    mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.16'/%3E%3C/svg%3E");
}

.spine {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 2px;
    background: linear-gradient(
        to right,
        rgba(90, 70, 48, 0.16),
        rgba(90, 70, 48, 0.04) 40%,
        rgba(90, 70, 48, 0.18)
    );
    pointer-events: none;
}

/* ------------------------------------------------------------- 页眉页码 */

.chrome {
    position: absolute;
    display: flex;
    align-items: center;
    font-family: var(--font-page-ui);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
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
    pointer-events: none;
}

/* ------------------------------------------------------------------ 正文 */

.viewport {
    position: absolute;
    overflow: hidden;
}

/* ------------------------------------------------------------- 翻页热区 */

.zone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 12%;
    z-index: 4;
    padding: 0;
    border: 0;
    background: transparent;
    -webkit-tap-highlight-color: transparent;
}

.zone.left {
    left: 0;
    cursor: w-resize;
}

.zone.right {
    right: 0;
    cursor: e-resize;
}

.zone.edge {
    cursor: default;
}

.zone:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
}

.corner {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 64px;
    height: 64px;
    z-index: 5;
    cursor: grab;
    touch-action: none;
}

.corner:active {
    cursor: grabbing;
}

/* 页角提示：悬停时露出一条很淡的折角 */
.corner::after {
    content: '';
    position: absolute;
    right: 11px;
    bottom: 11px;
    width: 17px;
    height: 17px;
    border-right: 1px solid rgba(140, 120, 90, 0.4);
    border-bottom: 1px solid rgba(140, 120, 90, 0.4);
    border-bottom-right-radius: 3px;
    opacity: 0;
    transition: opacity 200ms var(--ease);
}

.book:hover .corner::after {
    opacity: 1;
}
</style>
