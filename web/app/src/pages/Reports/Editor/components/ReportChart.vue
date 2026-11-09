<script setup lang="ts">
/** @fileoverview 报告图表视图，纸面模式用印刷色与 Word 同尺寸，卸载释放实例。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ECharts, EChartsOption } from 'echarts'
import type { ReportSchemas } from '@dt/contracts'
import { observeThemeChange, readToken } from '@dt/tokens'
import {
  REPORT_CHART_HEIGHT_CM,
  REPORT_PRINT_COLORS,
  reportChartOption,
} from '../scripts/reportChartTheme'
const props = withDefaults(
  defineProps<{ node: ReportSchemas['NodeValue']; paper?: boolean }>(),
  { paper: false },
)
const host = ref<HTMLElement | null>(null)
let chart: ECharts | null = null
let observer: ResizeObserver | null = null
let disposed = false
let detachTheme: (() => void) | null = null
const textColor = ref('')
const gridColor = ref('')
function readColors(): void {
  if (!host.value || props.paper) return
  const fallback = getComputedStyle(host.value).color
  textColor.value = readToken('--text-secondary', fallback, host.value)
  gridColor.value = readToken('--border-subtle', fallback, host.value)
}
const option = computed<EChartsOption>(() =>
  reportChartOption(
    props.node,
    props.paper
      ? REPORT_PRINT_COLORS
      : { text: textColor.value, grid: gridColor.value },
  ),
)
const style = computed(() =>
  props.paper ? { height: `${REPORT_CHART_HEIGHT_CM}cm` } : undefined,
)
onMounted(async () => {
  const echarts = await import('echarts')
  if (disposed || !host.value) return
  readColors()
  chart = echarts.init(host.value)
  chart.setOption(option.value)
  detachTheme = observeThemeChange(host.value, readColors)
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(host.value)
})
watch(option, (value) => chart?.setOption(value, { notMerge: true }))
onBeforeUnmount(() => {
  disposed = true
  detachTheme?.()
  observer?.disconnect()
  chart?.dispose()
})
</script>
<template>
  <div
    ref="host"
    :class="props.paper ? 'w-full' : 'h-64 w-full'"
    :style="style"
    role="img"
    :aria-label="node.title || '报告数据图表'"
  ></div>
</template>
