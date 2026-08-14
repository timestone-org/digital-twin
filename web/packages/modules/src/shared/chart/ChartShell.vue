<script setup lang="ts">
/**
 * @fileoverview 图表族的公共壳：两个 ref、标题与空态的 DOM，以及把渲染根派生的
 * 主题与取色器喂进各族 build 的接线。族组件因此只剩 props、build 闭包与空态口径。
 * DOM 形状或取色口径不同的族（罗盘、地图）直接用 useEChart，不套这层壳。
 */
import type { InteractionEvent } from '@dt/contracts'
import { computed, ref } from 'vue'

import { readText } from '../config'
import ModulePanel from '../ModulePanel.vue'
import type { ChartBuild } from './chartKit'
import { readChartTheme, readCssVar } from './theme'
import { useEChart, type UseEChartOptions } from './useEChart'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  build: ChartBuild
  isEmpty?: boolean
  emptyText?: string
  onItemClick?: (event: InteractionEvent) => void
  itemValueOf?: (params: unknown) => string
  partialMerge?: string[]
  valuesDeep?: boolean
  watchValues?: () => unknown
}>()

const rootRef = ref<HTMLDivElement | null>(null)
const chartRef = ref<HTMLDivElement | null>(null)

const title = computed(() => readText(props.config.title))

/**
 * 壳的 props → 挂载选项。
 * ⚠ 这几项只在挂载时读一次，是有意的：它们是族的静态口径（点击取值、要换哪些键），
 * 运行中换掉也没有「重新接线」的语义；`onItemClick` 尤其不能改成恒有——
 * 只开「整块可点」的族一旦被注册上点击，那次点击的冒泡会被吞掉。
 */
function chartOptions(): UseEChartOptions {
  return {
    rootRef,
    chartRef,
    onItemClick: props.onItemClick,
    itemValueOf: props.itemValueOf,
    partialMerge: props.partialMerge,
    valuesDeep: props.valuesDeep,
    build: (full) =>
      props.build(
        readChartTheme(rootRef.value),
        (name) => readCssVar(rootRef.value, name),
        full,
      ),
    watchConfig: () => props.config,
    watchValues: () => (props.watchValues ? props.watchValues() : props.values),
  }
}

useEChart(chartOptions())
</script>

<template>
  <div ref="rootRef" class="dt-chart">
    <ModulePanel :title="title">
      <div class="dt-chart__body">
        <div ref="chartRef" class="dt-chart__canvas" />
        <p v-if="isEmpty" class="dt-chart__empty">
          {{ emptyText ?? '暂无数据' }}
        </p>
      </div>
    </ModulePanel>
  </div>
</template>

<style scoped lang="scss">
.dt-chart {
  width: 100%;
  height: 100%;
}

.dt-chart__body {
  position: relative;
  height: 100%;
  padding: 4px 6px 6px;
}

.dt-chart__canvas {
  width: 100%;
  height: 100%;
}

.dt-chart__empty {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--text-disabled);
  font-size: 13px;
  inset: 0;
  pointer-events: none;
}
</style>
