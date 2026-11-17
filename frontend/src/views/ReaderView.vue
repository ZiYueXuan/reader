<script setup lang="ts">
defineProps<{ id: string }>()
</script>

<template>
    <main class="reader">
        <RouterLink class="back" to="/" aria-label="返回书架">←</RouterLink>

        <div class="book">
            <div class="page">
                <p class="eyebrow">阅读器 · Phase 3</p>
                <h1>这里将摊开一本书</h1>
                <p class="body">
                    双页跨页、CSS columns 分页、页眉页脚、翻页手势都在 Phase 3–4 落地。
                    当前只是占位，用来确认路由与骨架通畅。
                </p>
                <p class="id">book id: {{ id }}</p>
            </div>
        </div>
    </main>
</template>

<style scoped>
.reader {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 100%;
    padding: 48px;
}

.back {
    position: absolute;
    top: 20px;
    left: 20px;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--hair);
    background: rgba(0, 0, 0, 0.22);
    font-size: 16px;
    transition: border-color 200ms var(--ease);
}

.back:hover {
    border-color: var(--accent);
    color: var(--accent);
}

.book {
    width: min(720px, 100%);
    border-radius: 4px;
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow);
    padding: 72px 76px;
}

.eyebrow {
    font-family: var(--font-classic);
    font-size: 11px;
    letter-spacing: 0.28em;
    color: var(--ink-soft);
}

h1 {
    margin-top: 22px;
    font-family: var(--font-serif-sc);
    font-size: 30px;
    font-weight: 400;
    letter-spacing: 0.05em;
}

.body {
    margin-top: 18px;
    font-family: var(--font-reader);
    font-size: 16px;
    line-height: 2;
    text-indent: 2em;
    text-align: justify;
}

.id {
    margin-top: 28px;
    font-size: 12px;
    color: var(--ink-soft);
    letter-spacing: 0.04em;
}
</style>
