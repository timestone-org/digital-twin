<script setup lang="ts">
/**
 * @fileoverview 台账详情的「趋势」分区：勾数值列画曲线，外加一个跳到趋势分析页
 * 的入口。
 *
 * ⚠ 与另外两个分区一样受控地拿 table / columns / busy；序列则由本分区自己取，
 * 它只喂给这一处，且带着勾选与截断标记，摊到父级会让父级多管三份状态。
 * ⚠ 图表整体按 `table.id` 挂 `:key`：换台账时勾选与已取序列必须一起丢掉，
 * 逐项复位漏一份，新表的图上就会留着旧表那条看不出是旧的曲线。
 * ⚠ 跳转地址走 `datasetTrendTo()`，两端共用一份 query 键名——手写字面量写歪了
 * 不会报错，只是跳过去什么都没预选中（features/trend/trendLink.ts）。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import type { DatasetColumn, DatasetTable } from '@dt/contracts'
import { DtIcon } from '@dt/ui'

import DatasetTrendChart from '@/components/trend/DatasetTrendChart.vue'
import { datasetTrendTo } from '@/features/trend/trendLink'

const props = defineProps<{
  table: DatasetTable | null
  columns: readonly DatasetColumn[]
  /** 详情页那边有一次列的重排或删除在飞。 */
  busy: boolean
}>()

const tableId = computed(() => props.table?.id ?? '')
</script>

<template>
  <div class="flex min-h-0 flex-col gap-3">
    <div class="flex flex-wrap items-center justify-end gap-2">
      <RouterLink
        v-if="tableId !== ''"
        :to="datasetTrendTo(tableId)"
        class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-accent-primary/10 hover:text-text-primary"
      >
        <DtIcon name="chart-line" :size="14" />
        在趋势分析页打开（可与点位历史对照）
      </RouterLink>
    </div>

    <DatasetTrendChart
      v-if="tableId !== ''"
      :key="tableId"
      :table-id="tableId"
      :columns="props.columns"
      :busy="props.busy"
    />
  </div>
</template>
