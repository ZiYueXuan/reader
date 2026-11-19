<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'

import {booksApi} from '@/api/books'
import {api} from '@/api/client'
import {useLibrary} from '@/stores/library'

const router = useRouter()
const library = useLibrary()
const isDev = import.meta.env.DEV

/* ---------------------------------------------------------------- 后端连通性 */
const health = ref<'pending' | 'ok' | 'error'>('pending')
const healthLabel = computed(
    () =>
        ({
            pending: '正在连接后端…',
            ok: '后端已连接',
            error: '后端未连接',
        })[health.value],
)

onMounted(async () => {
    try {
        const result = await api.health()
        health.value = result.ok ? 'ok' : 'error'
    } catch {
        health.value = 'error'
    }
    await library.load()
})

/* -------------------------------------------------------------------- 选择文件 */
const fileInput = ref<HTMLInputElement | null>(null)

function pickFile(): void {
    fileInput.value?.click()
}

function onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement
    if (input.files?.length) void library.upload(input.files)
    input.value = ''
}

/* ---------------------------------------------------------------- 全窗口拖放 */
const dragging = ref(false)
let dragDepth = 0

function hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragEnter(event: DragEvent): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth += 1
    dragging.value = true
}

function onDragOver(event: DragEvent): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event: DragEvent): void {
    if (!hasFiles(event)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) dragging.value = false
}

function onDrop(event: DragEvent): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth = 0
    dragging.value = false
    if (event.dataTransfer?.files.length) void library.upload(event.dataTransfer.files)
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        dragging.value = false
        pendingId.value = null
    }
}

onMounted(() => {
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
    window.removeEventListener('dragenter', onDragEnter)
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('dragleave', onDragLeave)
    window.removeEventListener('drop', onDrop)
    window.removeEventListener('keydown', onKeydown)
})

/* ------------------------------------------------------------------ 提示自动消失 */
let noticeTimer: number | undefined
watch(
    () => library.notice,
    (value) => {
        window.clearTimeout(noticeTimer)
        if (value) noticeTimer = window.setTimeout(() => library.dismiss(), 4500)
    },
)
onBeforeUnmount(() => window.clearTimeout(noticeTimer))

/* -------------------------------------------------------------------- 卡片交互 */
const pendingId = ref<string | null>(null)

function openBook(id: string): void {
    void router.push({name: 'reader', params: {id}})
}

async function confirmRemove(id: string): Promise<void> {
    pendingId.value = null
    await library.remove(id)
}

function pct(ratio: number): number {
    return Math.round(Math.max(0, Math.min(1, ratio)) * 100)
}

function progressLabel(ratio: number): string {
    if (ratio >= 0.9) return '已读'
    if (ratio > 0) return `${pct(ratio)}%`
    return '未读'
}

function formatSize(bytes: number | null): string {
    if (!bytes) return ''
    const mb = bytes / (1024 * 1024)
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}
</script>

