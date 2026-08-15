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
    /** 撑满可用宽度，各段等分。窄侧栏当主页签用时给它，否则右侧会空掉一大片。 */
    block?: boolean | undefined
  }>(),
  { size: 'sm', block: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div
    class="dt-segmented"
    :class="[`dt-segmented--${size}`, { 'dt-segmented--block': block }]"
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
      <span v-if="!option.iconOnly" class="dt-segmented__label">
        {{ option.label }}
      </span>
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

// 轨道内边距。选中块的圆角由它算出来，两处必须同源，否则圆角套不齐、
// 看着像选中块比轨道多出一圈直角
$track-pad: 3px;

.dt-segmented {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: $track-pad;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  // 往下凹一点：轨道是槽、选中块是浮在槽里的那一块，两者不该在同一个平面上
  box-shadow: var(--fx-shadow-inset);

  &--block {
    display: flex;
    width: 100%;
  }

  &--block &__item {
    flex: 1 1 0;
    min-width: 0;
  }

  &__item {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 0;
    border-radius: calc(var(--radius-md) - #{$track-pad});
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    // ⚠ 各档一律同一个字重：选中态加粗会让文字变宽，hug 宽度下每切一次页签
    // 整条轨道都要抖一下
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.18s ease,
      color 0.18s ease,
      box-shadow 0.18s ease;

    @include ctl.focus-ring;

    &:hover:not(.is-active) {
      background: rgba(var(--accent-primary-rgb), 0.07);
      color: var(--text-primary);
    }

    // 选中块：自上而下渐隐的强调色 + 一点外扩辉光。不叠描边——
    // 有了底部那条指示条再加一圈线就成了「按钮」，而这里表达的是「当前这一页」
    &.is-active {
      color: var(--accent-on-surface);
      background: linear-gradient(
        180deg,
        rgba(var(--accent-primary-rgb), 0.22),
        rgba(var(--accent-primary-rgb), 0.07)
      );
      box-shadow: 0 0 10px -4px rgba(var(--accent-primary-rgb), 0.65);
    }

    // 指示条：与模块标题栏那根强调竖条同一套观感（同色、同 6px 辉光），
    // 页签条因此看着是这套系统里的东西，而不是随手摆的一排按钮。
    // 宽度夹在 12–28px：纯图标档只有一个方块宽，按比例算会缩成一小截
    &.is-active::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 50%;
      width: clamp(12px, 56%, 28px);
      height: 2px;
      border-radius: var(--radius-pill);
      background: var(--accent-primary);
      box-shadow: 0 0 6px var(--accent-primary);
      transform: translateX(-50%);
    }
  }

  &__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  // 轨道总高恒等于同档控件的标称高：内容高 + 上下内边距 + 上下边框
  @each $size in ctl.$sizes {
    &--#{$size} .dt-segmented__item {
      height: calc(var(--ctl-h-#{$size}) - #{$track-pad * 2} - 2px);
      padding: 0 var(--ctl-px-#{$size});
      font-size: var(--ctl-fs-#{$size});
    }
  }

  @include ctl.reduced-motion {
    &__item {
      transition: none;
    }
  }
}
</style>
