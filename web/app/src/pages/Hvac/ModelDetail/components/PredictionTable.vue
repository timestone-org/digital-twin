<script setup lang="ts">
/**
 * @fileoverview 折外逐条对比表。游标翻页，上一页 / 下一页**替换**当前页。
 */
import type { DtDataColumn, ModelPrediction } from '@dt/contracts'
import { DtCursorPager, DtDataView } from '@dt/ui'

import { formatDateTime } from '@/utils/datetime'
import { formatSet } from '@/features/hvac/modelView'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'started', label: '起始时刻', width: '12rem', card: 'title' },
  { key: 'set', label: '组合', width: '12rem', card: 'meta' },
  { key: 'actual', label: '实际', width: '7rem', align: 'right' },
  { key: 'p50', label: '预测 p50', width: '8rem', align: 'right' },
  { key: 'interval', label: '80% 区间', width: '10rem', align: 'right' },
  { key: 'error', label: '误差', width: '7rem', align: 'right' },
]

interface Row {
  id: string
  started: string
  set: string
  actual: string
  p50: string
  interval: string
  error: string
  /** 区间没盖住实际值：覆盖率失手的那部分，要标出来。 */
  isMissed: boolean
}

const props = defineProps<{
  rows: readonly ModelPrediction[]
  loading: boolean
  error: string | null
  page: number
  hasPrev: boolean
  hasNext: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
  retry: []
}>()

function toRows(items: readonly ModelPrediction[]): Row[] {
  return items.map((item) => ({
    id: item.started_at,
    started: formatDateTime(item.started_at),
    set: formatSet(item.running_set),
    actual: `${item.actual_minutes} 分钟`,
    p50: item.p50.toFixed(1),
    interval: `${item.p10.toFixed(1)} – ${item.p90.toFixed(1)}`,
    error: (item.p50 - item.actual_minutes).toFixed(1),
    isMissed: !(
      item.p10 <= item.actual_minutes && item.actual_minutes <= item.p90
    ),
  }))
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <DtDataView
      class="min-h-0 flex-1"
      view="table"
      :columns="COLUMNS"
      :rows="toRows(props.rows)"
      :loading="props.loading"
      :error="props.error"
      :layout="{ toggle: false, minWidth: '56rem' }"
      :empty="{
        title: '还没有折外预测',
        hint: '训练完成后，这里逐条对比每次开机的预测与实际。',
      }"
      @retry="emit('retry')"
    >
      <template #cell-started="{ row }">{{ row.started }}</template>
      <template #cell-actual="{ row }">{{ row.actual }}</template>
      <template #cell-p50="{ row }">{{ row.p50 }}</template>
      <template #cell-error="{ row }">{{ row.error }}</template>
      <template #cell-set="{ row }">
        <span class="font-mono text-xs">{{ row.set }}</span>
      </template>
      <template #cell-interval="{ row }">
        <span :class="row.isMissed ? 'text-state-warning' : ''">
          {{ row.interval }}
        </span>
      </template>
    </DtDataView>

    <DtCursorPager
      class="shrink-0"
      aria-label="逐条对比翻页"
      :page="props.page"
      :count="props.rows.length"
      :has-prev="props.hasPrev"
      :has-next="props.hasNext"
      :loading="props.loading"
      @prev="emit('prev')"
      @next="emit('next')"
    />
  </div>
</template>
