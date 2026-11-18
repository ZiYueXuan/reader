import {createRouter, createWebHistory, type RouteRecordRaw} from 'vue-router'

import ReaderView from '@/views/ReaderView.vue'
import ShelfView from '@/views/ShelfView.vue'

const routes: RouteRecordRaw[] = [
    {path: '/', name: 'shelf', component: ShelfView},
    {path: '/book/:id', name: 'reader', component: ReaderView, props: true},
]

// 解析自检页只在开发环境存在，生产构建里连代码都不会带上
if (import.meta.env.DEV) {
    routes.push({
        path: '/debug/parse',
        name: 'parse-debug',
        component: () => import('@/views/ParseDebugView.vue'),
    })
}

const router = createRouter({
    history: createWebHistory(),
    routes,
})

export default router
