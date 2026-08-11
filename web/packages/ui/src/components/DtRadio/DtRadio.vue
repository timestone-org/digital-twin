<script setup lang="ts">
/**
 * @fileoverview DtRadio —— 单个单选圆点。选中态由父组件下发，自己不持状态。
 * ⚠ 单独用它不构成一组：方向键导航与 roving tabindex 都在 DtRadioGroup 里。
 */
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSize } from '@dt/contracts'

const props = withDefaults(
  defineProps<{
    value: string
    checked: boolean
    label?: string | undefined
    size?: DtSize | undefined
    disabled?: boolean | undefined
    /** roving tabindex：组内只有一项是 0，其余 -1。 */
    tabindex?: number | undefined
  }>(),
  { size: DT_CONTROL_DEFAULT_SIZE, disabled: false, tabindex: 0 },
)

const emit = defineEmits<{ select: [value: string] }>()

function pick(): void {
  if (props.disabled) return
  emit('select', props.value)
}
</script>

<template>
  <div
    class="dt-radio"
    :class="[
      `dt-radio--${size}`,
      { 'dt-radio--checked': checked, 'dt-radio--disabled': disabled },
    ]"
    role="radio"
    :aria-checked="checked"
    :aria-disabled="disabled || undefined"
    :tabindex="disabled ? -1 : tabindex"
    @click="pick"
    @keydown.space.prevent="pick"
    @keydown.enter.prevent="pick"
  >
    <span class="dt-radio__dot" aria-hidden="true" />
    <span v-if="label" class="dt-radio__label">{{ label }}</span>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-radio {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  line-height: 1;
  cursor: pointer;
  user-select: none;
  outline: none;

  &--disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &__dot {
    position: relative;
    flex-shrink: 0;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: var(--surface-sunken);
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease;

    // 内点用伪元素撑开而不是切换 display：后者没有过渡，选中是硬跳
    &::after {
      content: '';
      position: absolute;
      inset: 0;
      margin: auto;
      width: 0;
      height: 0;
      border-radius: 50%;
      background: var(--accent-primary);
      transition:
        width 0.18s ease,
        height 0.18s ease;
    }
  }

  &:hover:not(&--disabled) &__dot {
    border-color: var(--border-hover);
  }

  &--checked &__dot {
    border-color: var(--accent-primary);
    box-shadow: 0 0 8px -2px rgba(var(--accent-primary-rgb), 0.7);

    &::after {
      width: 50%;
      height: 50%;
    }
  }

  &:focus-visible &__dot {
    outline: 2px solid rgba(var(--accent-primary-rgb), 0.6);
    outline-offset: 2px;
  }

  &__label {
    line-height: 1.2;
  }
}

@each $size in ctl.$sizes {
  .dt-radio--#{$size} {
    @include ctl.control-font($size);

    // 圆点与勾选框同轴，否则单选、多选并排时圆点小一圈
    .dt-radio__dot {
      width: var(--ctl-box-#{$size});
      height: var(--ctl-box-#{$size});
    }
  }
}

@include ctl.reduced-motion {
  .dt-radio__dot,
  .dt-radio__dot::after {
    transition: none;
  }
}
</style>
