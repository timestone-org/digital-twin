<script setup lang="ts">
/**
 * @fileoverview DtButton —— 两条正交轴：variant（实心/柔和/幽灵/描边）×
 * intent（语义色），加统一 size。loading 自动禁用并内建 spinner；
 * pressed 提供开关按钮语义（外观 + aria-pressed）。
 * ⚠ icon-only 按钮必须传 aria-label（透传到根 button），否则读屏读不到名称。
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
    /**
     * `xs` 是 20px 高的微型行内动作档（塞进 20px 行高的行内动作）；不带标签时压成
     * 20×20 的正方形图标键，带标签时宽度跟着文字走。
     */
    size?: DtSize | 'xs' | undefined
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean | undefined
    loading?: boolean
    block?: boolean
    icon?: string
    iconRight?: string
    /**
     * 传了即为开关语义：true → soft/primary，false → ghost/neutral，并落
     * aria-pressed。此时外观由 pressed 决定，显式传入的 variant/intent 被忽略。
     */
    pressed?: boolean | undefined
  }>(),
  {
    variant: 'solid',
    intent: 'primary',
    size: DT_CONTROL_DEFAULT_SIZE,
    type: 'button',
    disabled: false,
    loading: false,
    block: false,
    // ⚠ 必须显式 default undefined：不写会触发 Boolean prop 缺省强转成 false，
    // 「不传 = 旧行为」分支变死代码，全仓普通按钮都会被当成未按下的开关
    pressed: undefined,
  },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const slots = useSlots()
const isDisabled = computed(() => props.disabled || props.loading)

const XS_ICON_PX = 12 // xs 档内嵌图标边长

const iconSize = computed(() =>
  props.size === 'xs' ? XS_ICON_PX : DT_CONTROL_ICON_PX[props.size],
)

/** 开关语义下外观由 pressed 决定，见 props.pressed 的注释。 */
const effectiveVariant = computed<DtButtonVariant>(() => {
  if (props.pressed === undefined) return props.variant
  return props.pressed ? 'soft' : 'ghost'
})
const effectiveIntent = computed<DtIntent>(() => {
  if (props.pressed === undefined) return props.intent
  return props.pressed ? 'primary' : 'neutral'
})
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
  const [accent, rgb, foreground] = table[effectiveIntent.value]
  // ⚠ neutral 的强调色是纯白（浅色主题里是纯墨），描边与底色不能像别的 intent 那样
  // 由它按 alpha 派生：每套主题的 --border-* 都是强调色调 alpha 调出来的，满屏面板与
  // 输入框因此全是彩色描边，白描边会成为唯一一处无彩边、且比周围任何一条都重。故这一
  // 档的染色三元组改取主题强调色，落在同一族里。
  const neutral = effectiveIntent.value === 'neutral'
  return {
    '--_a': `var(${accent})`,
    '--_a-rgb': `var(${rgb})`,
    '--_on': `var(${foreground})`,
    // 描边/底色的染色源与点亮后的文字色，只有 outline 档用，见那条规则的注释
    '--_tint-rgb': neutral ? 'var(--accent-primary-rgb)' : `var(${rgb})`,
    '--_lit': neutral ? 'var(--text-primary)' : `var(${accent})`,
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
      `dt-btn--${effectiveVariant}`,
      `dt-btn--${size}`,
      {
        'dt-btn--block': block,
        'dt-btn--icon-only': isIconOnly,
      },
    ]"
    :style="accentVars"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
    :aria-pressed="pressed"
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

// xs 不在 --ctl-* 尺寸轴上：它为「塞进 20px 行高的行内动作」而设，所以只钉高不钉宽
// ⚠ 宽度只在 icon-only 时才压成正方形，与上面那几档同一个写法：无条件钉死 20px 宽的话，
//   带标签的那些会被裁成两个字加一个省略号（`.dt-btn__label` 上有 truncate），而
//   typecheck、lint 与全部单测一律放行——只有人眼盯着那一处才看得见
.dt-btn--xs {
  height: 20px;
  // 横向内边距是 sm 档（--ctl-btn-px-sm: 12px）的一半：xs 不在 --ctl-* 尺寸轴上，
  // 与上面那 20px / 12px 一样只能就地写
  padding: 0 6px;
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.dt-btn--icon-only.dt-btn--xs {
  width: 20px;
  padding: 0;
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

// outline 是次级动作档，出现得最多的地方是工具条里跟 DtInput / DtSelect 并排，故走
// 与那些控件同一套工业底盘：下沉底色 + 上沿高光 + 主题色描边。底色不能留空——一圈裸
// 描边浮在面板上读成占位框而不是能按的控件；描边则比 --border-default 重一档，才和
// 旁边的输入框拉开「这个能按」的差别。染色一律走 --_tint-rgb，理由见 accentVars。
.dt-btn--outline {
  background: var(--surface-sunken);
  color: var(--_a);
  border-color: rgba(var(--_tint-rgb), 0.32);
  box-shadow: inset 0 1px 0 var(--fx-sheen);

  &:hover:not(:disabled) {
    background: rgba(var(--_tint-rgb), 0.12);
    color: var(--_lit);
    border-color: rgba(var(--_tint-rgb), 0.8);
    box-shadow:
      inset 0 1px 0 var(--fx-sheen),
      0 0 14px -4px rgba(var(--_tint-rgb), 0.6);
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
