/**
 * @fileoverview 图表族的 echarts 装配点（本包唯一一处）：按需注册全家桶，
 * 把实例面收窄成四件事。
 * ⚠ echarts 在 `scripts/gates/check_bundle_budget.py` 的 HEAVY 名单里，
 * 静态 import 会把它焊进首屏 chunk，闸门直接红——取值一律走动态 import。
 * ⚠ 测试在**本模块**上打桩，不要去 mock echarts 包本身，
 * 见 docs/agents/testing-standard-typescript.md §5.2。
 */
import type { ComposeOption } from 'echarts/core'
import type {
  BarSeriesOption,
  BoxplotSeriesOption,
  CandlestickSeriesOption,
  EffectScatterSeriesOption,
  FunnelSeriesOption,
  GaugeSeriesOption,
  GraphSeriesOption,
  HeatmapSeriesOption,
  LineSeriesOption,
  PictorialBarSeriesOption,
  PieSeriesOption,
  RadarSeriesOption,
  SankeySeriesOption,
  ScatterSeriesOption,
  SunburstSeriesOption,
  TreeSeriesOption,
  TreemapSeriesOption,
} from 'echarts/charts'
import type {
  CalendarComponentOption,
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  MarkLineComponentOption,
  PolarComponentOption,
  RadarComponentOption,
  TitleComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from 'echarts/components'

/** 图表族统一的 option 类型：聚合全部已装配的 series 与组件 option。 */
export type ECOption = ComposeOption<
  | BarSeriesOption
  | BoxplotSeriesOption
  | CandlestickSeriesOption
  | EffectScatterSeriesOption
  | FunnelSeriesOption
  | GaugeSeriesOption
  | GraphSeriesOption
  | HeatmapSeriesOption
  | LineSeriesOption
  | PictorialBarSeriesOption
  | PieSeriesOption
  | RadarSeriesOption
  | SankeySeriesOption
  | ScatterSeriesOption
  | SunburstSeriesOption
  | TreeSeriesOption
  | TreemapSeriesOption
  | CalendarComponentOption
  | DataZoomComponentOption
  | GridComponentOption
  | LegendComponentOption
  | MarkLineComponentOption
  | PolarComponentOption
  | RadarComponentOption
  | TitleComponentOption
  | TooltipComponentOption
  | VisualMapComponentOption
>

/**
 * 一次 setOption 的口径：`notMerge` 全量重建（结构/主题变），
 * `replaceMerge` 只换这几个键（值变，保住数值过渡动画）。
 */
export interface ChartUpdate {
  notMerge?: boolean
  replaceMerge?: string[]
}

/** 图表族用得到的实例面就这四件事；收窄成它，边界因此可打桩。 */
export interface ChartHandle {
  setOption(option: ECOption, update: ChartUpdate): void
  /** 图元点击，回调参数是 echarts 的事件对象。 */
  onClick(handler: (params: unknown) => void): void
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
    charts.BarChart,
    charts.BoxplotChart,
    charts.CandlestickChart,
    charts.EffectScatterChart,
    charts.FunnelChart,
    charts.GaugeChart,
    charts.GraphChart,
    charts.HeatmapChart,
    charts.LineChart,
    charts.PictorialBarChart,
    charts.PieChart,
    charts.RadarChart,
    charts.SankeyChart,
    charts.ScatterChart,
    charts.SunburstChart,
    charts.TreeChart,
    charts.TreemapChart,
    components.CalendarComponent,
    components.DataZoomComponent,
    components.GridComponent,
    components.LegendComponent,
    // 参考线（阈值线 / 目标线 / 基线）。缺它时 series.markLine 会被静默丢弃。
    components.MarkLineComponent,
    components.PolarComponent,
    components.RadarComponent,
    components.TitleComponent,
    components.TooltipComponent,
    components.VisualMapComponent,
    renderers.CanvasRenderer,
  ])
  return echarts
}

// 注册是全局一次性的：重复 use 会把同一批组件再装一遍
let core: ReturnType<typeof registerOnce> | null = null

/**
 * 在宿主元素上建一个图表实例。
 * ⚠ 新图表族要用的组件必须补进上面的 `use` 清单：漏注册的症状是运行时
 * 静默不渲染，既不报错也没有半张图可看。
 * @param host 承载画布的元素
 */
export async function createChart(host: HTMLElement): Promise<ChartHandle> {
  core ??= registerOnce()
  const instance = (await core).init(host)
  return {
    setOption: (option, update) => {
      instance.setOption(option, update)
    },
    onClick: (handler) => {
      instance.on('click', handler)
    },
    resize: () => {
      instance.resize()
    },
    dispose: () => {
      instance.dispose()
    },
  }
}
