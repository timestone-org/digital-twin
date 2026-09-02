<script setup lang="ts">
/**
 * @fileoverview 热行**有符号**误差（p50 − 实际）的分布。
 *
 * ⚠ 有符号而不是绝对值：偏差方向是行动信息。系统性低估（预测比实际短）会让人
 * 按不足的提前量开机，比「误差大」更要命；绝对值直方图把这件事抹平了。
 */
import { computed } from 'vue'
import type { ModelPrediction } from '@dt/contracts'

import { signedError } from '@/features/hvac/modelView'

// 画布逻辑尺寸；箱号范围 [-EDGE, EDGE]，两端各自吸收尾巴
const WIDTH = 320
const HEIGHT = 176
const PAD_X = 8
const PAD_BOTTOM = 18
const EDGE = 5
// 中位偏差小于它就当没有系统偏差
const NEUTRAL_BIAS = 0.1

const props = defineProps<{
  /** 热行（实际 > 0）的折外预测。 */
  rows: readonly ModelPrediction[]
  /** 热行 MAE，决定箱宽；为 null 时这块整个不画。 */
  hotMae: number | null
}>()

/** 箱宽：半个 MAE，最少 1 分钟。 */
const binWidth = computed(() => Math.max(1, Math.ceil((props.hotMae ?? 1) / 2)))

const bins = computed(() => {
  const width = binWidth.value
  const counts = new Map<number, number>()
  for (const row of props.rows) {
    const raw = Math.round(signedError(row) / width)
    const index = Math.max(-EDGE, Math.min(EDGE, raw))
    counts.set(index, (counts.get(index) ?? 0) + 1)
  }
  const top = Math.max(1, ...counts.values())
  const slot = (WIDTH - PAD_X * 2) / (EDGE * 2 + 1)
  return range().map((index) => {
    const count = counts.get(index) ?? 0
    const height = (count / top) * (HEIGHT - PAD_BOTTOM - 4)
    return {
      index,
      count,
      x: PAD_X + (index + EDGE) * slot + slot * 0.15,
      y: HEIGHT - PAD_BOTTOM - height,
      width: slot * 0.7,
      height,
      paint: paintOf(index),
      title: `${labelOf(index, width)}：${count} 条`,
    }
  })
})

const medianBias = computed(() => {
  if (props.rows.length === 0) return 0
  const sorted = props.rows.map(signedError).sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
})

const biasText = computed(() => {
  const bias = medianBias.value
  if (Math.abs(bias) < NEUTRAL_BIAS) return '基本无系统偏差'
  const value = `${bias > 0 ? '+' : '−'}${Math.abs(bias).toFixed(1)}`
  return bias < 0
    ? `中位偏差 ${value} 分钟（预测偏短，提前量会不够）`
    : `中位偏差 ${value} 分钟（预测偏长）`
})

const edgeLabel = computed(() => (EDGE - 0.5) * binWidth.value)

function range(): number[] {
  return Array.from({ length: EDGE * 2 + 1 }, (_, at) => at - EDGE)
}

/** 低估（预测比实际短）标警示色，高估淡一档。 */
function paintOf(index: number): string {
  if (index < 0) return 'fill-state-warning'
  return index === 0 ? 'fill-accent-primary' : 'fill-accent-primary/50'
}

function labelOf(index: number, width: number): string {
  if (index === -EDGE) return `误差 ≤ −${(EDGE - 0.5) * width} 分钟`
  if (index === EDGE) return `误差 ≥ +${(EDGE - 0.5) * width} 分钟`
  const low = (index - 0.5) * width
  const high = (index + 0.5) * width
  return `误差 ${low > 0 ? '+' : ''}${low} ~ ${high > 0 ? '+' : ''}${high} 分钟`
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <p class="text-xs font-medium text-text-primary">
      误差分布（热行，p50 − 实际）
    </p>
    <p v-if="props.rows.length === 0" class="text-xs text-text-secondary">
      这个组合没有热行（全部开机都是一开机就已达标），画不出误差分布。
    </p>
    <template v-else>
      <!-- preserveAspectRatio 取 meet 不取 none：none 会把条压变形；xMin 让图贴着标题靠左 -->
      <svg
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        preserveAspectRatio="xMinYMid meet"
        class="h-44 w-full"
        role="img"
        aria-label="热行有符号误差的分布直方图"
      >
        <line
          :x1="PAD_X"
          :y1="HEIGHT - PAD_BOTTOM"
          :x2="WIDTH - PAD_X"
          :y2="HEIGHT - PAD_BOTTOM"
          class="stroke-border-strong"
        />
        <rect
          v-for="bin in bins"
          :key="bin.index"
          :x="bin.x"
          :y="bin.y"
          :width="bin.width"
          :height="bin.height"
          :class="bin.paint"
        >
          <title>{{ bin.title }}</title>
        </rect>
        <text :x="PAD_X" :y="HEIGHT - 5" class="fill-text-secondary text-[9px]">
          ≤ −{{ edgeLabel }}
        </text>
        <text
          :x="WIDTH / 2"
          :y="HEIGHT - 5"
          text-anchor="middle"
          class="fill-text-secondary text-[9px]"
        >
          0
        </text>
        <text
          :x="WIDTH - PAD_X"
          :y="HEIGHT - 5"
          text-anchor="end"
          class="fill-text-secondary text-[9px]"
        >
          ≥ +{{ edgeLabel }}
        </text>
      </svg>
      <p class="text-2xs text-text-secondary">{{ biasText }}</p>
    </template>
  </div>
</template>
