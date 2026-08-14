/**
 * @fileoverview echarts 的取得点：重依赖动态 import，只注册用得到的图表与组件。
 * ⚠ echarts 在 `scripts/gates/check_bundle_budget.py` 的 HEAVY 名单里，
 * 静态 import 会让它落进首屏 chunk，闸门直接红。
 * ⚠ 测试在**本模块**上打桩，不要去 mock echarts 包本身，
 * 见 docs/agents/testing-standard-typescript.md §5.2。
 */
import type { DtChartOption } from './lineOption'

/** 组件只用得到这三件事；把 echarts 的实例面收窄成它，边界因此可打桩。 */
export interface DtChartHandle {
  setOption(option: DtChartOption): void
  resize(): void
  dispose(): void
}

async function registerOnce() {
  const [echarts, charts, components, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ])
  echarts.use([
    charts.LineChart,
    components.GridComponent,
    components.LegendComponent,
    components.TooltipComponent,
    renderers.CanvasRenderer,
  ])
  return echarts
}

// 注册是全局一次性的：重复 use 会把同一批组件再装一遍
let core: ReturnType<typeof registerOnce> | null = null

/**
 * 在宿主元素上建一个图表实例。
 * @param host 承载画布的元素
 */
export async function createChart(host: HTMLElement): Promise<DtChartHandle> {
  core ??= registerOnce()
  const instance = (await core).init(host)
  return {
    // ⚠ notMerge：系列减少时不这么给，被移掉的那几条会留在图上继续画
    setOption: (option) => {
      instance.setOption(option, { notMerge: true })
    },
    resize: () => {
      instance.resize()
    },
    dispose: () => {
      instance.dispose()
    },
  }
}
