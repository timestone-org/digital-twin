<script setup lang="ts">
/**
 * @fileoverview DtProgress —— 进度指示，条形轨道或环形描边两种呈现。
 * 取值归一与环形几何在 ./progress.ts。
 */
import { computed } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtIntent, DtSize } from '@dt/contracts'
import {
  clampProgress,
  progressFraction,
  ringGeometry,
  safeMax,
} from './progress'

// 未知进度时环上留出的缺口比例，转起来才看得出是在转
const SPINNER_GAP = 0.75

const props = withDefaults(
  defineProps<{
    value?: number
    max?: number
    intent?: DtIntent
    size?: DtSize
    /** 显示百分比。 */
    showLabel?: boolean
    /** 未知进度：忽略 value，走循环动画。 */
    indeterminate?: boolean
    variant?: 'linear' | 'circular'
  }>(),
  {
    value: 0,
    max: 100,
    intent: 'primary',
    size: DT_CONTROL_DEFAULT_SIZE,
    showLabel: false,
    indeterminate: false,
    variant: 'linear',
  },
)

/** intent → 局部强调色变量，供轨道与描边共用。 */
const accentVars = computed<Record<string, string>>(() => {
  const table: Record<DtIntent, [string, string]> = {
    primary: ['--accent-primary', '--accent-primary-rgb'],
    success: ['--state-success', '--state-success-rgb'],
    warning: ['--state-warning', '--state-warning-rgb'],
    danger: ['--state-danger', '--state-danger-rgb'],
    info: ['--state-info', '--state-info-rgb'],
    neutral: ['--text-secondary', '--neutral-fg-rgb'],
  }
  const [accent, rgb] = table[props.intent]
  return { '--_a': `var(${accent})`, '--_a-rgb': `var(${rgb})` }
})

const upperBound = computed(() => safeMax(props.max))
const current = computed(() => clampProgress(props.value, upperBound.value))
const fraction = computed(() =>
  props.indeterminate ? 0 : progressFraction(props.value, props.max),
)
const percent = computed(() => Math.round(fraction.value * 100))
const label = computed(() => (props.indeterminate ? '…' : `${percent.value}%`))

const ring = computed(() => ringGeometry(props.size))
const dashOffset = computed(() =>
  props.indeterminate
    ? ring.value.circumference * SPINNER_GAP
    : ring.value.circumference * (1 - fraction.value),
)

/** 未知进度不报当前值：报一个假的比不报更糟。 */
const ariaNow = computed(() =>
  props.indeterminate ? undefined : current.value,
)
</script>

<template>
  <div
    class="dt-progress"
    :class="[
      `dt-progress--${variant}`,
      `dt-progress--${size}`,
      { 'dt-progress--indeterminate': indeterminate },
    ]"
    :style="accentVars"
    role="progressbar"
    :aria-valuenow="ariaNow"
    aria-valuemin="0"
    :aria-valuemax="upperBound"
    :aria-busy="indeterminate || undefined"
  >
    <template v-if="variant === 'linear'">
      <div class="dt-progress__track">
        <div
          class="dt-progress__fill"
          :style="indeterminate ? undefined : { width: `${percent}%` }"
        />
      </div>
      <span v-if="showLabel" class="dt-progress__label">{{ label }}</span>
    </template>

    <template v-else>
      <svg
        class="dt-progress__svg"
        :width="ring.diameter"
        :height="ring.diameter"
        :viewBox="`0 0 ${ring.diameter} ${ring.diameter}`"
        aria-hidden="true"
      >
        <circle
          class="dt-progress__ring-track"
          :cx="ring.diameter / 2"
          :cy="ring.diameter / 2"
          :r="ring.radius"
          fill="none"
          :stroke-width="ring.stroke"
        />
        <circle
          class="dt-progress__ring-fill"
          :cx="ring.diameter / 2"
          :cy="ring.diameter / 2"
          :r="ring.radius"
          fill="none"
          :stroke-width="ring.stroke"
          stroke-linecap="round"
          :stroke-dasharray="ring.circumference"
          :stroke-dashoffset="dashOffset"
        />
      </svg>
      <span
        v-if="showLabel"
        class="dt-progress__label dt-progress__label--center"
      >
        {{ label }}
      </span>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

$rails: (
  sm: 6px,
  md: 10px,
  lg: 14px,
);

.dt-progress {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: inherit;
  color: var(--text-secondary);

  &--linear {
    display: flex;
    width: 100%;
  }

  &--circular {
    position: relative;
    justify-content: center;
  }

  &__track {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
  }

  &__fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, rgba(var(--_a-rgb), 0.55), var(--_a));
    box-shadow: 0 0 10px -2px rgba(var(--_a-rgb), 0.8);
    transition: width 0.3s ease;
  }

  &--indeterminate &__fill {
    width: 40%;
    animation: dt-progress-slide 1.2s ease-in-out infinite;
  }

  // 描边从 12 点方向起画，SVG 的 0° 在 3 点
  &__svg {
    transform: rotate(-90deg);
  }

  &__ring-track {
    stroke: var(--surface-sunken);
  }

  &__ring-fill {
    stroke: var(--_a);
    filter: drop-shadow(0 0 4px rgba(var(--_a-rgb), 0.6));
    transition: stroke-dashoffset 0.3s ease;
  }

  &--indeterminate &__svg {
    animation: dt-progress-spin 1s linear infinite;
  }

  &__label {
    font-size: var(--ctl-hint-fs-md);
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);

    &--center {
      position: absolute;
      inset: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-primary);
    }
  }
}

@each $size, $rail in $rails {
  .dt-progress--#{$size} .dt-progress__track {
    height: $rail;
  }
}

@keyframes dt-progress-slide {
  from {
    transform: translateX(-120%);
  }
  to {
    transform: translateX(320%);
  }
}

@keyframes dt-progress-spin {
  to {
    transform: rotate(270deg);
  }
}

@include ctl.reduced-motion {
  .dt-progress__fill,
  .dt-progress__ring-fill {
    transition: none;
  }

  .dt-progress--indeterminate .dt-progress__fill,
  .dt-progress--indeterminate .dt-progress__svg {
    animation-duration: 2.4s;
  }
}
</style>
