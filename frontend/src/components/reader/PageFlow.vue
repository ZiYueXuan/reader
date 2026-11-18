<script setup lang="ts">
/**
 * 书籍正文：整本书一次性铺进 CSS columns 容器。
 *
 * 这里只负责「把 Block[] 变成带 data-chapter / data-offset 的块元素」，
 * 分页几何由引擎写入 `.page-flow`，排版样式在 styles/book.css。
 *
 * 两条不变量：
 *   1. 每个块元素的 textContent 必须与 Block.text 逐字相同（Phase 7 的坐标系统依赖它）；
 *   2. 首列留白元素常驻 DOM，是否生效由 `.page-flow[data-spread]` 决定。
 */

import type {Block, Chapter} from '@/lib/epub/types'
import type {LightboxImage} from './types'

defineProps<{ chapters: Chapter[] }>()

const emit = defineEmits<{ image: [LightboxImage] }>()

/** 一行渲染单元：图片与其后的图注合成一个 figure，保证断列时不拆开 */
type FlowRow =
    | { key: string; kind: 'figure'; block: Block; index: number; caption: Block | null; captionIndex: number }
    | { key: string; kind: 'block'; block: Block; index: number }

function blockClass(block: Block): string[] {
    return ['b', `b-${block.type}`]
}

function rowsOf(chapter: Chapter): FlowRow[] {
    const rows: FlowRow[] = []
    const blocks = chapter.blocks
    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index]
        if (block.type !== 'img') {
            rows.push({key: `${index}`, kind: 'block', block, index})
            continue
        }
        const next = blocks[index + 1]
        const caption = next?.type === 'figcaption' ? next : null
        rows.push({
            key: `${index}`,
            kind: 'figure',
            block,
            index,
            caption,
            captionIndex: caption ? index + 1 : -1,
        })
        if (caption) index += 1
    }
    return rows
}

function imgStyle(block: Block): Record<string, string> {
    // 先按原始像素比占位，图片加载完不会顶动后续内容
    if (!block.width || !block.height) return {}
    return {aspectRatio: `${block.width} / ${block.height}`}
}

function captionOf(chapter: Chapter, blockIndex: number): string {
    const next = chapter.blocks[blockIndex + 1]
    return next?.type === 'figcaption' ? next.text : ''
}

/**
 * 章首页要有可见的章名。
 * 不少 EPUB（包括我们的样例书）把标题只写进 nav，正文里没有 h1，
 * 这时用 `chapter.title` 补一个只用于显示的标题块。
 * 它不带 data-offset，所以不进入字符坐标系统。
 */
function needsTitle(chapter: Chapter): boolean {
    if (!chapter.title) return false
    const first = chapter.blocks[0]
    if (!first) return true
    return first.type !== 'h1' && first.type !== 'h2' && first.type !== 'h3'
}

function openImage(chapter: Chapter, blockIndex: number, block: Block): void {
    emit('image', {
        src: block.src ?? '',
        alt: block.alt ?? '',
        caption: captionOf(chapter, blockIndex),
    })
}
</script>

<template>
    <div class="page-blank-start" aria-hidden="true"/>

    <!-- 章起新列：强制断列必须挂在列容器的直接子元素上，
         挂在章内首块（section 里）Chrome 不生效（实测 14/15 章没断） -->
    <section
        v-for="chapter in chapters"
        :key="chapter.index"
        :data-chapter="chapter.index"
        :class="{'b-start': chapter.index > 0}"
    >
        <h1 v-if="needsTitle(chapter)" class="b b-h1 b-chapter">{{ chapter.title }}</h1>

        <template v-for="row in rowsOf(chapter)" :key="row.key">
            <figure v-if="row.kind === 'figure'" class="b-figure">
                <img
                    :class="blockClass(row.block)"
                    :src="row.block.src"
                    :alt="row.block.alt ?? ''"
                    :data-chapter="chapter.index"
                    :data-block="row.index"
                    :data-offset="row.block.offset"
                    :style="imgStyle(row.block)"
                    @click="openImage(chapter, row.index, row.block)"
                />
                <figcaption
                    v-if="row.caption"
                    :class="blockClass(row.caption)"
                    :data-chapter="chapter.index"
                    :data-block="row.captionIndex"
                    :data-offset="row.caption.offset"
                >
                    {{ row.caption.text }}
                </figcaption>
            </figure>
            <hr
                v-else-if="row.block.type === 'hr'"
                :class="blockClass(row.block)"
                :data-chapter="chapter.index"
                :data-block="row.index"
                :data-offset="row.block.offset"
            />
            <p
                v-else
                :class="blockClass(row.block)"
                :data-chapter="chapter.index"
                :data-block="row.index"
                :data-offset="row.block.offset"
            >
                {{ row.block.text }}
            </p>
        </template>
    </section>
</template>
