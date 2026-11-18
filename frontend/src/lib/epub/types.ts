/**
 * EPUB 解析产出的内容模型。全书唯一的真相来源，见 design/02-architecture.md §4.1。
 *
 * 关键不变量：`Block.text` 必须与渲染后的 DOM `textContent` 逐字相同，
 * 否则 Phase 3/7 的字符偏移映射（选区 → offset → 高亮）会整体错位。
 */

export type BlockType =
    | 'p'
    | 'h1'
    | 'h2'
    | 'h3'
    | 'blockquote'
    | 'li'
    | 'img'
    | 'figcaption'
    | 'hr'

export interface Block {
    type: BlockType
    /** 纯文本；img 与 hr 为空串 */
    text: string
    /** 本章内的起止字符偏移（含前不含后） */
    offset: number
    endOffset: number
    /** 图片的 blob: URL（外链图片原样保留） */
    src?: string
    alt?: string
    /** 原始像素尺寸，排版前用于占位，避免图片加载后跳页 */
    width?: number
    height?: number
    /** li 的样式与符号 */
    listStyle?: 'ul' | 'ol'
    marker?: string
}

export interface Chapter {
    /** 等于在 spine 中的顺序，从 0 开始 */
    index: number
    /** zip 内的绝对路径（无前导斜杠） */
    href: string
    /** 从 nav 反查；没有 nav 时取本章第一个标题块 */
    title?: string
    blocks: Block[]
    /** 本章总字符数，即最后一个块的 endOffset */
    charLength: number
}

export interface TocNode {
    title: string
    /** 指向的章序号 */
    chapter: number
    /** 指向章内的字符偏移 */
    offset: number
    children: TocNode[]
}

export interface BookMeta {
    title: string
    author?: string
    publisher?: string
    language?: string
    identifier?: string
}

export interface ParsedBook {
    meta: BookMeta
    chapters: Chapter[]
    toc: TocNode[]
    totalChars: number
    totalBlocks: number

    /** 释放全部 blob: URL；一本书关闭时调用 */
    revoke(): void
}
