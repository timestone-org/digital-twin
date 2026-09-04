/**
 * @fileoverview 把 `buildCalendarOption` 出的 option 交给**真** echarts 跑一遍 SSR，
 * 断言取不到 / 等首帧的那几张的名字真的出现在画出来的 SVG 里，且它们的日历框照建、
 * 一格不画。
 *
 * ⚠ 这一条组件用例抓不到：那边把 echarts 整包打了桩、断言的是 option 的形状，
 * 而这里要拦的是「这份合法的 option 交给真 echarts 之后画不出来」。日历族的逐张状态
 * 挂在 `title` 上（没有图例可挂、`graphic` 组件没注册），title 写错位置或没被渲染时
 * option 依旧合法、依旧没有半个字——只有真渲一遍才看得见。
 * ⚠ 注册清单与 `shared/chart/echarts.ts` 那份逐项对应，只把渲染器换成 SVG：
 * canvas 在 node 里出不了可断言的文本。
 */
import { describe, expect, it } from 'vitest'

import {
  buildMetricViews,
  METRIC_ITEMS_KEY,
  metricFieldKey,
  type MetricView,
} from '../../../src/modules/calendar-heat/days'
import { buildCalendarOption } from '../../../src/modules/calendar-heat/option'
import type { ChartTheme } from '../../../src/shared/chart/theme'

/** 真渲染要真色值：主题在这里是喂进去的，不从 CSS 变量读。 */
const THEME: ChartTheme = {
  palette: ['#4f8cff', '#3ec98a', '#f2b544', '#ef5f5f', '#9b6cff', '#8b93a7'],
  text: '#e6eaf2',
  textMuted: '#8b93a7',
  axisLine: '#2b3242',
  splitLine: '#20242f',
  accent: '#4f8cff',
  idle: '#8b93a7',
  tooltipBg: '#161a23',
  tooltipBorder: '#39415a',
}

const CANVAS = { width: 640, height: 360 }

const CONFIG = {
  timezone: 'UTC',
  [METRIC_ITEMS_KEY]: [
    { name: '每日能耗', unit: 'kWh' },
    { name: '每日达标率', unit: '%' },
    { name: '每日产量', unit: 't' },
  ],
}

function pointsOf(...samples: readonly (readonly [number, number])[]) {
  return samples.map(([at, reading]) => ({ t: at, v: reading }))
}

const JAN_5 = Date.UTC(2026, 0, 5)
const FEB_11 = Date.UTC(2026, 1, 11)
const MAR_3 = Date.UTC(2026, 2, 3)

/**
 * 第一张有三天读数；第二张取不到；第三张按传进来的档走。
 * @param third 第三张所在的档
 */
function viewsOf(third: 'ok' | 'pending'): MetricView[] {
  return buildMetricViews({
    config: CONFIG,
    rows: [
      {
        series: 88,
        seriesPoints: pointsOf([JAN_5, 12], [FEB_11, 88], [MAR_3, 45]),
      },
      {},
      {
        series: 30,
        seriesPoints: pointsOf([JAN_5, 30], [MAR_3, 70]),
      },
    ],
    slots: {
      [metricFieldKey(0)]: { state: 'ok' },
      [metricFieldKey(1)]: { state: 'error', message: '表被删了' },
      [metricFieldKey(2)]: { state: third },
    },
  })
}

/**
 * 用真 echarts 把一份 option 渲成 SVG 串。
 * @param config 该节点落库的配置
 * @param views 这一块的全部日历
 */
async function renderSvg(
  config: Record<string, unknown>,
  views: readonly MetricView[],
): Promise<string> {
  const [core, charts, components, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ])
  core.use([
    charts.HeatmapChart,
    components.CalendarComponent,
    components.GridComponent,
    components.TitleComponent,
    components.TooltipComponent,
    components.VisualMapComponent,
    renderers.SVGRenderer,
  ])
  const chart = core.init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    ...CANVAS,
  })
  chart.setOption(buildCalendarOption(config, views, THEME))
  const svg = chart.renderToSVGString()
  chart.dispose()
  return svg
}

/** SVG 里画了多少个图元。 */
function shapeCount(svg: string): number {
  return svg.split('<path').length - 1
}

describe('真 echarts 渲出来的那张图', () => {
  it('取不到与等首帧的那两张，名字真的出现在画面上', async () => {
    const svg = await renderSvg(CONFIG, viewsOf('pending'))

    expect(svg).toContain('每日达标率 · %（取不到）')
    expect(svg).toContain('每日产量 · t（等首帧）')
  })

  it('画得出来的那张也在，三张的标题一条都不少', async () => {
    const svg = await renderSvg(CONFIG, viewsOf('pending'))

    expect(svg).toContain('每日能耗 · kWh')
    expect(svg.split('<text').length - 1).toBeGreaterThan(3)
  })

  it('没读数的那几张日历框照建，格子一个不画', async () => {
    const blank = await renderSvg(CONFIG, viewsOf('pending'))
    const drawn = await renderSvg(CONFIG, viewsOf('ok'))

    // 第三张从「等首帧」变成有两天读数，多出来的图元就是那两格
    expect(shapeCount(drawn)).toBeGreaterThan(shapeCount(blank))
    // 框本身是画着的：三块日历的底格远多于一条空图
    expect(shapeCount(blank)).toBeGreaterThan(100)
  })

  it('月名按写死的那份数组画，不跟着 runner 的 locale 变', async () => {
    const svg = await renderSvg(CONFIG, viewsOf('ok'))

    expect(svg).toContain('1月')
    expect(svg).not.toContain('Jan')
  })

  it('矩阵铺法同样画得出三张的标题与年月轴', async () => {
    const config = { ...CONFIG, chartStyle: 'matrix' }
    const svg = await renderSvg(config, viewsOf('ok'))

    expect(svg).toContain('每日达标率 · %（取不到）')
    expect(svg).toContain('2026-01')
  })

  it('一天都没取到时渲得出来，只是一张空画布', async () => {
    const svg = await renderSvg(CONFIG, [])

    expect(svg).toContain('<svg')
    expect(shapeCount(svg)).toBe(0)
  })
})
