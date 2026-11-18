/**
 * `(chapter, offset)` ⇄ DOM 位置。
 *
 * 依赖内容模型的不变量：块元素的 textContent 与 `Block.text` 逐字相同，
 * 因此「块内第 n 个字符」可以在文本节点上按长度累加直接定位。
 */

export interface BlockAnchor {
    el: HTMLElement
    chapter: number
    offset: number
    /** 本章内的结束偏移（不含），等于 offset + textContent.length */
    end: number
}

function toInt(value: string | undefined): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

/** 收集 flow 内全部块锚点，按 (chapter, offset) 升序（即 DOM 顺序） */
export function collectBlockAnchors(flow: HTMLElement): BlockAnchor[] {
    const nodes = flow.querySelectorAll<HTMLElement>('[data-offset]')
    const anchors: BlockAnchor[] = []
    for (const el of nodes) {
        anchors.push({
            el,
            chapter: toInt(el.dataset.chapter),
            offset: toInt(el.dataset.offset),
            end: toInt(el.dataset.offset) + (el.textContent?.length ?? 0),
        })
    }
    return anchors
}

/** 二分：最后一个 (chapter, offset) <= 目标 的锚点下标 */
export function anchorIndexFor(anchors: BlockAnchor[], chapter: number, offset: number): number {
    let lo = 0
    let hi = anchors.length - 1
    let best = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const anchor = anchors[mid]
        if (anchor.chapter < chapter || (anchor.chapter === chapter && anchor.offset <= offset)) {
            best = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return best
}

/** 找到包含该偏移的块（同一 offset 可能对应图片空块，优先取有文字的块） */
export function blockForOffset(
    anchors: BlockAnchor[],
    chapter: number,
    offset: number,
): BlockAnchor | null {
    let index = anchorIndexFor(anchors, chapter, offset)
    if (index < 0) return null
    // 同一 offset 可能有多个块（图片、hr 的 end === offset），向前找到真正容纳该字符的块
    while (index >= 0) {
        const anchor = anchors[index]
        if (anchor.chapter !== chapter) break
        if (anchor.offset === offset && anchor.end > offset) return anchor
        if (anchor.offset < offset && anchor.end > offset) return anchor
        if (anchor.offset < offset) break
        index -= 1
    }
    return anchors[Math.max(0, anchorIndexFor(anchors, chapter, offset))]
}

interface TextPosition {
    node: Text
    offset: number
}

/** 在元素内按字符偏移定位文本节点（跳过图片等非文本节点） */
export function textPositionAt(el: Element, localOffset: number): TextPosition | null {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let remaining = Math.max(0, localOffset)
    let last: Text | null = null

    while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const length = node.data.length
        if (remaining <= length) return {node, offset: remaining}
        remaining -= length
        last = node
    }
    return last ? {node: last, offset: last.data.length} : null
}

/**
 * 生成覆盖该偏移处 1 个字符的 Range，用于精确测量「段内位置落在第几列」。
 * 定位不到（图片块、或偏移落在块尾）时返回 null，调用方退回块首锚点。
 */
export function rangeForOffset(
    anchors: BlockAnchor[],
    chapter: number,
    offset: number,
): Range | null {
    const block = blockForOffset(anchors, chapter, offset)
    if (!block) return null

    const local = offset - block.offset
    const position = textPositionAt(block.el, local)
    if (!position) return null

    const range = document.createRange()
    const start = Math.min(position.offset, position.node.data.length)
    const end = Math.min(start + 1, position.node.data.length)
    if (start === end) return null
    range.setStart(position.node, start)
    range.setEnd(position.node, end)
    return range
}
