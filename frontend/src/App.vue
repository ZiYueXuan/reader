<script setup lang="ts">
import {usePrefsStore} from '@/stores/prefs'

// 初始化偏好（会立刻把桌面主题与字体写到 DOM 上）
usePrefsStore()
</script>

<template>
    <RouterView/>
</template>
