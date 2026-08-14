<script setup lang="ts">
/**
 * @fileoverview 折外预测-实际散点：x=实际、y=p50，对角线为理想。
 *
 * 自绘 SVG 而不是 echarts：图表包只注册了折线图，而这张图只有点、一条对角线
 * 和一条参考带，拉整个 ScatterChart 进包不划算（AC_MODEL_UI_DESIGN §3.7）。
 * 配色走语义 CSS 变量，随主题换肤。
 * ⚠ 两轴用**同一个**变换函数：这保证 `y = x` 那条理想对角线在两种刻度下都还是
 * 那条对角线，语义不损。
 */
import { computed } from 'vue'
import type { ModelPrediction } from '@dt/contracts'
import { DtEmpty } from '@dt/ui'

import { isCovered } from '@/features/hvac/modelView'

// 画布逻辑尺寸与留白（viewBox 单位）；参考带的采样点数
const SIZE = 384
const PAD = 40
const BAND_STEPS = 32

const props = defineProps<{
  rows: readonly ModelPrediction[]
  /** ±MAE 参考带的半宽（分钟）；没有热行时不画带。 */
  hotMae: number | null
  scale: 'linear' | 'sqrt'
}>()

interface Dot {
  /** 事件起始时刻：模型内唯一，充当稳定 key。 */
  id: string
  x: number
  y: number
  radius: number
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

const missedCount = computed(
  () => props.rows.filter((row) => !isCovered(row)).length,
)

const summary = computed(() => {
  const total = props.rows.length
  if (total === 0) return ''
  const share = Math.round((missedCount.value / total) * 100)
  return `共 ${total} 点，其中 ${missedCount.value} 点的 80% 区间未盖住实际值（${share}%）。`
})

const dots = computed<Dot[]>(() =>
  props.rows.map((row) => ({
    id: row.started_at,
    x: at(row.actual_minutes),
    y: SIZE - at(row.p50),
    radius: row.actual_minutes === 0 ? 2 : 2.5,
    paint: paintOf(row),
    title:
      `实际 ${row.actual_minutes} 分钟 · 预测 ${row.p50.toFixed(1)}` +
      `（${row.p10.toFixed(1)}–${row.p90.toFixed(1)}）`,
  })),
)

/** ⚠ 零行（开机即达标且判对）淡化：它们堆在原点，压住热行的真实表现。 */
function paintOf(row: ModelPrediction): string {
  if (!isCovered(row)) return 'fill-state-warning'
  if (row.actual_minutes === 0 && row.p50 === 0) return 'fill-text-disabled/40'
  return 'fill-accent-primary/70'
}

const ticks = computed(() => {
  const step = limit.value / 4
  return [0, 1, 2, 3, 4].map((index) => ({
    value: Math.round(step * index),
    at: at(step * index),
  }))
})

/**
 * ±MAE 带：非线性刻度下带宽不是常数，所以逐点算上下沿再拼成一个多边形。
 * 带外的点就是超出平均水平的失手。
 */
const band = computed(() => {
  const mae = props.hotMae
  if (mae === null || props.rows.length === 0) return ''
  const upper: string[] = []
  const lower: string[] = []
  for (let step = 0; step <= BAND_STEPS; step += 1) {
    const x = (limit.value * step) / BAND_STEPS
    upper.push(`${at(x)},${SIZE - at(Math.min(limit.value, x + mae))}`)
    lower.push(`${at(x)},${SIZE - at(Math.max(0, x - mae))}`)
  }
  return [...upper, ...lower.reverse()].join(' ')
})

/** 分钟 → 画布坐标。两轴共用，所以 y 只要拿 SIZE 减一下。 */
function at(minutes: number): number {
  const span = SIZE - PAD * 2
  const ratio =
    props.scale === 'sqrt'
      ? Math.sqrt(Math.max(0, minutes)) / Math.sqrt(limit.value)
      : minutes / limit.value
  return PAD + ratio * span
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <DtEmpty
      v-if="props.rows.length === 0"
      title="这个组合没有折外预测"
      hint="换一个组合，或先重训模型。"
    />
    <template v-else>
      <svg
        :viewBox="`0 0 ${SIZE} ${SIZE}`"
        class="h-96 w-96 max-w-full shrink-0"
        role="img"
        aria-label="折外预测与实际的散点对比"
      >
        <polygon v-if="band" :points="band" class="fill-accent-primary/8" />
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
          :r="dot.radius"
          :class="dot.paint"
        >
          <title>{{ dot.title }}</title>
        </circle>
      </svg>
      <!-- 这句话对所有人都有用，所以不是 sr-only -->
      <p class="text-2xs text-text-secondary">{{ summary }}</p>
    </template>
  </div>
</template>
