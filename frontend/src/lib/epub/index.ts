/**
 * EPUB 解析入口：zip → OPF → 逐章抽块 → 目录。
 *
 * 设计原则见 design/02-architecture.md §4.1：
 * - 顺序完全由 spine 决定，目录只提供显示名；
 * - 某一章解析失败不拖垮整本书，记 warn 继续；
 * - 返回的 ParsedBook 持有全部 blob: URL，用完必须调 `revoke()`。
 */

import {type ContentContext, extractChapter, ImageStore} from './content'
import {readToc} from './nav'
import {parseContentDocument, readOpf} from './opf'
import type {Block, Chapter, ParsedBook, TocNode} from './types'
import {openEpub} from './unzip'

export type ParsePhase = 'open' | 'opf' | 'content' | 'toc' | 'done'

export interface ParseProgress {
    phase: ParsePhase
    /** 已完成的单元数 */
    done: number
    /** 总单元数 */
    total: number
    message: string
}

export interface ParseOptions {
    onProgress?: (progress: ParseProgress) => void
    signal?: AbortSignal
}

export async function parseEpub(
    source: Blob | ArrayBuffer | Uint8Array,
    options: ParseOptions = {},
): Promise<ParsedBook> {
    const report = (phase: ParsePhase, done: number, total: number, message: string): void => {
        options.onProgress?.({phase, done, total, message})
    }
    const ensureLive = (): void => {
        if (options.signal?.aborted) throw new DOMException('解析已取消', 'AbortError')
    }

    report('open', 0, 1, '正在解包')
    const archive = await openEpub(source)
    let images: ImageStore | null = null

    try {
        ensureLive()
        report('opf', 0, 1, '正在读取 OPF')
        const opf = await readOpf(archive)
        images = new ImageStore(archive, opf.mediaTypes)
        const ctx: ContentContext = {archive, mediaTypes: opf.mediaTypes, images}

        // nav 文档若被塞进 spine 且标了 linear="no"，就不是正文
        const spine = opf.spine.filter((item) => !(item.properties.includes('nav') && !item.linear))
        const chapters: Chapter[] = []
        const contexts: Array<{ href: string; idOffsets: Map<string, number> }> = []

        for (let index = 0; index < spine.length; index += 1) {
            ensureLive()
            const item = spine[index]
            report('content', index, spine.length, `解析第 ${index + 1}/${spine.length} 节`)

            let blocks: Block[] = []
            let idOffsets = new Map<string, number>()
            let charLength = 0
            try {
                const doc = parseContentDocument(await archive.text(item.href))
                const extracted = await extractChapter(doc, item.href, ctx)
                blocks = extracted.blocks
                idOffsets = extracted.idOffsets
                charLength = extracted.charLength
            } catch (err) {
                console.warn('[epub] 章节解析失败，已跳过', item.href, err)
            }

            chapters.push({index, href: item.href, blocks, charLength})
            contexts.push({href: item.href, idOffsets})
        }

        ensureLive()
        report('toc', 0, 1, '正在读取目录')
        let toc: TocNode[] = []
        try {
            const result = await readToc(archive, opf, contexts)
            toc = result.toc
            for (const [chapter, title] of result.titles) {
                const target = chapters[chapter]
                if (target && !target.title) target.title = title
            }
        } catch (err) {
            console.warn('[epub] 目录解析失败，改用章内标题', err)
        }

        for (const chapter of chapters) {
            if (chapter.title) continue
            const heading = chapter.blocks.find(
                (block) => block.type === 'h1' || block.type === 'h2' || block.type === 'h3',
            )
            chapter.title = heading?.text
        }

        const meta = {...opf.meta, title: opf.meta.title || '未命名'}
        const totalChars = chapters.reduce((sum, chapter) => sum + chapter.charLength, 0)
        const totalBlocks = chapters.reduce((sum, chapter) => sum + chapter.blocks.length, 0)

        report('done', spine.length, spine.length, '解析完成')
        return {
            meta,
            chapters,
            toc,
            totalChars,
            totalBlocks,
            revoke() {
                images?.revoke()
                archive.close()
            },
        }
    } catch (err) {
        images?.revoke()
        archive.close()
        throw err
    }
}

export type {Block, Chapter, ParsedBook, TocNode, BookMeta} from './types'
export {EpubError} from './unzip'
export {ImageStore} from './content'
export {readToc} from './nav'
export {readOpf, parseContentDocument} from './opf'
export {openEpub} from './unzip'
