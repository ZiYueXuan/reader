/**
 * EPUB 解包与路径工具。
 *
 * 只做三件事：校验 mimetype、按路径取条目、把相对 href 规整成 zip 内绝对路径。
 * 所有路径统一为「正斜杠、无前导斜杠、无 ./ 与 ../」的形式。
 */

import JSZip from 'jszip'

export class EpubError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'EpubError'
    }
}

export interface EpubArchive {
    /** 全部文件路径（不含目录条目） */
    readonly names: string[]

    has(path: string): boolean

    entry(path: string): JSZip.JSZipObject | null

    text(path: string): Promise<string>

    bytes(path: string): Promise<Uint8Array>

    /** 读成 Blob 并按给定 MIME 标注，供 URL.createObjectURL 使用 */
    blob(path: string, type: string): Promise<Blob>

    close(): void
}

const MIME_URL_RE = /^(data:|https?:|blob:)/i

/** 是不是外链 / data URL，不需要从 zip 里取 */
export function isExternalUrl(href: string): boolean {
    return MIME_URL_RE.test(href)
}

/**
 * 把 href 解析成 zip 内绝对路径。
 * `baseDir` 是引用方所在目录（相对于 zip 根，空串表示根）。
 */
export function resolveHref(baseDir: string, href: string): string {
    const withoutHash = href.split('#')[0]
    if (isExternalUrl(withoutHash)) return withoutHash

    let decoded = withoutHash
    try {
        decoded = decodeURIComponent(withoutHash)
    } catch {
        /* 非法的百分号编码，保持原样 */
    }

    const segments = `${baseDir ? `${baseDir}/` : ''}${decoded}`.replace(/\\/g, '/').split('/')
    const stack: string[] = []
    for (const segment of segments) {
        if (!segment || segment === '.') continue
        if (segment === '..') {
            stack.pop()
            continue
        }
        stack.push(segment)
    }
    return stack.join('/')
}

/** 路径的目录部分，根目录返回空串 */
export function dirname(path: string): string {
    const index = path.lastIndexOf('/')
    return index < 0 ? '' : path.slice(0, index)
}

/**
 * 按 XML 声明里的 encoding 解码。
 * 中文 EPUB 里 GBK 编码不少见，直接当 UTF-8 读会得到一堆替换字符。
 */
export function decodeXmlText(bytes: Uint8Array): string {
    const head = new TextDecoder('utf-8', {fatal: false}).decode(bytes.subarray(0, 200))
    const declared = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase()

    if (declared && declared !== 'utf-8' && declared !== 'utf8') {
        try {
            return stripBom(new TextDecoder(declared).decode(bytes))
        } catch {
            /* 浏览器不支持这个编码，退回 UTF-8 */
        }
    }
    return stripBom(new TextDecoder('utf-8').decode(bytes))
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export async function openEpub(source: Blob | ArrayBuffer | Uint8Array): Promise<EpubArchive> {
    let zip: JSZip
    try {
        zip = await JSZip.loadAsync(source)
    } catch {
        throw new EpubError('不是合法的 EPUB 文件（ZIP 解包失败）')
    }

    // 有些打包工具会在最外层多套一个目录，按 container.xml 的实际位置推断前缀。
    const all = Object.keys(zip.files).filter((path) => !zip.files[path].dir)
    const containerName = all.find((path) => path.endsWith('META-INF/container.xml'))
    if (!containerName) {
        throw new EpubError('缺少 META-INF/container.xml，不是 EPUB 文件')
    }
    const prefix = containerName.slice(0, containerName.length - 'META-INF/container.xml'.length)

    const byLower = new Map<string, string>()
    for (const path of all) {
        byLower.set(path.slice(prefix.length).toLowerCase(), path)
    }

    const names = all.map((path) => path.slice(prefix.length))
    const lookup = (path: string): string | null => {
        const key = path.replace(/^\.?\//, '')
        if (zip.files[`${prefix}${key}`]) return `${prefix}${key}`
        return byLower.get(key.toLowerCase()) ?? null
    }

    const getEntry = (path: string): JSZip.JSZipObject | null => {
        const actual = lookup(path)
        return actual ? zip.file(actual) ?? null : null
    }

    const mimetype = getEntry('mimetype')
    if (!mimetype) {
        throw new EpubError('缺少 mimetype，不是标准 EPUB 文件')
    }
    const declared = (await mimetype.async('string')).trim()
    if (declared !== 'application/epub+zip') {
        throw new EpubError(`mimetype 是 ${declared || '空'}，应为 application/epub+zip`)
    }

    return {
        names,
        has: (path) => getEntry(path) !== null,
        entry: getEntry,
        async text(path) {
            const entry = getEntry(path)
            if (!entry) throw new EpubError(`找不到文件：${path}`)
            return decodeXmlText(await entry.async('uint8array'))
        },
        async bytes(path) {
            const entry = getEntry(path)
            if (!entry) throw new EpubError(`找不到文件：${path}`)
            return entry.async('uint8array')
        },
        async blob(path, type) {
            const entry = getEntry(path)
            if (!entry) throw new EpubError(`找不到文件：${path}`)
            return new Blob([await entry.async('blob')], {type})
        },
        close() {
            // JSZip 没有显式释放接口，丢掉引用即可让 GC 回收
            zip = new JSZip()
        },
    }
}
