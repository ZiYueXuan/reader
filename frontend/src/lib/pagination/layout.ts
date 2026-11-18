/**
 * 版面几何：把「视口 + 偏好」换算成一套分页尺寸。
 *
 * 符号与约束见 design/02-architecture.md §4.2：
 *   PW    单页版心宽
 *   PH    单页版心高
 *   GAP   跨页时两列之间的书脊间隙
 *   STEP  一列的水平步长 = PW + GAP
 *   SPREAD 一屏几列（桌面 2，窄屏 1）
 *
 * **硬约束**：flow 容器宽度必须恰好等于 `SPREAD*PW + (SPREAD-1)*GAP`，
 * 否则浏览器算出的实际列宽不等于 PW，翻页位移会累积误差。
 */

export type PageMargin = 'narrow' | 'medium' | 'wide'

export interface LayoutPrefs {
    fontSize: number
    lineHeight: number
    margin: PageMargin
    /** 允许双页；实际是否双页还取决于视口宽度 */
    spread: boolean
}

export interface ViewportSize {
    width: number
    height: number
}

export interface ReadingLayout {
    SPREAD: 1 | 2
    GAP: number
    PW: number
    PH: number
    STEP: number
    headerH: number
    footerH: number
    margins: { x: number; y: number }
    /** 单页纸的尺寸（含页边距与页眉页脚） */
    pageWidth: number
    pageHeight: number
    /** flow 容器尺寸 */
    flowWidth: number
    flowHeight: number
    /** 摊开后整本书（纸面）的尺寸 */
    bookWidth: number
    bookHeight: number
}

/** 纸张长宽比，接近 A5 竖版 */
export const PAGE_ASPECT = 1.48
/** 双页时两版心之间的书脊间隙 */
export const SPINE_GAP = 48
/** 低于这个视口宽度就只排单页 */
export const SPREAD_MIN_WIDTH = 900

const MARGIN_RATIO: Record<PageMargin, number> = {
    narrow: 0.05,
    medium: 0.07,
    wide: 0.098,
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

export function readingLayout(prefs: LayoutPrefs, viewport: ViewportSize): ReadingLayout {
    const SPREAD: 1 | 2 = prefs.spread && viewport.width >= SPREAD_MIN_WIDTH ? 2 : 1
    const GAP = SPREAD === 2 ? SPINE_GAP : 0

    const padX = clamp(viewport.width * 0.045, 16, 72)
    const padY = clamp(viewport.height * 0.06, 16, 64)
    const availW = Math.max(260, viewport.width - padX * 2)
    const availH = Math.max(360, viewport.height - padY * 2)

    // 先按宽度上限与高度上限取小，再回推高度，保证纸张长宽比稳定
    const maxPageWidth = (availW - GAP) / SPREAD
    const pageWidth = Math.max(240, Math.floor(Math.min(maxPageWidth, availH / PAGE_ASPECT)))
    const pageHeightCandidate = Math.floor(Math.min(availH, pageWidth * PAGE_ASPECT))

    const marginX = Math.round(clamp(pageWidth * MARGIN_RATIO[prefs.margin], 16, 96))
    const marginY = Math.round(clamp(marginX * 0.92, 14, 88))
    const headerH = Math.round(clamp(prefs.fontSize * 1.7, 22, 48))
    const footerH = Math.round(clamp(prefs.fontSize * 1.9, 24, 54))

    const PW = Math.max(140, pageWidth - marginX * 2)
    const PH = Math.max(160, pageHeightCandidate - marginY * 2 - headerH - footerH)
    const pageHeight = PH + marginY * 2 + headerH + footerH
    const STEP = PW + GAP

    const flowWidth = SPREAD * PW + (SPREAD - 1) * GAP
    const flowHeight = PH

    return {
        SPREAD,
        GAP,
        PW,
        PH,
        STEP,
        headerH,
        footerH,
        margins: {x: marginX, y: marginY},
        pageWidth,
        pageHeight,
        flowWidth,
        flowHeight,
        bookWidth: flowWidth + marginX * 2,
        bookHeight: pageHeight,
    }
}

/** 第 index 页（0 起）的左侧坐标，用于页眉页脚定位 */
export function pageLeft(layout: ReadingLayout, index: number): number {
    const column = index % layout.SPREAD
    return layout.margins.x + column * layout.STEP
}
