<script setup lang="ts">
/**
 * @fileoverview DtSwitch —— 开关（v-model:boolean）。
 * ⚠ 它表示的是「立刻生效的开/关」，不是待提交的选项——后者用 DtCheckbox。
 */
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSize } from '@dt/contracts'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    label?: string | undefined
    size?: DtSize | undefined
    disabled?: boolean | undefined
    /** 无可见 label 时的可访问名称；两者都不给，读屏只会读出「switch」。 */
    ariaLabel?: string | undefined
  }>(),
  { size: DT_CONTROL_DEFAULT_SIZE, disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

// ⚠ 原生 disabled 只挡用户点击，程序派发的 click 照样会走到这里
function toggle(): void {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    class="dt-switch"
    :class="[`dt-switch--${size}`, { 'dt-switch--on': modelValue }]"
    :aria-checked="modelValue"
    :aria-label="ariaLabel"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="dt-switch__track" aria-hidden="true">
      <span class="dt-switch__thumb" />
    </span>
    <span v-if="label" class="dt-switch__label">{{ label }}</span>
  </button>
</template>

<style scoped lang="scss">
@use 'sass:map';
@use '../../styles/control' as ctl;

// 轨道几何是开关自己的一套，不套控件主轴高度：开关是贴在标签旁的小挂件，
// 撑到 32/40/48 会把每一行表单都拉高一截。字号仍取控件轴，免得差半档。
$tracks: (
  sm: (
    width: 28px,
    height: 16px,
    thumb: 12px,
  ),
  md: (
    width: 36px,
    height: 20px,
    thumb: 16px,
  ),
  lg: (
    width: 44px,
    height: 24px,
    thumb: 20px,
  ),
);
// 滑块与轨道内壁的留白
$inset: 2px;

.dt-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  // 焦点环画在轨道上而不是根节点：根还包着文字，环会框住一整行
  &:focus-visible {
    outline: none;
  }

  &:focus-visible &__track {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.35);
  }

  &__track {
    position: relative;
    flex-shrink: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-pill);
    background: var(--surface-sunken);
    transition:
      background-color 0.3s ease,
      border-color 0.3s ease,
      box-shadow 0.3s ease;
  }

  &__thumb {
    position: absolute;
    top: 50%;
    left: $inset;
    border-radius: 50%;
    background: var(--text-secondary);
    transform: translateY(-50%);
    transition:
      left 0.3s ease,
      background-color 0.3s ease,
      box-shadow 0.3s ease;
  }

  &--on &__track {
    border-color: rgba(var(--accent-primary-rgb), 0.6);
    background: rgba(var(--accent-primary-rgb), 0.25);
    box-shadow: 0 0 10px -3px var(--accent-primary);
  }

  &--on &__thumb {
    background: var(--accent-primary);
    box-shadow: 0 0 6px var(--accent-primary);
  }

  &__label {
    color: var(--text-secondary);
  }
}

@each $size, $track in $tracks {
  $width: map.get($track, width);
  $height: map.get($track, height);
  $thumb: map.get($track, thumb);

  .dt-switch--#{$size} {
    @include ctl.control-font($size);

    .dt-switch__track {
      width: $width;
      height: $height;
    }

    .dt-switch__thumb {
      width: $thumb;
      height: $thumb;
    }
  }

  // 打开位：贴右内壁。左右留白要减掉两侧 1px 描边，否则滑块会压在描边上
  .dt-switch--#{$size}.dt-switch--on .dt-switch__thumb {
    left: $width - $thumb - $inset - 2px;
  }
}

@include ctl.reduced-motion {
  .dt-switch__track,
  .dt-switch__thumb {
    transition: none;
  }
}
</style>
