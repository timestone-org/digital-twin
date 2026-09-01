<script setup lang="ts">
/**
 * @fileoverview 一次评估的结果视图：指标 + 真值/预测值散点。
 *
 * ⚠ 散点自绘不引图表库：这里只要一层点和一条对角线，为它拉一个 echarts 实例
 * 既要管销毁又要多背几十 KB（ADR-0028 同理）。
 */
import { DtNotice } from '@dt/ui'
import { computed } from 'vue'

import type { MetricsPreview } from '../scripts/preview'

const props = defineProps<{ preview: MetricsPreview }>()

/** 画布边长与四周留白，单位是 SVG 用户坐标。 */
const SIZE = 240
const PAD = 28

const METRIC_LABELS: Record<string, string> = {
  r2: 'R²',
  mae: 'MAE',
  rmse: 'RMSE',
  mape: 'MAPE',
  accuracy: '准确率',
  precision: '精确率',
  recall: '召回率',
  f1: 'F1',
}

const bounds = computed(() => {
  const values = props.preview.pairs.flat()
  if (values.length === 0) return { low: 0, high: 1 }
  const low = Math.min(...values)
  const high = Math.max(...values)
  // 全都一样时给一个人为的跨度，否则所有点会挤在一条线上、除法还会除到 0
  return high > low ? { low, high } : { low: low - 1, high: high + 1 }
})

const dots = computed(() =>
  props.preview.pairs.map(([truth, guess]) => ({
    left: project(truth),
    top: SIZE - project(guess),
  })),
)

function project(value: number): number {
  const { low, high } = bounds.value
  return PAD + ((value - low) / (high - low)) * (SIZE - PAD * 2)
}

function format(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}
</script>

<template>
  <div class="dt-ml-metrics">
    <ul class="dt-ml-metrics__list">
      <li v-for="[key, value] in props.preview.metrics" :key="key">
        <span class="dt-ml-metrics__name">
          {{ METRIC_LABELS[key] ?? key }}
        </span>
        <strong class="dt-ml-metrics__value">{{ format(value) }}</strong>
      </li>
    </ul>
    <DtNotice v-if="props.preview.metrics.length === 0" intent="warning">
      这一步没有产出任何指标
    </DtNotice>
    <figure v-if="dots.length > 0" class="dt-ml-metrics__plot">
      <figcaption>真值（横）对预测值（纵）</figcaption>
      <svg
        :viewBox="`0 0 ${SIZE} ${SIZE}`"
        role="img"
        aria-label="真值对预测值散点图"
      >
        <line
          class="dt-ml-metrics__ideal"
          :x1="PAD"
          :y1="SIZE - PAD"
          :x2="SIZE - PAD"
          :y2="PAD"
        />
        <circle
          v-for="(dot, at) in dots"
          :key="at"
          class="dt-ml-metrics__dot"
          :cx="dot.left"
          :cy="dot.top"
          r="2.5"
        />
      </svg>
      <p v-if="props.preview.isPairsTruncated" class="dt-ml-metrics__note">
        点太多，这里只画了其中一部分
      </p>
    </figure>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-metrics {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-width: 6rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      background: var(--surface-raised);
    }
  }

  &__name {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__value {
    color: var(--text-title);
    font-family: var(--font-digit);
  }

  &__plot {
    margin: 0;

    figcaption {
      margin-bottom: 0.25rem;
      color: var(--text-secondary);
      font-size: var(--ctl-hint-fs-sm);
    }

    svg {
      width: 100%;
      max-width: 18rem;
    }
  }

  &__ideal {
    stroke: var(--border-strong);
    stroke-dasharray: 4 3;
  }

  &__dot {
    fill: rgb(var(--accent-primary-rgb) / 0.7);
  }

  &__note {
    margin: 0.25rem 0 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
