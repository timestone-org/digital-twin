<script setup lang="ts">
/**
 * @fileoverview 总体评估八格。全部数字来自折外预测——模型没见过答案的那次。
 *
 * ⚠ 主口径是热行（实际>0）：五到八成开机「一开机就已达标」，整体 MAE 被
 * 大量误差为零的行灌水，只看它会把差模型读成好模型。老评估没有热行拆分时
 * 退回整体值并照旧渲染。
 * ⚠ 第 8 格是全页唯一出现整体口径的地方，必须带「含零行，仅供对照」并且
 * 明显小于前七格——那道落差本身就是零膨胀的证据。
 */
import { computed } from 'vue'
import type { ModelMetricsBlock } from '@dt/contracts'
import { DtCard, DtHelpTip, DtTag } from '@dt/ui'

import {
  COVERAGE_LOW,
  HIT_RATE_HELP,
  R2_HELP,
  RELIABILITY_VIEW,
  formatCoverage,
  formatMinutes,
  formatR2,
  formatRate,
  r2Class,
} from '@/features/hvac/modelView'

const props = defineProps<{
  overall: ModelMetricsBlock
  sample: number | null
}>()

/** 误差与区间的口径：有热行统计用热行，老评估退回整体。 */
const graded = computed(() => props.overall.hot ?? props.overall)

const sampleText = computed(() => {
  if (props.overall.zero_count === null) return props.sample ?? '—'
  const hot = props.overall.hot?.count ?? 0
  return `热 ${hot} / 零 ${props.overall.zero_count}`
})
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <DtCard>
      <p class="text-xs text-text-secondary">训练样本</p>
      <p class="mt-1 text-lg font-semibold text-text-primary">
        {{ sampleText }}
      </p>
    </DtCard>
    <DtCard>
      <p class="flex items-center gap-1 text-xs text-text-secondary">
        热行 R²
        <DtHelpTip label="热行 R²" :text="R2_HELP" />
      </p>
      <p class="mt-1 text-lg font-semibold" :class="r2Class(graded.r2)">
        {{ formatR2(graded.r2) }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">热行 MAE</p>
      <p class="mt-1 text-lg font-semibold text-text-primary">
        {{ formatMinutes(graded.mae) }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">热行中位误差</p>
      <p class="mt-1 text-lg font-semibold text-text-primary">
        {{ formatMinutes(graded.medae) }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">
        热行覆盖率
        <span class="text-text-disabled">（标称 80%）</span>
      </p>
      <p
        class="mt-1 text-lg font-semibold"
        :class="
          graded.coverage < COVERAGE_LOW
            ? 'text-state-warning'
            : 'text-text-primary'
        "
      >
        {{ formatCoverage(graded.coverage) }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">平均区间宽度</p>
      <p class="mt-1 flex items-center gap-2">
        <span class="text-lg font-semibold text-text-primary">
          {{ formatMinutes(graded.mean_width) }}
        </span>
        <DtTag size="sm" :intent="RELIABILITY_VIEW[graded.reliability].intent">
          {{ RELIABILITY_VIEW[graded.reliability].label }}
        </DtTag>
      </p>
    </DtCard>
    <DtCard>
      <p class="flex items-center gap-1 text-xs text-text-secondary">
        判零 / 判出
        <DtHelpTip label="判零率与判出率" :text="HIT_RATE_HELP" />
      </p>
      <p class="mt-1 text-lg font-semibold text-text-primary">
        {{ formatRate(props.overall.zero_hit_rate) }}
        <span class="text-text-disabled">/</span>
        {{ formatRate(props.overall.hot_hit_rate) }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">
        整体口径
        <span class="text-text-disabled">（含零行，仅供对照）</span>
      </p>
      <p class="mt-1 flex flex-wrap items-baseline gap-x-3 text-sm">
        <span class="text-text-secondary">
          R²
          <span :class="r2Class(props.overall.r2)">{{
            formatR2(props.overall.r2)
          }}</span>
        </span>
        <span class="text-text-secondary">
          MAE {{ formatMinutes(props.overall.mae) }}
        </span>
      </p>
    </DtCard>
  </div>
</template>
