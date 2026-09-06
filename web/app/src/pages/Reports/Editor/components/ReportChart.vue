<script setup lang="ts">
/** @fileoverview ECharts 试算视图，缺失值保留断点，卸载释放实例。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ECharts, EChartsOption } from 'echarts'
import type { ReportSchemas } from '@dt/contracts'
const props = defineProps<{ node: ReportSchemas['NodeValue'] }>()
const host = ref<HTMLElement | null>(null)
let chart: ECharts | null = null
let observer: ResizeObserver | null = null
let disposed = false
const option = computed<EChartsOption>(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis', renderMode: 'richText' },
  legend: { type: 'scroll', bottom: 0 },
  grid: { left: 45, right: 15, top: 25, bottom: 65 },
  xAxis: { type: 'time' },
  yAxis: { type: 'value', scale: true },
  series: (props.node.series ?? []).map((series) => ({
    name: series.name,
    type: props.node.kind === 'bar' ? 'bar' : 'line',
    connectNulls: false,
    data: series.points.map((point) => [
      point.ts,
      point.value === null ? null : Number(point.value),
    ]),
  })),
}))
onMounted(async () => {
  const echarts = await import('echarts')
  if (disposed || !host.value) return
  chart = echarts.init(host.value, 'dark')
  chart.setOption(option.value)
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(host.value)
})
watch(option, (value) => chart?.setOption(value, { notMerge: true }))
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  chart?.dispose()
})
</script>
<template>
  <div
    ref="host"
    class="h-64 w-full"
    role="img"
    :aria-label="node.title || '报告数据图表'"
  ></div>
</template>
