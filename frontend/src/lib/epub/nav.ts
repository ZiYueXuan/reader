/**
 * 目录解析：优先 `nav.xhtml`（EPUB 3），回退 `toc.ncx`（EPUB 2）。
 *
 * 目录项最终必须落到 `{chapter, offset}`——页码不进存储，见 design/02-architecture.md §4.3。
 * 指向封皮、版权页等非 spine 文档的节点会被就地「提升」：丢掉自己，保留子节点。
 */

import {localName, type OpfDocument, parseContentDocument} from './opf'
import type {TocNode} from './types'
import {dirname, type EpubArchive, resolveHref} from './unzip'

export interface TocChapterContext {
    href: string
    idOffsets: Map<string, number>
}

export interface TocResult {
    toc: TocNode[]
    /** 章序号 → 章名，取目录里指向该章的首个节点 */
    titles: Map<number, string>
}

interface RawNode {
    label: string
    href: string | null
    baseDir: string
    children: RawNode[]
}

function epubTypeOf(el: Element): string {
    return (
        el.getAttribute('epub:type') ??
        el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ??
        ''
    )
}

function firstDescendant(root: Element | Document, name: string): Element | null {
    const all = root.getElementsByTagName('*')
    for (let i = 0; i < all.length; i += 1) {
        if (localName(all[i]) === name) return all[i]
    }
    return null
}

function cleanLabel(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

function splitHref(href: string): [string, string] {
    const index = href.indexOf('#')
    return index < 0 ? [href, ''] : [href.slice(0, index), href.slice(index + 1)]
}

/* ------------------------------------------------------------------ nav.xhtml */

function parseNavList(list: Element, baseDir: string): RawNode[] {
    const nodes: RawNode[] = []

    for (const li of Array.from(list.children)) {
        if (localName(li) !== 'li') continue
        const children = Array.from(li.children)
        const anchor = children.find((child) => localName(child) === 'a')
        const span = children.find((child) => localName(child) === 'span')
        const sublist = children.find((child) => ['ol', 'ul'].includes(localName(child)))

        const node: RawNode = {
            label: cleanLabel(anchor?.textContent ?? span?.textContent),
            href: anchor?.getAttribute('href') ?? null,
            baseDir,
            children: sublist ? parseNavList(sublist, baseDir) : [],
        }
        if (node.label || node.children.length) nodes.push(node)
    }
    return nodes
}

async function readNav(archive: EpubArchive, path: string): Promise<RawNode[]> {
    const doc = parseContentDocument(await archive.text(path))
    const baseDir = dirname(path)
    const navs = Array.from(doc.getElementsByTagName('*')).filter((el) => localName(el) === 'nav')
    if (!navs.length) return []

    const tocNav =
        navs.find((nav) => epubTypeOf(nav).split(/\s+/).includes('toc')) ??
        navs.find((nav) => firstDescendant(nav, 'ol') !== null)
    if (!tocNav) return []

    const list = firstDescendant(tocNav, 'ol')
    return list ? parseNavList(list, baseDir) : []
}

/* ------------------------------------------------------------------ toc.ncx */

function parseNavPoints(parent: Element, baseDir: string): RawNode[] {
    const nodes: RawNode[] = []

    for (const navPoint of Array.from(parent.children)) {
        if (localName(navPoint) !== 'navpoint') continue
        const directChildren = Array.from(navPoint.children)
        const labelEl = directChildren.find((child) => localName(child) === 'navlabel')
        const contentEl = directChildren.find((child) => localName(child) === 'content')

        nodes.push({
            label: cleanLabel(labelEl?.textContent),
            href: contentEl?.getAttribute('src') ?? null,
            baseDir,
            children: parseNavPoints(navPoint, baseDir),
        })
    }
    return nodes
}

async function readNcx(archive: EpubArchive, path: string): Promise<RawNode[]> {
    const doc = parseContentDocument(await archive.text(path))
    const navMap = firstDescendant(doc, 'navmap')
    return navMap ? parseNavPoints(navMap, dirname(path)) : []
}

/* ------------------------------------------------------------------ 映射 */

function chapterIndexByHref(contexts: TocChapterContext[]): Map<string, number> {
    const map = new Map<string, number>()
    contexts.forEach((chapter, index) => {
        map.set(chapter.href.toLowerCase(), index)
    })
    return map
}

export async function readToc(
    archive: EpubArchive,
    opf: OpfDocument,
    chapters: TocChapterContext[],
): Promise<TocResult> {
    const byHref = chapterIndexByHref(chapters)

    const locate = (href: string, baseDir: string): { chapter: number; offset: number } | null => {
        const [pathPart, fragment] = splitHref(href)
        const target = resolveHref(baseDir, pathPart).toLowerCase()
        const chapter = byHref.get(target)
        if (chapter === undefined) return null

        let id = fragment
        try {
            id = decodeURIComponent(fragment)
        } catch {
            /* 保留原样 */
        }
        const offset = id ? chapters[chapter].idOffsets.get(id) ?? 0 : 0
        return {chapter, offset}
    }

    let raw: RawNode[] = []
    if (opf.navPath) {
        raw = await readNav(archive, opf.navPath)
    }
    if (!raw.length && opf.ncxPath) {
        raw = await readNcx(archive, opf.ncxPath)
    }

    const toc: TocNode[] = []
    const convert = (nodes: RawNode[], out: TocNode[]): void => {
        for (const node of nodes) {
            const children: TocNode[] = []
            convert(node.children, children)
            const location = node.href ? locate(node.href, node.baseDir) : null

            if (location) {
                out.push({
                    title: node.label || `第 ${location.chapter + 1} 节`,
                    chapter: location.chapter,
                    offset: location.offset,
                    children,
                })
            } else if (children.length) {
                // 指向封面/不存在文档的分组节点：保留分组名，位置借用第一个子节点
                out.push({
                    title: node.label || children[0].title,
                    chapter: children[0].chapter,
                    offset: children[0].offset,
                    children,
                })
            }
        }
    }
    convert(raw, toc)

    const titles = new Map<number, string>()
    const collect = (nodes: TocNode[]): void => {
        for (const node of nodes) {
            const current = titles.get(node.chapter)
            if (!current || node.offset === 0) titles.set(node.chapter, node.title)
            collect(node.children)
        }
    }
    collect(toc)

    return {toc, titles}
}
