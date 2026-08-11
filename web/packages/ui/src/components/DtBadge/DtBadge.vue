<script setup lang="ts">
/**
 * @fileoverview DtBadge —— 贴在默认插槽右上角的计数或红点。
 * ⚠ 与 DtTag 的分工：Tag 是独立的一块标签，Badge 必须挂在别的元素身上。
 */
import { computed } from 'vue'
import type { DtIntent } from '@dt/contracts'

const DEFAULT_MAX = 99

const props = withDefaults(
  defineProps<{
    value?: number | string
    /** 计数上限，超了显示 `n+`。 */
    max?: number
    /** 退化成不带数字的小圆点。 */
    dot?: boolean
    intent?: DtIntent
    /** 计数为 0 时也显示。 */
    showZero?: boolean
    ariaLabel?: string
  }>(),
  { max: DEFAULT_MAX, dot: false, intent: 'danger', showZero: false },
)

/** intent → 局部强调色与其上的前景色。 */
const accentVars = computed<Record<string, string>>(() => {
  const table: Record<DtIntent, [string, string]> = {
    primary: ['--accent-primary', '--text-on-emphasis'],
    success: ['--state-success', '--text-on-emphasis'],
    warning: ['--state-warning', '--text-inverse'],
    danger: ['--state-danger', '--text-on-emphasis'],
    info: ['--state-info', '--text-on-emphasis'],
    neutral: ['--text-secondary', '--text-primary'],
  }
  const [accent, foreground] = table[props.intent]
  return { '--_a': `var(${accent})`, '--_on': `var(${foreground})` }
})

const upperBound = computed(() =>
  Number.isFinite(props.max) && props.max >= 0 ? props.max : DEFAULT_MAX,
)

const label = computed(() => {
  const value = props.value
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (value > upperBound.value) return `${upperBound.value}+`
  // ⚠ NaN 与 -Infinity 落到这里：直接 String() 会把它们原样画进徽标
  return Number.isFinite(value) ? String(value) : ''
})

/** 空标签一律不显示，所以「0 算不算空」这条只由 showZero 决定。 */
const visible = computed(() => {
  if (props.dot) return true
  if (label.value === '') return false
  return props.value !== 0 || props.showZero
})

/** 红点没有可读内容，不给名字读屏只会跳过它。 */
const accessibleName = computed(
  () => props.ariaLabel ?? (props.dot ? '有新内容' : label.value),
)
</script>

<template>
  <span class="dt-badge">
    <slot />
    <span
      v-if="visible"
      class="dt-badge__mark"
      :class="{ 'dt-badge__mark--dot': dot }"
      :style="accentVars"
      role="status"
      :aria-label="accessibleName"
    >
      <template v-if="!dot">{{ label }}</template>
    </span>
  </span>
</template>

<style scoped lang="scss">
.dt-badge {
  position: relative;
  display: inline-flex;

  &__mark {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 1;
    box-sizing: border-box;
    // ⚠ inline-block 而不是 flex：text-overflow 只对块级文本容器生效，
    // 用 flex 的话超长文本不会出省略号，会直接把徽标撑开
    display: inline-block;
    min-width: 18px;
    max-width: 120px;
    height: 18px;
    padding: 0 5px;
    overflow: hidden;
    background: var(--_a);
    color: var(--_on);
    font-family: var(--font-sans);
    font-size: var(--ctl-hint-fs-sm);
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--radius-pill);
    // 描边用底色而不是透明：徽标常压在图标上，没有这圈隔离会糊成一团
    box-shadow: 0 0 0 2px var(--surface-base);
    transform: translate(50%, -50%);

    &--dot {
      min-width: 0;
      width: 8px;
      height: 8px;
      padding: 0;
    }
  }
}
</style>
