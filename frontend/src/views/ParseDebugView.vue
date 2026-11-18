<script setup lang="ts">
/**
 * 开发态解析自检页。仅 DEV 环境注册路由（见 router/index.ts）。
 *
 * 作用：在真实浏览器里跑一遍 `parseEpub`，把章节数 / 块数 / 字符数 / 目录树 / 插图
 * 直接摆在页面上，同时 `console.table` 输出，方便和设计文档里的预期数字对数。
 */

import {computed, onBeforeUnmount, onMounted, ref} from 'vue'

import {booksApi, type BookSummary} from '@/api/books'
import {type ParsedBook, parseEpub, type TocNode} from '@/lib/epub'

interface ChapterRow {
    index: number
    title: string
    blocks: number
    chars: number
    head: string
}

interface Report {
    bookId: string
    title: string
    author: string
    chapters: number
    blocks: number
    chars: number
    images: number
    tocRoots: number
    tocTotal: number
    ms: number
    toc: TocNode[]
    rows: ChapterRow[]
    gallery: string[]
    warnings: string[]
}

const books = ref<BookSummary[]>([])
const currentId = ref('')
const busy = ref(false)
const progress = ref('')
const report = ref<Report | null>(null)
const failure = ref<string | null>(null)
const restore = ref<string | null>(null)

let parsed: ParsedBook | null = null
let abort: AbortController | null = null

const current = computed(() => books.value.find((book) => book.id === currentId.value) ?? null)

onMounted(async () => {
    try {
        books.value = await booksApi.list()
        currentId.value = books.value[0]?.id ?? ''
    } catch (err) {
        failure.value = `书架读取失败：${String(err)}`
    }
})

onBeforeUnmount(() => {
    abort?.abort()
    parsed?.revoke()
})

function countToc(nodes: TocNode[]): number {
    return nodes.reduce((sum, node) => sum + 1 + countToc(node.children), 0)
}

async function run(): Promise<void> {
    const book = current.value
    if (!book || busy.value) return

    abort?.abort()
    abort = new AbortController()
    parsed?.revoke()
    parsed = null
    report.value = null
    failure.value = null
    restore.value = null
    busy.value = true
    progress.value = '下载中…'
    const started = performance.now()

    try {
        const response = await fetch(booksApi.fileUrl(book.id), {signal: abort.signal})
        if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
        const blob = await response.blob()

        const result = await parseEpub(blob, {
            signal: abort.signal,
            onProgress: (step) => {
                progress.value = step.message
            },
        })
        parsed = result

        const ms = Math.round(performance.now() - started)
        const rows: ChapterRow[] = result.chapters.map((chapter) => ({
            index: chapter.index,
            title: chapter.title ?? '（未命名）',
            blocks: chapter.blocks.length,
            chars: chapter.charLength,
            head: chapter.blocks.find((block) => block.text)?.text.slice(0, 28) ?? '',
        }))
        const gallery: string[] = []
        for (const chapter of result.chapters) {
            for (const block of chapter.blocks) {
                if (block.type === 'img' && block.src) gallery.push(block.src)
                if (gallery.length >= 8) break
            }
            if (gallery.length >= 8) break
        }

        report.value = {
            bookId: book.id,
            title: result.meta.title,
            author: result.meta.author ?? '—',
            chapters: result.chapters.length,
            blocks: result.totalBlocks,
            chars: result.totalChars,
            images: gallery.length,
            tocRoots: result.toc.length,
            tocTotal: countToc(result.toc),
            ms,
            toc: result.toc,
            rows,
            gallery,
            warnings: [],
        }

        console.info(`[epub] 解析完成：${result.meta.title}`, {
            chapters: result.chapters.length,
            blocks: result.totalBlocks,
            chars: result.totalChars,
            tocRoots: result.toc.length,
            tocTotal: countToc(result.toc),
            ms,
        })
        console.info('[epub] 目录树', result.toc)
        console.table(rows)
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            failure.value = '已取消'
        } else {
            failure.value = err instanceof Error ? err.message : String(err)
            console.error('[epub] 解析失败', err)
        }
    } finally {
        busy.value = false
        progress.value = ''
    }
}

