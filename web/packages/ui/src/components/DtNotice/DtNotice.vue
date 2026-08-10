<script setup lang="ts">
/**
 * @fileoverview DtNotice —— 行内提示条（操作反馈、失败原因）。
 *
 * ⚠ role 跟着 intent 走，不给调用方选：`danger` 是 alert（读屏立刻打断），
 * 其余是 status（读屏等当前朗读结束）。让每个页面自己填 role 的结果是
 * 一半的成功提示也用 alert 去打断用户。
 */
import { computed } from 'vue'
import type { DtIntent } from '@dt/contracts'
import DtIcon from '../DtIcon/DtIcon.vue'

const props = withDefaults(
  defineProps<{ intent?: DtIntent | undefined; icon?: string | undefined }>(),
  { intent: 'info' },
)

const role = computed(() => (props.intent === 'danger' ? 'alert' : 'status'))

const accent = computed(() => {
  const table: Record<DtIntent, string> = {
    primary: '--accent-primary-rgb',
    success: '--state-success-rgb',
    warning: '--state-warning-rgb',
    danger: '--state-danger-rgb',
    info: '--state-info-rgb',
    neutral: '--neutral-fg-rgb',
  }
  return { '--_n-rgb': `var(${table[props.intent]})` }
})
</script>

<template>
  <p class="dt-notice" :style="accent" :role="role">
    <DtIcon v-if="icon" :name="icon" :size="14" />
    <span><slot /></span>
  </p>
</template>

<style scoped lang="scss">
.dt-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgb(var(--_n-rgb));
}
</style>
