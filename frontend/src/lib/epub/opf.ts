/**
 * container.xml → OPF 解析：manifest / spine / metadata / 封面 / 导航文档位置。
 *
 * spine 的顺序就是章节顺序，这一点是内容模型的地基，不要按文件名排序。
 */

import type {BookMeta} from './types'
import {dirname, type EpubArchive, EpubError, resolveHref} from './unzip'

export interface ManifestItem {
    id: string
    /** zip 内绝对路径 */
    href: string
    rawHref: string
    mediaType: string
    properties: string[]
}

export interface SpineItem {
    idref: string
    href: string
    mediaType: string
    linear: boolean
    properties: string[]
}

export interface OpfDocument {
    version: string
    /** OPF 在 zip 内的路径 */
    path: string
    /** OPF 所在目录，用于解析 href */
    dir: string
    meta: BookMeta
    manifest: ManifestItem[]
    byId: Map<string, ManifestItem>
    /** href → media-type，给图片标注 MIME 用 */
    mediaTypes: Map<string, string>
    spine: SpineItem[]
    coverPath: string | null
    navPath: string | null
    ncxPath: string | null
}

const DC_FIELDS = ['title', 'creator', 'publisher', 'language', 'identifier'] as const

export function localName(el: Element): string {
    return (el.localName ?? el.nodeName).toLowerCase()
}

/** 收集子孙元素里 localName 匹配的全部节点（忽略命名空间前缀差异） */
function byName(root: Document | Element, name: string): Element[] {
    const all = root.getElementsByTagName('*')
    const out: Element[] = []
    for (let i = 0; i < all.length; i += 1) {
        const el = all[i]
        if (localName(el) === name) out.push(el)
    }
    return out
}

function textOf(el: Element | undefined): string | undefined {
    const value = el?.textContent?.replace(/\s+/g, ' ').trim()
    return value || undefined
}

export function parseXml(text: string, what: string): Document {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.querySelector('parsererror')) {
        throw new EpubError(`${what} 不是合法 XML`)
    }
    return doc
}

/**
 * 内容文档按 XHTML 读；XML 解析失败时退回 HTML 解析。
 * 现实里的 EPUB 有不少其实是 HTML5，硬按 XML 会整章丢弃。
 */
export function parseContentDocument(text: string): Document {
    try {
        return parseXml(text, 'XHTML')
    } catch {
        return new DOMParser().parseFromString(text, 'text/html')
    }
}

export async function readOpf(archive: EpubArchive): Promise<OpfDocument> {
    if (!archive.has('META-INF/container.xml')) {
        throw new EpubError('缺少 META-INF/container.xml，不是 EPUB 文件')
    }
    const container = parseXml(await archive.text('META-INF/container.xml'), 'container.xml')
    const rootfile = byName(container, 'rootfile')[0]
    const opfPath = rootfile?.getAttribute('full-path')?.trim()
    if (!opfPath) {
        throw new EpubError('container.xml 里没有 rootfile，不是 EPUB 文件')
    }

    const opfDoc = parseXml(await archive.text(opfPath), 'OPF')
    const opfDir = dirname(opfPath)
    const packageEl = byName(opfDoc, 'package')[0]

    // ---- metadata ----
    const meta: BookMeta = {title: ''}
    const metadata = byName(opfDoc, 'metadata')[0]
    if (metadata) {
        const values = new Map<string, string>()
        for (const el of Array.from(metadata.getElementsByTagName('*'))) {
            const name = localName(el)
            if (!(DC_FIELDS as readonly string[]).includes(name)) continue
            const value = textOf(el)
            if (value && !values.has(name)) values.set(name, value)
        }
        meta.title = values.get('title') ?? ''
        meta.author = values.get('creator')
        meta.publisher = values.get('publisher')
        meta.language = values.get('language')
        meta.identifier = values.get('identifier')
    }

    // ---- manifest ----
    const manifest: ManifestItem[] = []
    const byId = new Map<string, ManifestItem>()
    const mediaTypes = new Map<string, string>()
    for (const el of byName(opfDoc, 'item')) {
        const id = el.getAttribute('id')
        const rawHref = el.getAttribute('href')
        if (!id || !rawHref) continue
        const href = resolveHref(opfDir, rawHref)
        const item: ManifestItem = {
            id,
            href,
            rawHref,
            mediaType: (el.getAttribute('media-type') ?? '').toLowerCase(),
            properties: (el.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean),
        }
        manifest.push(item)
        byId.set(id, item)
        if (item.mediaType) mediaTypes.set(href, item.mediaType)
    }

    // ---- spine ----
    const spineEl = byName(opfDoc, 'spine')[0]
    const spine: SpineItem[] = []
    if (spineEl) {
        for (const ref of Array.from(spineEl.children)) {
            if (localName(ref) !== 'itemref') continue
            const idref = ref.getAttribute('idref')
            const item = idref ? byId.get(idref) : undefined
            if (!item) {
                console.warn('[epub] spine 里的 itemref 找不到对应 manifest 项', {idref})
                continue
            }
            spine.push({
                idref: item.id,
                href: item.href,
                mediaType: item.mediaType || 'application/xhtml+xml',
                linear: (ref.getAttribute('linear') ?? 'yes').toLowerCase() !== 'no',
                properties: item.properties,
            })
        }
    }
    if (!spine.length) {
        throw new EpubError('spine 是空的，这本书没有可读内容')
    }

    // ---- 封面 / 导航 ----
    let coverPath: string | null = null
    const coverItem = manifest.find((item) => item.properties.includes('cover-image'))
    if (coverItem) {
        coverPath = coverItem.href
    } else {
        const coverMeta = byName(opfDoc, 'meta').find(
            (el) => (el.getAttribute('name') ?? '').toLowerCase() === 'cover',
        )
        const coverId = coverMeta?.getAttribute('content')
        coverPath = coverId ? byId.get(coverId)?.href ?? null : null
    }

    const navItem = manifest.find((item) => item.properties.includes('nav'))
    const navPath = navItem ? navItem.href : null

    const tocId = spineEl?.getAttribute('toc')
    const ncxPath =
        manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml')?.href ??
        (tocId ? byId.get(tocId)?.href ?? null : null)

    return {
        version: packageEl?.getAttribute('version') ?? '',
        path: opfPath,
        dir: opfDir,
        meta,
        manifest,
        byId,
        mediaTypes,
        spine,
        coverPath,
        navPath,
        ncxPath,
    }
}
