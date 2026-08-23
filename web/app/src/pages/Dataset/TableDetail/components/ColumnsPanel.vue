<script setup lang="ts">
/**
 * @fileoverview 台账详情的「列配置」分区。路由直接挂它，详情页只喂状态。
 *
 * ⚠ 这个分区**对只读账号照常可见**：列定义是读数据的前提——不知道某一列是
 * 均值还是增量，表格里的数就读不明白。藏起来的只有行内动作与新增入口。
 * ⚠ 自己不取数：台账与列的状态只在详情页那一份（设计 §7.2）。各分区各取一次
 * 的话，同一页上会出现两份列定义，而它们不一致时界面不会报任何错。
 */
import { computed } from 'vue'
import type { DatasetColumn, DatasetTable } from '@dt/contracts'
import { DtNotice } from '@dt/ui'

import ColumnList from './ColumnList.vue'
import { formatInterval } from '../../scripts/collectSummary'

const props = defineProps<{
  table: DatasetTable | null
  columns: readonly DatasetColumn[]
  /** 有一次重排或删除在飞。 */
  busy: boolean
}>()

const emit = defineEmits<{
  edit: [column: DatasetColumn]
  remove: [column: DatasetColumn]
  move: [column: DatasetColumn, delta: -1 | 1]
}>()

const hasPointColumn = computed(() =>
  props.columns.some((one) => one.source === 'point'),
)

/**
 * 人工录入的台账里配了点位列时的提醒。
 * ⚠ 这不是报错而是**一句事实**：后端不拦这种组合，但那几列永远不会自己有值，
 * 而界面上它们和别的列长得一模一样。
 */
const mismatch = computed(() => {
  const table = props.table
  if (table === null || !hasPointColumn.value) return null
  if (table.collect_mode !== 'manual') return null
  return '这张台账的取数方式是「人工录入」，不会按周期汇总；下面的点位列不会自己有值，要么改成人工录入，要么把台账改成自动采集。'
})

const period = computed(() => {
  const table = props.table
  if (table === null || table.collect_mode !== 'aggregate') return null
  return `点位列每 ${formatInterval(table.collect_interval_ms)} 从点位历史汇总出一个数。`
})
</script>

<template>
  <div class="flex min-h-0 flex-col gap-3">
    <DtNotice v-if="mismatch" intent="warning" icon="alert-triangle">
      {{ mismatch }}
    </DtNotice>
    <DtNotice v-else-if="period && hasPointColumn" intent="info">
      {{ period }}
    </DtNotice>

    <ColumnList
      :columns="props.columns"
      :busy="props.busy"
      @edit="emit('edit', $event)"
      @remove="emit('remove', $event)"
      @move="(column, delta) => emit('move', column, delta)"
    />
  </div>
</template>
