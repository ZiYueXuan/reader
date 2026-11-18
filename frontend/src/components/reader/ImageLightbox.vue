<script setup lang="ts">
/**
 * 全屏图片预览：点击正文图片弹出，含图注。
 *
 * 事件用捕获阶段注册，先于阅读器的翻页键盘处理拿到 Esc；
 * 关闭点：Esc / 右上角 / 遮罩空白处。
 */

import {onBeforeUnmount, onMounted} from 'vue'

import type {LightboxImage} from './types'

defineProps<LightboxImage>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
    <Teleport to="body">
        <div class="lightbox" role="dialog" aria-modal="true" @click.self="emit('close')">
            <figure class="frame">
                <img :src="src" :alt="alt" draggable="false"/>
                <figcaption v-if="caption">{{ caption }}</figcaption>
            </figure>
            <button type="button" class="close" aria-label="关闭" @click="emit('close')">×</button>
        </div>
    </Teleport>
</template>

<style scoped>
.lightbox {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px;
    background: rgba(10, 8, 6, 0.82);
    backdrop-filter: blur(6px);
    animation: fade-in 200ms var(--ease);
}

.frame {
    margin: 0;
    max-width: min(1100px, 88vw);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
}

.frame img {
    max-width: 100%;
    max-height: 78vh;
    object-fit: contain;
    border-radius: 3px;
    background: var(--paper);
    box-shadow: var(--shadow);
    cursor: zoom-out;
}

.frame figcaption {
    font-size: 12.5px;
    letter-spacing: 0.04em;
    color: var(--muted);
    text-align: center;
    max-width: 72ch;
}

.close {
    position: absolute;
    top: 18px;
    right: 20px;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--hair);
    background: rgba(0, 0, 0, 0.3);
    font-size: 20px;
    line-height: 1;
    color: #f4ead6;
    transition: border-color 200ms var(--ease);
}

.close:hover {
    border-color: var(--accent);
    color: var(--accent);
}

@keyframes fade-in {
    from {
        opacity: 0;
    }
}
</style>
