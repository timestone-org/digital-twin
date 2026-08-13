<script setup lang="ts">
/**
 * @fileoverview 总体评估卡。全部数字来自折外预测——模型没见过答案的那次。
 */
import type { ModelMetricsBlock } from '@dt/contracts'
import { DtCard, DtTag } from '@dt/ui'

import {
  RELIABILITY_VIEW,
  formatCoverage,
  formatMinutes,
} from '@/features/hvac/modelView'

const props = defineProps<{
  overall: ModelMetricsBlock
  sample: number | null
}>()
</script>

<template>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
    <DtCard>
      <p class="text-xs text-text-secondary">训练样本</p>
      <p class="mt-1 text-lg font-semibold text-text-primary">
        {{ props.sample ?? '—' }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">折外 MAE</p>
      <p class="mt-1 text-lg font-semibold text-text-primary">
        {{ formatMinutes(props.overall.mae) }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">中位绝对误差</p>
      <p class="mt-1 text-lg font-semibold text-text-primary">
        {{ formatMinutes(props.overall.medae) }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">RMSE</p>
      <p class="mt-1 text-lg font-semibold text-text-primary">
        {{ formatMinutes(props.overall.rmse) }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">
        区间覆盖率
        <span class="text-text-disabled">（标称 80%）</span>
      </p>
      <p
        class="mt-1 text-lg font-semibold"
        :class="
          props.overall.coverage < 0.7
            ? 'text-state-warning'
            : 'text-text-primary'
        "
      >
        {{ formatCoverage(props.overall.coverage) }}
      </p>
    </DtCard>
    <DtCard>
      <p class="text-xs text-text-secondary">平均区间宽度</p>
      <p class="mt-1 flex items-center gap-2">
        <span class="text-lg font-semibold text-text-primary">
          {{ formatMinutes(props.overall.mean_width) }}
        </span>
        <DtTag
          size="sm"
          :intent="RELIABILITY_VIEW[props.overall.reliability].intent"
        >
          {{ RELIABILITY_VIEW[props.overall.reliability].label }}
        </DtTag>
      </p>
    </DtCard>
  </div>
</template>
