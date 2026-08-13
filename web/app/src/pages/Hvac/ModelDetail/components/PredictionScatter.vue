<script setup lang="ts">
/**
 * @fileoverview 折外预测-实际散点：x=实际、y=p50，对角线为理想。
 *
 * 自绘 SVG 而不是 echarts：图表包只注册了折线图，而这张图只有点与一条对角
 * 线，拉整个 ScatterChart 进包不划算。配色走语义 CSS 变量，随主题换肤。
 * ⚠ 区间没盖住实际值的点标警示色——它们就是覆盖率分母里失手的那部分。
 */
import { computed } from 'vue'
import type { ModelPrediction } from '@dt/contracts'

// 画布逻辑尺寸与留白（viewBox 单位）
const SIZE = 320
const PAD = 36

const props = defineProps<{ rows: readonly ModelPrediction[] }>()

interface Dot {
  /** 事件起始时刻：模型内唯一，充当稳定 key。 */
  id: string
  x: number
  y: number
  /** 着色类：零行淡化，区间失手标警示色，其余是正常热行。 */
  paint: string
  title: string
}

const limit = computed(() => {
  const values = props.rows.flatMap((row) => [row.actual_minutes, row.p50])
  const top = values.length === 0 ? 1 : Math.max(...values)
  // 顶到 10 的倍数，免得最大点贴着边框
  return Math.max(10, Math.ceil(top / 10) * 10)
})

const dots = computed<Dot[]>(() =>
  props.rows.map((row) => ({
    id: row.started_at,
    x: scale(row.actual_minutes),
    y: SIZE - scale(row.p50),
    paint: paintOf(row),
    title:
      `实际 ${row.actual_minutes} 分钟 · 预测 ${row.p50.toFixed(1)}` +
      `（${row.p10.toFixed(1)}–${row.p90.toFixed(1)}）`,
  })),
)

/** ⚠ 零行（开机即达标且判对）淡化：它们堆在原点，压住热行的真实表现。 */
function paintOf(row: ModelPrediction): string {
  const isCovered =
    row.p10 <= row.actual_minutes && row.actual_minutes <= row.p90
  if (!isCovered) return 'fill-state-warning'
  if (row.actual_minutes === 0 && row.p50 === 0) return 'fill-text-disabled/40'
  return 'fill-accent-primary/70'
}

const ticks = computed(() => {
  const step = limit.value / 4
  return [0, 1, 2, 3, 4].map((index) => ({
    value: Math.round(step * index),
    at: scale(step * index),
  }))
})

function scale(minutes: number): number {
  return PAD + (minutes / limit.value) * (SIZE - PAD * 2)
}
</script>

<template>
  <svg
    :viewBox="`0 0 ${SIZE} ${SIZE}`"
    class="h-72 w-72 shrink-0"
    role="img"
    aria-label="折外预测与实际的散点对比"
  >
    <!-- 轴 -->
    <line
      :x1="PAD"
      :y1="SIZE - PAD"
      :x2="SIZE - PAD"
      :y2="SIZE - PAD"
      class="stroke-border-strong"
    />
    <line
      :x1="PAD"
      :y1="PAD"
      :x2="PAD"
      :y2="SIZE - PAD"
      class="stroke-border-strong"
    />
    <!-- 对角线：预测 = 实际 -->
    <line
      :x1="PAD"
      :y1="SIZE - PAD"
      :x2="SIZE - PAD"
      :y2="PAD"
      class="stroke-border-strong"
      stroke-dasharray="4 4"
    />
    <g v-for="tick in ticks" :key="tick.value">
      <text
        :x="tick.at"
        :y="SIZE - PAD + 14"
        text-anchor="middle"
        class="fill-text-secondary text-[9px]"
      >
        {{ tick.value }}
      </text>
      <text
        :x="PAD - 6"
        :y="SIZE - tick.at + 3"
        text-anchor="end"
        class="fill-text-secondary text-[9px]"
      >
        {{ tick.value }}
      </text>
    </g>
    <text
      :x="SIZE / 2"
      :y="SIZE - 4"
      text-anchor="middle"
      class="fill-text-secondary text-[10px]"
    >
      实际达标时长（分钟）
    </text>
    <text
      :x="10"
      :y="SIZE / 2"
      text-anchor="middle"
      class="fill-text-secondary text-[10px]"
      :transform="`rotate(-90 10 ${SIZE / 2})`"
    >
      折外预测 p50（分钟）
    </text>
    <circle
      v-for="dot in dots"
      :key="dot.id"
      :cx="dot.x"
      :cy="dot.y"
      r="3"
      :class="dot.paint"
    >
      <title>{{ dot.title }}</title>
    </circle>
  </svg>
</template>
