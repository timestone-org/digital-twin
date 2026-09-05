<script setup lang="ts">
/**
 * @fileoverview 图表族的公共壳：两个 ref、标题与空态的 DOM，以及把渲染根派生的
 * 主题与取色器喂进各族 build 的接线。族组件因此只剩 props、build 闭包与空态口径。
 * DOM 形状或取色口径不同的族（罗盘、地图）直接用 useEChart，不套这层壳。
 */
import type { InteractionEvent } from '@dt/contracts'
import { computed, ref } from 'vue'

import { readText, readTrimmedText } from '../config'
import ModulePanel from '../ModulePanel.vue'
import type { ChartBuild } from './chartKit'
import { readChartTheme, readCssVar } from './theme'
import { useEChart, type UseEChartOptions } from './useEChart'

/**
 * 图元点击口径：取值器离了上抛回调没有任何用处，两件事一起给或一起不给。
 * ⚠ 取值器这一项不许叫 `valueOf`/`toString` 这类 `Object.prototype` 上已有的名字：
 * 声明成可选也永远读不到 `undefined`，缺省口径会被原型上那个方法悄悄顶掉。
 */
interface ChartClickBinding {
  /** 上抛的联动事件。 */
  emit: (event: InteractionEvent) => void
  /** 点击取值口径；缺省「类目名，退回系列名」。 */
  readValue?: (params: unknown) => string
}

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  build: ChartBuild
  isEmpty?: boolean
  emptyText?: string
  itemClick?: ChartClickBinding
  partialMerge?: string[]
  valuesDeep?: boolean
  watchValues?: () => unknown
  ariaSummary?: string
}>()

const rootRef = ref<HTMLDivElement | null>(null)
const chartRef = ref<HTMLDivElement | null>(null)

const title = computed(() => readText(props.config.title))

/**
 * 图区的读屏口径：canvas 里的一切对读屏是纯空白，只能挂一段模块派生的文本摘要。
 * ⚠ 摘要缺席时连属性一起省掉——`aria-label=""` 会把图区读成一个没名字的图形，
 * 比什么都不写更糟；⚠ 没有 `role` 的 div 上 `aria-label` 读屏根本不取。
 */
const ariaAttrs = computed<Record<string, string>>(() => {
  const summary = readTrimmedText(props.ariaSummary)
  return summary ? { role: 'img', 'aria-label': summary } : {}
})

/**
 * 壳的 props → 挂载选项。
 * ⚠ 这几项只在挂载时读一次，是有意的：它们是族的静态口径（点击取值、要换哪些键），
 * 运行中换掉也没有「重新接线」的语义；`itemClick` 尤其不能改成恒有——
 * 只开「整块可点」的族一旦被注册上点击，那次点击的冒泡会被吞掉。
 */
function chartOptions(): UseEChartOptions {
  return {
    rootRef,
    chartRef,
    onItemClick: props.itemClick?.emit,
    itemValueOf: props.itemClick?.readValue,
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
        <div ref="chartRef" class="dt-chart__canvas" v-bind="ariaAttrs" />
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
