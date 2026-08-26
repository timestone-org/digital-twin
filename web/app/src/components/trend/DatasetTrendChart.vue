<script setup lang="ts">
/**
 * @fileoverview 一张台账的趋势曲线：勾数值列、挑一段时间、画出来。
 * 台账详情的「趋势」分区与趋势分析页的台账源共用它。
 *
 * ⚠ 换台账时调用方必须按 `tableId` 给它挂 `:key` 整体重建：勾选与已取序列
 * 都是这一层的内部状态，逐项复位漏掉任何一份，新表的图上都会留着旧表的曲线
 * （而那条曲线看不出是旧的）。
 * ⚠ `filters` 插槽原样转给 `TrendSurface`：调用方自己那些「挑什么」的控件
 * （趋势分析页的选表下拉）要与勾选清单同处一栏，别再另起一行占掉图的高度。
 */
import { computed, onMounted, onUnmounted } from 'vue'

import type { DatasetColumn } from '@dt/contracts'

import { useDatasetTrend } from '@/features/trend/useDatasetTrend'
import TrendSurface from './TrendSurface.vue'

const props = withDefaults(
  defineProps<{
    tableId: string
    columns: readonly DatasetColumn[]
    /** 调用方那边还有一次写操作在飞：列马上就要变，这段时间不接受查询。 */
    busy?: boolean | undefined
  }>(),
  { busy: false },
)

const trend = useDatasetTrend(
  () => props.tableId,
  () => props.columns,
)

// 进来就画：默认已经勾上前几列，空图会让人以为这张台账没有数据
onMounted(() => {
  void trend.query()
})

// ⚠ 在途那次回来会写一个已经没人看的状态，也白占一条连接
onUnmounted(trend.dispose)

const footnote = computed(() =>
  trend.pointCount.value > 0 ? `共 ${trend.pointCount.value} 个数据点。` : '',
)
</script>

<template>
  <TrendSurface
    :items="trend.items.value"
    :selected="trend.selected.value"
    :series="trend.series.value"
    :loading="trend.loading.value || props.busy"
    :dirty="trend.dirty.value"
    :truncation="trend.truncation.value"
    :failure="trend.failure.value"
    :range="trend.range.value"
    blank-hint="趋势图只画数值列，先去「列配置」加一个数值类型的列。"
    :footnote="footnote"
    @toggle="trend.toggle($event)"
    @clear="trend.clear()"
    @query="trend.query()"
    @update:range="trend.range.value = $event"
  >
    <template #filters><slot name="filters" /></template>
  </TrendSurface>
</template>
