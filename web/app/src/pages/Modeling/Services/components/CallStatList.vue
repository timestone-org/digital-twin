<script setup lang="ts">
/**
 * @fileoverview 一个对外服务近一个月按天的调用量。
 *
 * ⚠ 记录里只有行数、耗时与状态码——**没有入参也没有出参**：那是业务数据、
 * 可能含敏感值，而且体积会压垮那张表。要查具体一次调用得靠 `trace_id` 去
 * 结构化日志里找（docs/MODELING_PLATFORM_DESIGN.md D15 的防线 ⑫）。
 */
import type { DtDataColumn, ModelCallStat } from '@dt/contracts'
import { DtDataView } from '@dt/ui'

import { formatDay } from '@/utils/datetime'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'day', label: '日期', card: 'title' },
  { key: 'total', label: '调用', align: 'right', width: '7rem' },
  { key: 'failed', label: '其中失败', align: 'right', width: '7rem' },
]

const EMPTY = {
  title: '这个月还没有人调过',
  hint: '对接方第一次带着密钥来算数之后，这里就会有账。',
}

const props = defineProps<{ rows: readonly ModelCallStat[] }>()
</script>

<template>
  <DtDataView
    view="table"
    :columns="COLUMNS"
    :rows="props.rows"
    :empty="EMPTY"
    :layout="{ fixedLayout: true, minWidth: '24rem' }"
  >
    <template #cell-day="{ row }">{{ formatDay(row.day) }}</template>
    <template #cell-total="{ row }">{{ row.total }}</template>
    <template #cell-failed="{ row }">{{ row.failed }}</template>
  </DtDataView>
</template>
