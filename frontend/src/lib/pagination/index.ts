/**
 * 分页引擎出口。纯 TS 模块：不 import Vue，不知道路由与状态管理，
 * 只对「一个装着块元素的 flow 容器」负责。
 */

export {
    PAGE_ASPECT,
    SPINE_GAP,
    SPREAD_MIN_WIDTH,
    pageLeft,
    readingLayout,
    type LayoutPrefs,
    type PageMargin,
    type ReadingLayout,
    type ViewportSize,
} from './layout'

export {
    PaginationEngine,
    type PageAnchor,
    type PaginateResult,
    type Position,
    type Typography,
} from './engine'

export {
    anchorIndexFor,
    blockForOffset,
    collectBlockAnchors,
    rangeForOffset,
    textPositionAt,
    type BlockAnchor,
} from './anchor'