<template>
    <main class="shelf">
        <header class="head">
            <div class="intro">
                <p class="eyebrow">READER</p>
                <h1>书架</h1>
                <p class="hint">
                    {{
                        library.count
                            ? `这张书桌上放着 ${library.count} 本书。`
                            : '所有书都放在这张书桌上。'
                    }}
                </p>
            </div>

            <div class="actions">
                <span class="status" :class="health">
                    <span class="dot"/>
                    {{ healthLabel }}
                </span>
                <button class="import" :disabled="library.task !== null" @click="pickFile">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M8 2v9m0-9 3.2 3.2M8 2 4.8 5.2M2.5 11v2.5h11V11"/>
                    </svg>
                    导入 EPUB
                </button>
            </div>
        </header>

        <input
            ref="fileInput"
            class="file"
            type="file"
            accept=".epub,application/epub+zip"
            multiple
            @change="onFileChange"
        />

        <p v-if="library.error" class="banner error" @click="library.dismiss()">
            <span>{{ library.error }}</span>
            <span class="close">×</span>
        </p>
        <p v-else-if="library.notice" class="banner notice" @click="library.dismiss()">
            <span>{{ library.notice }}</span>
            <span class="close">×</span>
        </p>

        <section v-if="library.loading && !library.loaded" class="empty">
            <p class="empty-title">正在打开书柜…</p>
        </section>

        <section v-else-if="!library.count" class="empty">
            <p class="empty-title">书架还是空的</p>
            <p class="empty-body">
                把 <code>.epub</code> 拖到窗口任意位置，或点右上角的「导入 EPUB」。<br/>
                公版样书在项目的 <code>samples/</code> 目录里（《呐喊》与《爱丽丝梦游仙境》）。
            </p>
            <button class="ghost" @click="pickFile">选择文件</button>
        </section>

        <ul v-else class="grid">
            <li v-for="book in library.items" :key="book.id" class="cell">
                <article
                    class="card"
                    role="button"
                    tabindex="0"
                    @click="openBook(book.id)"
                    @keydown.enter="openBook(book.id)"
                >
                    <div class="cover">
                        <img
                            v-if="book.coverUrl"
                            :src="booksApi.coverUrl(book.id)"
                            :alt="`《${book.title}》封面`"
                            loading="lazy"
                            decoding="async"
                        />
                        <div v-else class="no-cover">
                            <span>{{ book.title }}</span>
                        </div>
                        <span class="spine" aria-hidden="true"/>
                        <span v-if="book.percent > 0" class="meter" aria-hidden="true">
                            <i :style="{width: `${pct(book.percent)}%`}"/>
                        </span>
                    </div>

                    <div class="meta">
                        <p class="title" :title="book.title">{{ book.title }}</p>
                        <p class="author">{{ book.author || '佚名' }}</p>
                        <p class="sub">
                            <span>{{ progressLabel(book.percent) }}</span>
                            <span v-if="book.chapterCount">{{ book.chapterCount }} 章</span>
                            <span v-if="book.fileSize">{{ formatSize(book.fileSize) }}</span>
                        </p>
                    </div>
                </article>

                <button
                    class="remove"
                    title="从书架移除"
                    aria-label="从书架移除"
                    @click.stop="pendingId = book.id"
                >
                    ×
                </button>

                <div v-if="pendingId === book.id" class="confirm" @click.stop>
                    <p class="confirm-title">从书架移除？</p>
                    <p class="confirm-body">《{{ book.title }}》的文件会一起删除。</p>
                    <div class="confirm-actions">
                        <button class="ghost small" @click="pendingId = null">取消</button>
                        <button class="danger small" @click="confirmRemove(book.id)">移除</button>
                    </div>
                </div>
            </li>
        </ul>

        <footer class="foot">
            <span>EPUB 3 · 本地存储</span>
            <span class="foot-right">
                <RouterLink v-if="isDev" to="/debug/parse" class="dev-link">解析自检</RouterLink>
                <RouterLink v-if="isDev" to="/debug/pagination" class="dev-link">分页自检</RouterLink>
                <span v-if="library.count">共 {{ library.count }} 本</span>
            </span>
        </footer>

        <Transition name="fade">
            <div v-if="dragging" class="drop">
                <div class="drop-frame">
                    <p class="drop-title">松手，放到书桌上</p>
                    <p class="drop-sub">支持一次拖入多本 .epub</p>
                </div>
            </div>
        </Transition>

        <Transition name="rise">
            <div v-if="library.task" class="task">
                <p class="task-name">{{ library.task.name }}</p>
                <span class="task-bar">
                    <i :style="{width: `${pct(library.task.ratio)}%`}"/>
                </span>
                <span class="task-num">{{ pct(library.task.ratio) }}%</span>
            </div>
        </Transition>
    </main>
</template>

<style scoped>
.shelf {
    max-width: 1180px;
    margin: 0 auto;
    padding: 9vh 40px 72px;
}

/* ------------------------------------------------------------------ 顶部 */
.head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 28px;
    flex-wrap: wrap;
}

.eyebrow {
    font-family: var(--font-classic);
    font-size: 12px;
    letter-spacing: 0.32em;
    color: var(--muted);
    margin-bottom: 18px;
}

h1 {
    font-family: var(--font-serif-sc);
    font-size: 44px;
    font-weight: 400;
    letter-spacing: 0.06em;
}

.hint {
    margin-top: 12px;
    color: var(--muted);
    font-size: 14px;
}

