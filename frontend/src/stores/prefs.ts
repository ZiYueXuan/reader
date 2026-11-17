import {defineStore} from 'pinia'
import {reactive, watch} from 'vue'

export type DeskId = 'walnut' | 'ash' | 'ink' | 'baize' | 'stone'
export type ReaderFontId = 'classic' | 'serif-sc' | 'sans-sc' | 'wenkai' | 'xiaowei'
export type PageMargin = 'narrow' | 'normal' | 'wide'

export interface Prefs {
    desk: DeskId
    font: ReaderFontId
    /** 'follow' 表示引用字体跟随正文 */
    quoteFont: ReaderFontId | 'follow'
    /** 正文磅值（px）—— 目标站点没有这个设置，我们补上 */
    fontSize: number
    /** 行高倍数 */
    lineHeight: number
    pageMargin: PageMargin
    /** 环衬色：ivory / sand / slate / sage / burgundy */
    endpaper: string
    /** 桌面是否并排双页，窄屏时为 false */
    spread: boolean
    turnHintSeen: boolean
    tiltHintSeen: boolean
}

const STORAGE_KEY = 'reader:prefs:v1'

const DEFAULTS: Prefs = {
    desk: 'walnut',
    font: 'wenkai',
    quoteFont: 'follow',
    fontSize: 17,
    lineHeight: 1.9,
    pageMargin: 'normal',
    endpaper: 'ivory',
    spread: true,
    turnHintSeen: false,
    tiltHintSeen: false,
}

function load(): Prefs {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return {...DEFAULTS}
        return {...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>)}
    } catch {
        return {...DEFAULTS}
    }
}

const FONT_VARS: Record<ReaderFontId, string> = {
    classic: 'var(--font-classic)',
    'serif-sc': 'var(--font-serif-sc)',
    'sans-sc': 'var(--font-sans-sc)',
    wenkai: 'var(--font-wenkai)',
    xiaowei: 'var(--font-xiaowei)',
}

export const fontVar = (id: ReaderFontId): string => FONT_VARS[id]

export const usePrefsStore = defineStore('prefs', () => {
    const prefs = reactive<Prefs>(load())

    // 主题与字体落到 <body>，阅读器排版直接读 CSS 变量
    watch(
        () => prefs.desk,
        (desk) => {
            document.body.dataset.desk = desk
        },
        {immediate: true},
    )

    watch(
        () => [prefs.font, prefs.quoteFont] as const,
        ([font, quote]) => {
            const root = document.documentElement.style
            root.setProperty('--font-reader', fontVar(font))
            root.setProperty('--font-quote', fontVar(quote === 'follow' ? font : quote))
        },
        {immediate: true},
    )

    watch(
        prefs,
        () => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
            } catch {
                /* 隐私模式下写不进去，忽略 */
            }
        },
        {deep: true},
    )

    function reset(): void {
        Object.assign(prefs, DEFAULTS)
    }

    return {prefs, reset}
})
