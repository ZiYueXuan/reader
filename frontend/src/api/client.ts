/** 极薄的 fetch 封装。开发环境由 Vite 反代，生产环境走同源或 VITE_API_BASE。 */

const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {Accept: 'application/json', ...(init.headers ?? {})},
    })

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
    health: () => request<Health>('/api/health'),
}
