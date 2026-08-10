<script setup lang="ts">
/**
 * @fileoverview DtSegmented —— 分段切换器（页签条、视图切换）。
 *
 * ⚠ 用 `<button>` 而不是 `<a>`：它切换的是同一块内容的呈现，不是导航。
 * 需要导航语义的地方（地址会变、要能新标签打开）请用链接，别拿它凑合。
 * 选中态同时给 `aria-pressed`，只靠颜色区分对读屏与色觉障碍都不成立。
 */
import type { DtSegmentedOption, DtSize } from '@dt/contracts'
import DtIcon from '../DtIcon/DtIcon.vue'

withDefaults(
  defineProps<{
    modelValue: string
    options: readonly DtSegmentedOption[]
    size?: DtSize | undefined
    ariaLabel?: string | undefined
  }>(),
  { size: 'sm' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div
    class="dt-segmented"
    :class="`dt-segmented--${size}`"
    role="group"
    :aria-label="ariaLabel"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="dt-segmented__item"
      :class="{ 'is-active': option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      :aria-label="option.iconOnly ? option.label : undefined"
      :title="option.iconOnly ? option.label : undefined"
      @click="emit('update:modelValue', option.value)"
    >
      <DtIcon v-if="option.icon" :name="option.icon" :size="14" />
      <span v-if="!option.iconOnly">{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-segmented {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);

  &__item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;

    @include ctl.focus-ring;

    &:hover {
      background: rgba(var(--accent-primary-rgb), 0.1);
      color: var(--text-primary);
    }

    &.is-active {
      background: rgba(var(--accent-primary-rgb), 0.16);
      color: var(--accent-primary);
    }
  }

  @each $size in ctl.$sizes {
    &--#{$size} .dt-segmented__item {
      height: calc(var(--ctl-h-#{$size}) - 8px);
      padding: 0 var(--ctl-px-#{$size});
      font-size: var(--ctl-fs-#{$size});
    }
  }
}
</style>
