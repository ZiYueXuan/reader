import {createRouter, createWebHistory} from 'vue-router'

import ReaderView from '@/views/ReaderView.vue'
import ShelfView from '@/views/ShelfView.vue'

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: '/', name: 'shelf', component: ShelfView},
        {path: '/book/:id', name: 'reader', component: ReaderView, props: true},
    ],
})

export default router
