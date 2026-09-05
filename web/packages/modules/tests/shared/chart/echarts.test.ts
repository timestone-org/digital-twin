/**
 * @fileoverview 守 echarts 装配点的契约：注册清单逐项对齐、多次建图只注册一次、
 * 建实例口径原样透给 init，以及实例面收窄成四件事且原样透传。
 * ⚠ 这是本包唯一允许 mock echarts 包本身的地方——被测的正是「怎么把它装起来」；
 * 其余用例一律在本模块上打桩，见 testing-standard-typescript §5.2。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createChart } from '../../../src/shared/chart/echarts'

const echarts = vi.hoisted(() => {
  const setOption = vi.fn()
  const on = vi.fn()
  const resize = vi.fn()
  const dispose = vi.fn()
  return {
    use: vi.fn((modules: readonly unknown[]) => modules),
    init: vi.fn((host: HTMLElement, theme?: unknown, init?: unknown) => ({
      host,
      theme,
      init,
      setOption,
      on,
      resize,
      dispose,
    })),
    setOption,
    on,
    resize,
    dispose,
  }
})

/** 假件只给真接口真的会返回的东西：装配点只用到 use / init 这两件。 */
vi.mock('echarts/core', () => ({ use: echarts.use, init: echarts.init }))
vi.mock('echarts/charts', () => ({
  BarChart: 'BarChart',
  BoxplotChart: 'BoxplotChart',
  CandlestickChart: 'CandlestickChart',
  EffectScatterChart: 'EffectScatterChart',
  FunnelChart: 'FunnelChart',
  GaugeChart: 'GaugeChart',
  GraphChart: 'GraphChart',
  HeatmapChart: 'HeatmapChart',
  LineChart: 'LineChart',
  PictorialBarChart: 'PictorialBarChart',
  PieChart: 'PieChart',
  RadarChart: 'RadarChart',
  SankeyChart: 'SankeyChart',
  ScatterChart: 'ScatterChart',
  SunburstChart: 'SunburstChart',
  TreeChart: 'TreeChart',
  TreemapChart: 'TreemapChart',
}))
vi.mock('echarts/components', () => ({
  CalendarComponent: 'CalendarComponent',
  DataZoomComponent: 'DataZoomComponent',
  GridComponent: 'GridComponent',
  LegendComponent: 'LegendComponent',
  MarkLineComponent: 'MarkLineComponent',
  PolarComponent: 'PolarComponent',
  RadarComponent: 'RadarComponent',
  TitleComponent: 'TitleComponent',
  TooltipComponent: 'TooltipComponent',
  VisualMapComponent: 'VisualMapComponent',
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: 'CanvasRenderer' }))

const REGISTERED = [
  'BarChart',
  'BoxplotChart',
  'CandlestickChart',
  'EffectScatterChart',
  'FunnelChart',
  'GaugeChart',
  'GraphChart',
  'HeatmapChart',
  'LineChart',
  'PictorialBarChart',
  'PieChart',
  'RadarChart',
  'SankeyChart',
  'ScatterChart',
  'SunburstChart',
  'TreeChart',
  'TreemapChart',
  'CalendarComponent',
  'DataZoomComponent',
  'GridComponent',
  'LegendComponent',
  'MarkLineComponent',
  'PolarComponent',
  'RadarComponent',
  'TitleComponent',
  'TooltipComponent',
  'VisualMapComponent',
  'CanvasRenderer',
]

beforeEach(() => {
  echarts.use.mockClear()
  echarts.init.mockClear()
  echarts.setOption.mockClear()
  echarts.on.mockClear()
})

describe('createChart', () => {
  it('注册清单逐项对齐——漏一项的症状是运行时静默不渲染', async () => {
    await createChart(document.createElement('div'))

    expect(echarts.use).toHaveBeenCalledTimes(1)
    expect(echarts.use.mock.calls[0]?.[0]).toEqual(REGISTERED)
  })

  it('多次建图只注册一次，实例逐个新建', async () => {
    const first = document.createElement('div')
    const second = document.createElement('div')

    await createChart(first)
    await createChart(second)

    expect(echarts.use).not.toHaveBeenCalled()
    expect(echarts.init).toHaveBeenCalledTimes(2)
    expect(echarts.init.mock.calls[0]?.[0]).toBe(first)
    expect(echarts.init.mock.calls[1]?.[0]).toBe(second)
  })

  it('分辨率倍率原样透给 init——echarts 只在这一刻读它', async () => {
    const host = document.createElement('div')

    await createChart(host, { devicePixelRatio: 2.5 })

    expect(echarts.init).toHaveBeenCalledWith(host, undefined, {
      devicePixelRatio: 2.5,
    })
  })

  it('不给口径就一项都不摆布，走 echarts 自己的默认值', async () => {
    const host = document.createElement('div')

    await createChart(host)

    expect(echarts.init).toHaveBeenCalledWith(host, undefined, {})
  })

  it('setOption 把口径原样交给实例', async () => {
    const handle = await createChart(document.createElement('div'))

    handle.setOption({ series: [] }, { notMerge: true })

    expect(echarts.setOption).toHaveBeenCalledWith(
      { series: [] },
      { notMerge: true },
    )
  })

  it('onClick 注册的是 click 事件', async () => {
    const handle = await createChart(document.createElement('div'))
    const handler = vi.fn()

    handle.onClick(handler)

    expect(echarts.on).toHaveBeenCalledWith('click', handler)
  })

  it('resize 与 dispose 直接透到实例上', async () => {
    const handle = await createChart(document.createElement('div'))

    handle.resize()
    handle.dispose()

    expect(echarts.resize).toHaveBeenCalledTimes(1)
    expect(echarts.dispose).toHaveBeenCalledTimes(1)
  })
})
