<script setup lang="ts">
/**
 * @fileoverview DtButton —— 两条正交轴：variant（实心/柔和/幽灵/描边）×
 * intent（语义色），加统一 size。loading 自动禁用并内建 spinner。
 */
import { computed, useSlots } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE, DT_CONTROL_ICON_PX } from '@dt/contracts'
import type { DtButtonVariant, DtIntent, DtSize } from '@dt/contracts'
import DtIcon from '../DtIcon/DtIcon.vue'

const props = withDefaults(
  // ⚠ 转发进来的档位与禁用态显式写出 `| undefined`：开着 exactOptionalPropertyTypes
  // 时 withDefaults 不收窄读取端的类型，上游组件把自己的 `size` 原样传进来必然带上
  // undefined，不接就整条 typecheck 红（同 DtField）。
  defineProps<{
    variant?: DtButtonVariant
    intent?: DtIntent
    size?: DtSize | undefined
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean | undefined
    loading?: boolean
    block?: boolean
    icon?: string
    iconRight?: string
    /** icon-only 按钮必须给，否则屏幕阅读器读不到名称。 */
    ariaLabel?: string
  }>(),
  {
    variant: 'solid',
    intent: 'primary',
    size: DT_CONTROL_DEFAULT_SIZE,
    type: 'button',
    disabled: false,
    loading: false,
    block: false,
  },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const slots = useSlots()
const isDisabled = computed(() => props.disabled || props.loading)
const iconSize = computed(() => DT_CONTROL_ICON_PX[props.size])
/** 无文字内容时压成正方形，否则图标键会被文字档的横向内边距撑成扁矩形。 */
const isIconOnly = computed(
  () => !slots.default && Boolean(props.icon || slots.leading),
)

/** intent → 局部强调色变量，供各 variant 组合。 */
const accentVars = computed<Record<string, string>>(() => {
  const table: Record<DtIntent, [string, string, string]> = {
    primary: ['--accent-primary', '--accent-primary-rgb', '--text-on-emphasis'],
    success: ['--state-success', '--state-success-rgb', '--text-on-emphasis'],
    warning: ['--state-warning', '--state-warning-rgb', '--text-inverse'],
    danger: ['--state-danger', '--state-danger-rgb', '--text-on-emphasis'],
    info: ['--state-info', '--state-info-rgb', '--text-on-emphasis'],
    neutral: ['--text-secondary', '--neutral-fg-rgb', '--text-primary'],
  }
  const [accent, rgb, foreground] = table[props.intent]
  return {
    '--_a': `var(${accent})`,
    '--_a-rgb': `var(${rgb})`,
    '--_on': `var(${foreground})`,
  }
})

function onClick(event: MouseEvent): void {
  if (isDisabled.value) return
  emit('click', event)
}
</script>

<template>
  <button
    :type="type"
    class="dt-btn"
    :class="[
      `dt-btn--${variant}`,
      `dt-btn--${size}`,
      {
        'dt-btn--block': block,
        'dt-btn--icon-only': isIconOnly,
      },
    ]"
    :style="accentVars"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
    :aria-label="ariaLabel"
    @click="onClick"
  >
    <span v-if="loading" class="dt-btn__spinner" aria-hidden="true" />
    <!-- icon 与 leading 槽同时给时槽优先，避免出现两个前置元素 -->
    <DtIcon
      v-else-if="icon && !$slots.leading"
      :name="icon"
      :size="iconSize"
      class="dt-btn__affix"
    />
    <span v-if="$slots.leading && !loading" class="dt-btn__affix">
      <slot name="leading" />
    </span>
    <span v-if="$slots.default" class="dt-btn__label"><slot /></span>
    <span v-if="$slots.trailing && !loading" class="dt-btn__affix">
      <slot name="trailing" />
    </span>
    <DtIcon
      v-if="iconRight && !loading"
      :name="iconRight"
      :size="iconSize"
      class="dt-btn__affix"
    />
  </button>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: inherit;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  user-select: none;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    filter 0.18s ease,
    transform 0.12s ease;

  @include ctl.focus-ring(var(--_a-rgb));

  &:active:not(:disabled) {
    transform: translateY(1px) scale(0.99);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &--block {
    width: 100%;
  }
}

@each $size in ctl.$sizes {
  .dt-btn--#{$size} {
    @include ctl.control-box($size, 'btn-px');
    @include ctl.control-font($size);
  }

  // 内边距必须写在复合选择器上：与 .dt-btn--{size} 同特异度时靠后者胜出，
  // 单类选择器压不掉档位的横向内边距。
  .dt-btn--icon-only.dt-btn--#{$size} {
    width: var(--ctl-h-#{$size});
    padding: 0;
  }
}

.dt-btn--solid {
  background: var(--_a);
  color: var(--_on);
  box-shadow: 0 0 12px -4px rgba(var(--_a-rgb), 0.7);

  &:hover:not(:disabled) {
    filter: brightness(1.06);
    box-shadow: 0 0 16px -2px rgba(var(--_a-rgb), 0.9);
  }
}

.dt-btn--soft {
  background: rgba(var(--_a-rgb), 0.15);
  color: var(--_a);
  border-color: rgba(var(--_a-rgb), 0.25);

  &:hover:not(:disabled) {
    background: rgba(var(--_a-rgb), 0.24);
  }
}

.dt-btn--ghost {
  background: transparent;
  color: var(--_a);

  &:hover:not(:disabled) {
    background: rgba(var(--_a-rgb), 0.12);
  }
}

.dt-btn--outline {
  background: transparent;
  color: var(--_a);
  border-color: rgba(var(--_a-rgb), 0.5);

  &:hover:not(:disabled) {
    border-color: var(--_a);
    box-shadow: 0 0 12px -4px rgba(var(--_a-rgb), 0.6);
  }
}

.dt-btn__spinner {
  width: 1em;
  height: 1em;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: dt-btn-spin 0.6s linear infinite;
}

.dt-btn__affix {
  display: inline-flex;
  align-items: center;
}

// flex 子项需 min-width:0 才允许收缩，否则超长文本会撑破父容器
.dt-btn__label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes dt-btn-spin {
  to {
    transform: rotate(360deg);
  }
}

@include ctl.reduced-motion {
  .dt-btn {
    transition: none;
  }

  .dt-btn__spinner {
    animation-duration: 1.4s;
  }
}
</style>