async function pushToc(): Promise<void> {
    const currentReport = report.value
    if (!currentReport) return
    try {
        const saved = await booksApi.update(currentReport.bookId, {
            chapterCount: currentReport.chapters,
            toc: currentReport.toc,
        })
        restore.value = `已回传：chapterCount=${saved.chapterCount}，toc 根节点 ${saved.toc.length} 个`
        books.value = await booksApi.list()
        console.info('[epub] PATCH 成功', saved)
    } catch (err) {
        restore.value = `回传失败：${err instanceof Error ? err.message : String(err)}`
    }
}
</script>

<template>
    <main class="debug">
        <header class="head">
            <div>
                <p class="eyebrow">DEV · EPUB PARSER</p>
                <h1>解析自检</h1>
                <p class="hint">在浏览器里跑一遍 parseEpub，核对章节数、块数、字符数与目录树。</p>
            </div>
            <RouterLink class="back" to="/">返回书架</RouterLink>
        </header>

        <section class="controls">
            <select v-model="currentId" :disabled="busy">
                <option v-for="book in books" :key="book.id" :value="book.id">
                    {{ book.title }}
                </option>
            </select>
            <button class="primary" :disabled="busy || !current" @click="run">
                {{ busy ? '解析中…' : '解析这本书' }}
            </button>
            <button class="ghost" :disabled="busy || !report" @click="pushToc">
                目录回传后端
            </button>
            <span v-if="busy" class="progress">{{ progress }}</span>
        </section>

        <p v-if="failure" class="banner error">{{ failure }}</p>
        <p v-if="restore" class="banner notice">{{ restore }}</p>

        <template v-if="report">
            <section class="stats">
                <div class="stat">
                    <span class="num">{{ report.chapters }}</span>
                    <span class="label">章节</span>
                </div>
                <div class="stat">
                    <span class="num">{{ report.blocks }}</span>
                    <span class="label">块</span>
                </div>
                <div class="stat">
                    <span class="num">{{ report.chars.toLocaleString() }}</span>
                    <span class="label">字符</span>
                </div>
                <div class="stat">
                    <span class="num">{{ report.tocRoots }}/{{ report.tocTotal }}</span>
                    <span class="label">目录根/总</span>
                </div>
                <div class="stat">
                    <span class="num">{{ report.images }}</span>
                    <span class="label">插图</span>
                </div>
                <div class="stat">
                    <span class="num">{{ report.ms }}</span>
                    <span class="label">毫秒</span>
                </div>
            </section>

            <section class="panel">
                <h2>书名 / 作者</h2>
                <p class="meta-value">{{ report.title }} · {{ report.author }}</p>
            </section>

            <section v-if="report.gallery.length" class="panel">
                <h2>插图（blob: URL 实测）</h2>
                <div class="gallery">
                    <img v-for="src in report.gallery" :key="src" :src="src" alt="插图"/>
                </div>
            </section>

            <section class="panel">
                <h2>目录树</h2>
                <ul class="toc">
                    <li v-for="(node, i) in report.toc" :key="i">
                        <span class="toc-title">{{ node.title }}</span>
                        <span class="toc-loc">ch{{ node.chapter }}@{{ node.offset }}</span>
                        <ul v-if="node.children.length">
                            <li v-for="(child, j) in node.children" :key="j">
                                <span class="toc-title">{{ child.title }}</span>
                                <span class="toc-loc">ch{{ child.chapter }}@{{ child.offset }}</span>
                            </li>
                        </ul>
                    </li>
                </ul>
                <p v-if="!report.toc.length" class="empty">目录为空</p>
            </section>

            <section class="panel">
                <h2>章节明细</h2>
                <table class="chapters">
                    <thead>
                    <tr>
                        <th>#</th>
                        <th>标题</th>
                        <th class="num-col">块</th>
                        <th class="num-col">字符</th>
                        <th>首句</th>
                    </tr>
                    </thead>
                    <tbody>
                    <tr v-for="row in report.rows" :key="row.index">
                        <td class="mono">{{ row.index }}</td>
                        <td>{{ row.title }}</td>
                        <td class="num-col mono">{{ row.blocks }}</td>
                        <td class="num-col mono">{{ row.chars }}</td>
                        <td class="head-text">{{ row.head }}</td>
                    </tr>
                    </tbody>
                </table>
            </section>
        </template>

        <p v-else-if="!busy" class="empty">选一本书，点「解析这本书」。</p>
    </main>
