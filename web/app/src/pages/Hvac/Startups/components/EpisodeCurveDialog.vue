<script setup lang="ts">
/**
 * @fileoverview 单条开机的下钻曲线：起始前 10 分钟到达标后 10 分钟。
 * 一次只画运行组合里的一台——六条叠在一起反而看不出何时进的范围。
 */
import type { AcUnit, DtSegmentedOption } from '@dt/contracts'
import { DtLineChart, DtModal, DtNotice, DtSegmented } from '@dt/ui'
import type { DtChartSeries } from '@dt/ui'

import type { EpisodeRow } from '../startupView'

defineProps<{
  modelValue: boolean
  row: EpisodeRow | null
  units: readonly AcUnit[]
  serial: string
  options: readonly DtSegmentedOption[]
  series: readonly DtChartSeries[]
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:serial': [value: string]
}>()
</script>

<template>
  <DtModal
    :model-value="modelValue"
    title="这次开机的温湿度曲线"
    :description="
      row === null ? undefined : `起始 ${row.started} · ${row.combination}`
    "
    width="46rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtSegmented
        v-if="options.length > 1"
        :model-value="serial"
        :options="options"
        aria-label="看哪一台"
        @update:model-value="emit('update:serial', $event)"
      />
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
      <DtNotice v-else-if="options.length === 0" intent="info">
        这次开机的运行组合里没有台账上认得的空调，画不出曲线。
      </DtNotice>
      <DtLineChart
        v-else
        :series="series"
        :loading="loading"
        height="20rem"
        aria-label="开机过程的温湿度曲线"
      />
    </div>
  </DtModal>
</template>