.actions {
    display: flex;
    align-items: center;
    gap: 14px;
}

.status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 13px;
    border: 1px solid var(--hair);
    border-radius: 999px;
    font-size: 12.5px;
    color: var(--muted);
    background: rgba(0, 0, 0, 0.16);
}

.dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8c8c8c;
}

.status.ok {
    color: var(--accent);
    border-color: var(--accent-soft);
}

.status.ok .dot {
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
}

.status.error .dot {
    background: #d9736a;
}

.import {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font-size: 14px;
    letter-spacing: 0.02em;
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.28);
    transition: transform 220ms var(--ease),
    box-shadow 220ms var(--ease),
    opacity 220ms var(--ease);
}

.import svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.import:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 16px 30px rgba(0, 0, 0, 0.34);
}

.import:disabled {
    opacity: 0.55;
    cursor: progress;
}

.file {
    display: none;
}

/* ------------------------------------------------------------------ 提示条 */
.banner {
    margin-top: 26px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 16px;
    border-radius: 12px;
    font-size: 13.5px;
    cursor: pointer;
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

.banner .close {
    opacity: 0.6;
    font-size: 16px;
    line-height: 1;
}

/* ------------------------------------------------------------------ 书架网格 */
.grid {
    list-style: none;
    margin: 44px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 36px 26px;
}

.cell {
    position: relative;
}

.card {
    display: block;
    cursor: pointer;
    outline: none;
}

.card:focus-visible .cover {
    box-shadow: 0 0 0 2px var(--accent),
    0 22px 36px rgba(0, 0, 0, 0.42);
}

.cover {
    position: relative;
    aspect-ratio: 2 / 3;
    border-radius: 3px 8px 8px 3px;
    overflow: hidden;
    background: #2a2521;
    box-shadow: 0 18px 30px rgba(0, 0, 0, 0.4),
    0 2px 4px rgba(0, 0, 0, 0.3);
    transition: transform 260ms var(--ease),
    box-shadow 260ms var(--ease);
}

.card:hover .cover {
    transform: translateY(-6px);
    box-shadow: 0 26px 42px rgba(0, 0, 0, 0.46),
    0 3px 6px rgba(0, 0, 0, 0.32);
}

.cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.no-cover {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 18px 14px;
    text-align: center;
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.08), transparent 55%),
    linear-gradient(200deg, #6d6153, #3a332c 78%);
}

