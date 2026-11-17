<script setup lang="ts">
import {computed, onMounted, ref} from 'vue'

import {api} from '@/api/client'

type Status = 'pending' | 'ok' | 'error'

const status = ref<Status>('pending')
const version = ref('')

onMounted(async () => {
    try {
        const health = await api.health()
        status.value = health.ok ? 'ok' : 'error'
        version.value = health.version
    } catch {
        status.value = 'error'
    }
})

const label = computed(
    () =>
        ({
            pending: '正在连接后端…',
            ok: `后端已连接 · v${version.value}`,
            error: '后端未连接',
        })[status.value],
)
</script>

<template>
    <main class="shelf">
        <header class="head">
            <p class="eyebrow">READER</p>
            <h1>书架</h1>
            <p class="hint">所有书都放在这张书桌上。</p>
        </header>

        <div class="status" :class="status">
            <span class="dot"/>
            {{ label }}
        </div>

        <section class="placeholder">
            <p class="title">书架还是空的</p>
            <p class="body">
                Phase 1 会接入 EPUB 导入与书架列表。届时把
                <code>samples/</code> 里的《呐喊》和 <code>alice.epub</code> 拖进来即可开始。
            </p>
        </section>
    </main>
</template>

<style scoped>
.shelf {
    max-width: 960px;
    margin: 0 auto;
    padding: 12vh 32px 64px;
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

.status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 28px;
    padding: 7px 14px;
    border: 1px solid var(--hair);
    border-radius: 999px;
    font-size: 13px;
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

.placeholder {
    margin-top: 40px;
    padding: 36px 32px;
    border: 1px dashed var(--hair);
    border-radius: var(--radius-panel);
    background: rgba(0, 0, 0, 0.12);
}

.placeholder .title {
    font-family: var(--font-serif-sc);
    font-size: 18px;
    letter-spacing: 0.04em;
}

.placeholder .body {
    margin-top: 10px;
    max-width: 46em;
    font-size: 14px;
    line-height: 1.9;
    color: var(--muted);
}

code {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.92em;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
}
</style>
