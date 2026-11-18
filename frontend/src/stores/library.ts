/** 书架状态：列表、上传队列、错误与提示。 */

import {defineStore} from 'pinia'
import {computed, ref} from 'vue'

import {booksApi, type BookSummary} from '@/api/books'
import {ApiError} from '@/api/client'

export interface UploadTask {
    name: string
    /** 0–1 */
    ratio: number
}

const EPUB_MIME = 'application/epub+zip'

function isEpub(file: File): boolean {
    return file.name.toLowerCase().endsWith('.epub') || file.type === EPUB_MIME
}

export const useLibrary = defineStore('library', () => {
    const items = ref<BookSummary[]>([])
    const loading = ref(false)
    const loaded = ref(false)
    const task = ref<UploadTask | null>(null)
    const error = ref<string | null>(null)
    const notice = ref<string | null>(null)

    const count = computed(() => items.value.length)
    const busy = computed(() => loading.value || task.value !== null)

    async function load(force = false): Promise<void> {
        if (loaded.value && !force) return
        loading.value = true
        try {
            items.value = await booksApi.list()
            loaded.value = true
            error.value = null
        } catch (err) {
            error.value = err instanceof ApiError ? err.message : '书架加载失败'
        } finally {
            loading.value = false
        }
    }

    async function upload(files: FileList | File[]): Promise<void> {
        const list = Array.from(files).filter(isEpub)
        const skipped = Array.from(files).length - list.length
        if (skipped > 0) notice.value = `已忽略 ${skipped} 个非 EPUB 文件`
        if (!list.length) return

        error.value = null
        for (const file of list) {
            task.value = {name: file.name, ratio: 0}
            try {
                const result = await booksApi.upload(file, (ratio) => {
                    if (task.value) task.value.ratio = ratio
                })
                notice.value = result.duplicate
                    ? `《${result.book.title}》已经在书架上了`
                    : `已导入《${result.book.title}》`
            } catch (err) {
                error.value = `${file.name}：${err instanceof ApiError ? err.message : '导入失败'}`
            } finally {
                task.value = null
            }
        }
        await load(true)
    }

    async function remove(id: string): Promise<void> {
        const target = items.value.find((book) => book.id === id)
        try {
            await booksApi.remove(id)
            items.value = items.value.filter((book) => book.id !== id)
            notice.value = target ? `已移除《${target.title}》` : '已移除'
            error.value = null
        } catch (err) {
            error.value = err instanceof ApiError ? err.message : '移除失败'
        }
    }

    function dismiss(): void {
        error.value = null
        notice.value = null
    }

    return {
        items,
        loading,
        loaded,
        task,
        error,
        notice,
        count,
        busy,
        load,
        upload,
        remove,
        dismiss,
    }
})
