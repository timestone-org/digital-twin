<script setup lang="ts">
/**
 * @fileoverview DtLineChart —— 时序折线图。系列自带的 `axis` 分组决定它挂哪条
 * Y 轴，`null` 画成断档；echarts 走动态 import，取到的实例只更新不重建。
 */
import { onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { createChart } from '../../shared/chart/echarts'
import type { DtChartHandle } from '../../shared/chart/echarts'
import { buildLineOption } from '../../shared/chart/lineOption'
import type { DtChartSeries } from '../../shared/chart/series'
import DtEmpty from '../DtEmpty/DtEmpty.vue'
import DtSpinner from '../DtSpinner/DtSpinner.vue'

const props = withDefaults(
  defineProps<{
    series: readonly DtChartSeries[]
    loading?: boolean | undefined
    /** 任意 CSS 长度；图表按它吃满宽度。 */
    height?: string | undefined
    ariaLabel?: string | undefined
  }>(),
  { loading: false, height: '320px', ariaLabel: '折线图' },
)

const host = shallowRef<HTMLDivElement | null>(null)
const chart = shallowRef<DtChartHandle | null>(null)
let sizeWatcher: ResizeObserver | null = null
let isGone = false

async function attach(): Promise<void> {
  const el = host.value
  if (el === null) return
  const handle = await createChart(el)
  // ⚠ 动态 import 落地前组件可能已卸载：不判就会留下一个永不释放的实例
  if (isGone) {
    handle.dispose()
    return
  }
  chart.value = handle
  handle.setOption(buildLineOption(props.series))
  sizeWatcher = new ResizeObserver(() => {
    handle.resize()
  })
  sizeWatcher.observe(el)
}

onMounted(() => {
  void attach()
})

// 换数据只 setOption，不销毁重建：重建会丢动画状态并抖一次 GPU 资源
watch(
  () => props.series,
  (series) => {
    chart.value?.setOption(buildLineOption(series))
  },
)

onUnmounted(() => {
  isGone = true
  sizeWatcher?.disconnect()
  sizeWatcher = null
  chart.value?.dispose()
  chart.value = null
})
</script>

<template>
  <div class="dt-line-chart" :style="{ height }">
    <div
      ref="host"
      class="dt-line-chart__canvas"
      role="img"
      :aria-label="ariaLabel"
    />
    <div v-if="loading" class="dt-line-chart__veil">
      <DtSpinner />
    </div>
    <DtEmpty
      v-else-if="series.length === 0"
      class="dt-line-chart__veil"
      hint="换一段时间或换一组指标试试"
    />
  </div>
</template>

<style scoped lang="scss">
.dt-line-chart {
  position: relative;
  width: 100%;

  &__canvas {
    width: 100%;
    height: 100%;
  }

  &__veil {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    background: var(--surface-panel);
  }
}
</style>