</template>

<style scoped>
.debug {
    max-width: 1080px;
    margin: 0 auto;
    padding: 7vh 36px 80px;
    font-size: 13.5px;
}

.head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
}

.eyebrow {
    font-family: var(--font-classic);
    font-size: 11px;
    letter-spacing: 0.3em;
    color: var(--muted);
}

h1 {
    margin-top: 14px;
    font-family: var(--font-serif-sc);
    font-size: 32px;
    font-weight: 400;
    letter-spacing: 0.05em;
}

.hint {
    margin-top: 10px;
    color: var(--muted);
}

.back {
    font-size: 12.5px;
    padding: 7px 14px;
    border: 1px solid var(--hair);
    border-radius: 999px;
    color: var(--muted);
}

.controls {
    margin-top: 28px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

select {
    min-width: 260px;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--hair);
    background: rgba(0, 0, 0, 0.32);
    color: #f4ead6;
    font: inherit;
}

.primary {
    padding: 9px 18px;
    border-radius: 999px;
    background: var(--accent);
    color: #2b241c;
    font-size: 13px;
}

.primary:disabled,
.ghost:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.ghost {
    padding: 9px 16px;
    border-radius: 999px;
    border: 1px solid var(--hair);
    font-size: 13px;
}

.progress {
    color: var(--muted);
    font-size: 12.5px;
}

.banner {
    margin-top: 18px;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 13px;
}

.banner.error {
    background: rgba(170, 66, 56, 0.18);
    border: 1px solid rgba(214, 106, 96, 0.35);
    color: #f2cec9;
}

.banner.notice {
    background: var(--accent-soft);
    border: 1px solid rgba(240, 185, 90, 0.32);
    color: #f3ddba;
}

.stats {
    margin-top: 26px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
}

.stat {
    padding: 16px 18px;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid var(--hair);
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.stat .num {
    font-family: var(--font-classic);
    font-size: 24px;
    font-variant-numeric: tabular-nums;
}

.stat .label {
    font-size: 11.5px;
    letter-spacing: 0.16em;
    color: var(--muted);
}

.panel {
    margin-top: 22px;
    padding: 20px 22px;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid var(--hair);
}

.panel h2 {
    font-family: var(--font-serif-sc);
    font-size: 15px;
    font-weight: 400;
    letter-spacing: 0.06em;
    margin-bottom: 14px;
    color: var(--muted);
}

.meta-value {
    font-size: 14px;
}

.gallery {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
}

.gallery img {
    height: 132px;
    width: auto;
    border-radius: 6px;
    background: #fff;
    padding: 6px;
}

.toc,
.toc ul {
    list-style: none;
    margin: 0;
    padding: 0;
}

.toc ul {
    margin-left: 18px;
    padding-left: 12px;
    border-left: 1px solid rgba(255, 255, 255, 0.12);
}

.toc li {
    padding: 3px 0;
    display: flex;
    gap: 10px;
    align-items: baseline;
    flex-wrap: wrap;
}

.toc li ul {
    flex-basis: 100%;
}

.toc-loc {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 11px;
    color: var(--muted);
}

.chapters {
    width: 100%;
    border-collapse: collapse;
}

.chapters th,
.chapters td {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    vertical-align: top;
}

.chapters th {
    font-weight: 400;
    font-size: 11.5px;
    letter-spacing: 0.08em;
    color: var(--muted);
}

.num-col {
    text-align: right;
}

.mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
}

.head-text {
    color: var(--muted);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty {
    margin-top: 24px;
    color: var(--muted);
}
</style>
