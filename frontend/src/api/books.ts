/** 书籍相关接口。字段名与后端 schemas.py 一一对应。 */

import {ApiError, apiUrl, request} from './client'

export interface TocNode {
    title: string
    chapter: number
    offset: number
    children: TocNode[]
}

export interface BookSummary {
    id: string
    title: string
    author: string | null
    language: string | null
    chapterCount: number | null
    fileSize: number | null
    /** 0–1 */
    percent: number
    coverUrl: string | null
    createdAt: string
    updatedAt: string
}

export interface BookDetail extends BookSummary {
    publisher: string | null
    identifier: string | null
    toc: TocNode[]
}

export interface BookPatch {
    title?: string
    chapterCount?: number
    toc?: TocNode[]
}

export interface UploadResult {
    book: BookDetail
    /** true 表示后端按 sha256 判定为重复文件，返回的是已有条目 */
    duplicate: boolean
}

function safeJson(text: string): { error?: { message?: string } } & Record<string, unknown> {
    try {
        return JSON.parse(text) as { error?: { message?: string } }
    } catch {
        return {}
    }
}

/**
 * 用 XHR 上传，只为拿到 `upload.onprogress`；fetch 无法报告上传进度。
 */
export function uploadBook(
    file: File,
    onProgress?: (ratio: number) => void,
): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
        const form = new FormData()
        form.append('file', file, file.name)

        const xhr = new XMLHttpRequest()
        xhr.open('POST', apiUrl('/api/books'))
        xhr.responseType = 'text'

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) onProgress?.(event.loaded / event.total)
        }
        xhr.onload = () => {
            const body = safeJson(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve({book: body as unknown as BookDetail, duplicate: xhr.status === 200})
                return
            }
            const message = body.error?.message ?? (xhr.statusText || '上传失败')
            reject(new ApiError(xhr.status, message))
        }
        xhr.onerror = () => reject(new ApiError(0, '网络中断，上传失败'))
        xhr.onabort = () => reject(new ApiError(0, '上传已取消'))

        xhr.send(form)
    })
}

export const booksApi = {
    list: () => request<BookSummary[]>('/api/books'),
    detail: (id: string) => request<BookDetail>(`/api/books/${id}`),
    update: (id: string, patch: BookPatch) =>
        request<BookDetail>(`/api/books/${id}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(patch),
        }),
    remove: (id: string) => request<void>(`/api/books/${id}`, {method: 'DELETE'}),
    upload: uploadBook,
    coverUrl: (id: string) => apiUrl(`/api/books/${id}/cover`),
    fileUrl: (id: string) => apiUrl(`/api/books/${id}/file`),
}
