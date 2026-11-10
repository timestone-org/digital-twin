<script setup lang="ts">
/**
 * @fileoverview 折线视图：指标勾选 + 一张 DtLineChart。
 *
 * ⚠ 本期不在图上画达标范围带——这一轮只存范围，不做判定。
 * ⚠ 桶宽要显示出来：它是服务端按点数上限挑的，不说的话图上的疏密无从解释。
 */
import { computed } from 'vue'
import type { AcMetric } from '@dt/contracts'
import { DtCheckbox, DtLineChart, DtNotice, DtPageState } from '@dt/ui'
import type { DtChartSeries } from '@dt/ui'

import { MAX_CHARTED_METRICS } from '../scripts/acDataQuery'

const props = defineProps<{
  metrics: readonly AcMetric[]
  selected: readonly string[]
  series: readonly DtChartSeries[]
  intervalMinutes: number
  loading: boolean
  /** 取序列失败的那一句；有它就不画空图，免得看着像「这段没数据」。 */
  error?: string | null
}>()

const emit = defineEmits<{ toggle: [metric: string]; retry: [] }>()

const isFull = computed(() => props.selected.length >= MAX_CHARTED_METRICS)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <fieldset class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <legend class="sr-only">要画哪些指标</legend>
      <DtCheckbox
        v-for="metric in metrics"
        :key="metric.key"
        :model-value="selected.includes(metric.key)"
        :label="metric.name"
        :disabled="isFull && !selected.includes(metric.key)"
        @update:model-value="emit('toggle', metric.key)"
      />
    </fieldset>

    <p class="text-xs text-secondary">
      <span v-if="intervalMinutes > 0">
        每点聚合 {{ intervalMinutes }} 分钟。
      </span>
      最多同时画 {{ MAX_CHARTED_METRICS }} 条；缺口表示那段时间没有采到数据。
    </p>

    <DtNotice v-if="selected.length === 0" intent="info">
      勾选上面的指标就能看到曲线。
    </DtNotice>
    <DtPageState
      v-else-if="props.error"
      class="min-h-0 flex-1"
      :error="props.error"
      :empty="false"
      @retry="emit('retry')"
    />
    <DtLineChart
      v-else
      class="min-h-0 flex-1"
      height="100%"
      :series="series"
      :loading="loading"
      aria-label="空调原始数据趋势"
    />
  </div>
</template>
