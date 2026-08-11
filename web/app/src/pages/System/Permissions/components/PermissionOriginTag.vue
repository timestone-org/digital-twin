<script setup lang="ts">
/**
 * @fileoverview 权限码的来历标记：内置 / 自建，表格与卡片共用。
 * ⚠ 非内置也要渲染出来：自建码不被任何端点或路由规则消费，等于装饰品，
 * 这一页的稀有情况恰好就是那个需要被看见的情况。
 */
import { computed } from 'vue'
import { DtTag } from '@dt/ui'

/** 两种来历的文案与提示。 */
const ORIGIN = {
  builtin: {
    label: '内置',
    intent: 'primary',
    hint: '种子维护，每次同步都会覆盖回去',
  },
  custom: {
    label: '自建',
    intent: 'neutral',
    hint: '运行时新建的码不会被任何端点或路由规则消费',
  },
} as const

const props = defineProps<{ isBuiltin: boolean }>()

const meta = computed(() => (props.isBuiltin ? ORIGIN.builtin : ORIGIN.custom))
</script>

<template>
  <DtTag :intent="meta.intent" :title="meta.hint">{{ meta.label }}</DtTag>
</template>
