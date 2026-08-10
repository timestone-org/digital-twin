<script setup lang="ts">
/**
 * @fileoverview DtTag —— 行内徽标。自成一轴（20/24px 高）：撑到控件的 32/40px
 * 会把每一行表格都拉高一截。
 */
import { computed } from 'vue'
import type { DtIntent } from '@dt/contracts'

const props = withDefaults(
  defineProps<{ intent?: DtIntent; size?: 'sm' | 'md'; mono?: boolean }>(),
  { intent: 'neutral', size: 'sm', mono: false },
)

const accent = computed(() => {
  const table: Record<DtIntent, string> = {
    primary: '--accent-primary-rgb',
    success: '--state-success-rgb',
    warning: '--state-warning-rgb',
    danger: '--state-danger-rgb',
    info: '--state-info-rgb',
    neutral: '--neutral-fg-rgb',
  }
  return { '--_t-rgb': `var(${table[props.intent]})` }
})
</script>

<template>
  <span
    class="dt-tag"
    :class="[`dt-tag--${size}`, { 'dt-tag--mono': mono }]"
    :style="accent"
  >
    <slot />
  </span>
</template>

<style scoped lang="scss">
.dt-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(var(--_t-rgb), 0.35);
  background: rgba(var(--_t-rgb), 0.12);
  border-radius: var(--radius-pill);
  color: rgb(var(--_t-rgb));
  line-height: 1;
  white-space: nowrap;

  &--sm {
    height: 20px;
    padding: 0 8px;
    font-size: 10px;
  }

  &--md {
    height: 24px;
    padding: 0 10px;
    font-size: 12px;
  }

  &--mono {
    font-family: var(--font-mono);
  }
}
</style>
