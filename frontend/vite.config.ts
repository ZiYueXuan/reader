import {fileURLToPath, URL} from 'node:url'

import vue from '@vitejs/plugin-vue'
import {defineConfig} from 'vite'

// 开发时把 /api 反代到本地 FastAPI，前端代码里一律用相对路径；
// 容器里跑时用 VITE_PROXY_TARGET=http://backend:8000 覆盖。
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000'

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {target: proxyTarget, changeOrigin: true},
        },
    },
})
