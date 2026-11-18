/** 极薄的 fetch 封装。开发环境由 Vite 反代，生产环境走同源或 VITE_API_BASE。 */

const BASE = import.meta.env.VITE_API_BASE ?? ''
const DEFAULT_TIMEOUT = 20_000

/** 把 API 路径拼成可直接放进 `img.src` 的地址。 */
export function apiUrl(path: string): string {
    return `${BASE}${path}`
}

export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

export interface RequestOptions extends RequestInit {
    /** 毫秒；传 0 关闭超时（大文件上传走 XHR，不经过这里）。 */
    timeout?: number
}

export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const {timeout = DEFAULT_TIMEOUT, ...rest} = init
    const signal = rest.signal ?? (timeout > 0 ? AbortSignal.timeout(timeout) : undefined)

    let res: Response
    try {
        res = await fetch(apiUrl(path), {
            ...rest,
            signal,
            headers: {Accept: 'application/json', ...(rest.headers ?? {})},
        })
    } catch (err) {
        if (err instanceof DOMException && err.name === 'TimeoutError') {
            throw new ApiError(0, '请求超时，请检查后端是否在运行')
        }
        throw new ApiError(0, '无法连接到后端')
    }

    if (!res.ok) {
        let detail = res.statusText
        try {
            const body = (await res.json()) as { error?: { message?: string } }
            detail = body.error?.message ?? detail
        } catch {
            /* 非 JSON 错误体，保持原样 */
        }
        throw new ApiError(res.status, detail)
    }

    if (res.status === 204) return undefined as T
    return (await res.json()) as T
}

export interface Health {
    ok: boolean
    version: string
    time: string
}

export const api = {
    health: () => request<Health>('/api/health', {timeout: 3000}),
}