.no-cover span {
    font-family: var(--font-serif-sc);
    font-size: 15px;
    line-height: 1.7;
    letter-spacing: 0.08em;
    color: rgba(246, 236, 216, 0.88);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* 书脊：左侧一道暗边，让封面看起来像本书 */
.spine {
    position: absolute;
    inset: 0 auto 0 0;
    width: 7px;
    background: linear-gradient(
        to right,
        rgba(0, 0, 0, 0.42),
        rgba(0, 0, 0, 0.16) 55%,
        transparent
    );
    pointer-events: none;
}

.meter {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: rgba(0, 0, 0, 0.35);
}

.meter i {
    display: block;
    height: 100%;
    background: var(--accent);
}

.meta {
    margin-top: 15px;
}

.meta .title {
    font-family: var(--font-serif-sc), serif;
    font-size: 15px;
    letter-spacing: 0.02em;
    color: #f4ead6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.meta .author {
    margin-top: 5px;
    font-size: 12.5px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.meta .sub {
    margin-top: 7px;
    display: flex;
    gap: 10px;
    font-size: 11.5px;
    letter-spacing: 0.04em;
    color: rgba(244, 234, 214, 0.42);
}

/* ------------------------------------------------------------------ 移除 */
.remove {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 15px;
    line-height: 1;
    color: rgba(246, 236, 216, 0.8);
    background: rgba(20, 16, 13, 0.6);
    backdrop-filter: blur(6px);
    opacity: 0;
    transition: opacity 180ms var(--ease);
}

.cell:hover .remove,
.remove:focus-visible {
    opacity: 1;
}

.confirm {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 18px 14px;
    text-align: center;
    border-radius: 10px;
    background: rgba(24, 20, 17, 0.86);
    backdrop-filter: blur(8px);
    border: 1px solid var(--hair);
}

.confirm-title {
    font-size: 13.5px;
    color: #f4ead6;
}

.confirm-body {
    font-size: 12px;
    line-height: 1.7;
    color: var(--muted);
}

.confirm-actions {
    margin-top: 6px;
    display: flex;
    gap: 8px;
}

/* ------------------------------------------------------------------ 按钮 */
.ghost {
    padding: 8px 16px;
    border-radius: 999px;
    border: 1px solid var(--hair);
    color: #f1e7d3;
    font-size: 13px;
    background: rgba(255, 255, 255, 0.04);
    transition: background-color 200ms var(--ease);
}

.ghost:hover {
    background: rgba(255, 255, 255, 0.1);
}

.danger {
    padding: 8px 16px;
    border-radius: 999px;
    background: #9d4438;
    color: #fbeae6;
    font-size: 13px;
    transition: background-color 200ms var(--ease);
}

.danger:hover {
    background: #b04f42;
}

.small {
    padding: 6px 13px;
    font-size: 12.5px;
}

/* ------------------------------------------------------------------ 空态 */
.empty {
    margin-top: 44px;
    padding: 56px 40px;
    border: 1px dashed var(--hair);
    border-radius: var(--radius-panel);
    background: rgba(0, 0, 0, 0.12);
    text-align: center;
}

.empty-title {
    font-family: var(--font-serif-sc);
    font-size: 19px;
    letter-spacing: 0.06em;
}

.empty-body {
    margin: 14px auto 26px;
    max-width: 44em;
    font-size: 13.5px;
    line-height: 2;
    color: var(--muted);
}

code {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.92em;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
}

.foot {
    margin-top: 56px;
    padding-top: 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    display: flex;
    justify-content: space-between;
    font-family: var(--font-classic);
    font-size: 12px;
    letter-spacing: 0.14em;
    color: rgba(244, 234, 214, 0.34);
}

.foot-right {
    display: inline-flex;
    align-items: center;
    gap: 18px;
}

.dev-link {
    color: rgba(244, 234, 214, 0.5);
    border-bottom: 1px dashed rgba(244, 234, 214, 0.28);
}

.dev-link:hover {
    color: var(--accent);
    border-color: var(--accent);
}

/* ------------------------------------------------------------------ 拖放遮罩 */
.drop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgba(22, 18, 15, 0.55);
    backdrop-filter: blur(10px);
}

.drop-frame {
    padding: 52px 84px;
    border: 2px dashed rgba(244, 234, 214, 0.42);
    border-radius: 26px;
    text-align: center;
    background: rgba(22, 18, 15, 0.35);
    box-shadow: var(--shadow);
}

.drop-title {
    font-family: var(--font-serif-sc);
    font-size: 22px;
    letter-spacing: 0.08em;
}

.drop-sub {
    margin-top: 12px;
    font-size: 13px;
    color: var(--muted);
}

/* ------------------------------------------------------------------ 上传进度 */
.task {
    position: fixed;
    right: 26px;
    bottom: 26px;
    z-index: 40;
    width: 280px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px 12px;
    padding: 15px 17px;
    border-radius: 14px;
    background: var(--panel);
    border: 1px solid var(--hair);
    backdrop-filter: blur(18px);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.36);
}

.task-name {
    grid-column: 1 / -1;
    font-size: 13px;
    color: #f1e7d3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.task-bar {
    height: 3px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
    overflow: hidden;
    align-self: center;
}

.task-bar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 160ms linear;
}

.task-num {
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
}

/* ------------------------------------------------------------------ 过渡 */
.fade-enter-active,
.fade-leave-active {
    transition: opacity 200ms var(--ease);
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.rise-enter-active,
.rise-leave-active {
    transition: opacity 220ms var(--ease),
    transform 220ms var(--ease);
}

.rise-enter-from,
.rise-leave-to {
    opacity: 0;
    transform: translateY(12px);
}

@media (max-width: 640px) {
    .shelf {
        padding: 7vh 22px 56px;
    }

    h1 {
        font-size: 34px;
    }

    .grid {
        grid-template-columns: repeat(auto-fill, minmax(126px, 1fr));
        gap: 28px 18px;
    }

    .drop-frame {
        padding: 40px 36px;
    }
}
</style>
