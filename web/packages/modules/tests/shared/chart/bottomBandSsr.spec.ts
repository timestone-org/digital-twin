/**
 * @fileoverview 拿**真** echarts 跑一遍 SSR，量出底部图例与横向缩放条真的不重叠。
 *
 * ⚠ 这一条是别处抓不到的：两者都锚在画布底，`legendStyle()` 缺省 `bottom: 0`、
 * 滑块缺省贴着底摆，这份 option 完全合法，形状断言全绿，而真渲染出来选窗条从图例
 * 的字上横穿过去。只有量图元的落点才看得见。
 * ⚠ 注册清单与 `shared/chart/echarts.ts` 那份对应，只把渲染器换成 SVG：
 * canvas 在 node 里出不了可断言的图元。装配点本身另有用例守着。
 * ⚠ 末尾那条反证不能省：不跑一次「滑块贴底摆」的对照，本文件在实现退化回去时
 * 会继续全绿。
 */
import { BarChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { describe, expect, it } from 'vitest'

import {
  bottomBand,
  cartesianGrid,
  categoryAxis,
  dataZoomSlider,
  legendStyle,
  valueAxis,
  type OptionFragment,
} from '../../../src/shared/chart/chartKit'
import type { ChartTheme } from '../../../src/shared/chart/theme'

echarts.use([
  BarChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  SVGRenderer,
])

/** 真渲染要量得出字宽，主题色给的是真色串。 */
const THEME: ChartTheme = {
  palette: ['#4f8cff', '#3ec98a', '#f2b544'],
  text: '#222222',
  textMuted: '#888888',
  axisLine: '#cccccc',
  splitLine: '#eeeeee',
  accent: '#4f8cff',
  idle: '#999999',
  tooltipBg: '#ffffff',
  tooltipBorder: '#dddddd',
}

/** 出厂预设 `stacked-hours` 那一档屏上的实际尺寸。 */
const PRESET = { width: 640, height: 360 }

/** 一块大图。 */
const WIDE = { width: 720, height: 460 }

/** 上下两端；y 向下为正。 */
interface Span {
  top: number
  bottom: number
}

/**
 * 缩放条整条的纵向范围。
 * ⚠ 滑块的图元画在一套上下翻转的坐标里（`matrix(a,0,0,-d,tx,ty)`），
 * ty 是它的下沿、路径里的 dy 要乘上 d 才是屏上的高度；把手那几个 d 是 7。
 */
function sliderSpan(svg: string): Span {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  const shapes = svg.matchAll(
    /<path d="([^"]*)" transform="matrix\(-?[\d.]+,0,0,(-[\d.]+),[\d.-]+,([\d.-]+)\)"/g,
  )
  for (const shape of shapes) {
    const scale = Math.abs(Number(shape[2]))
    const foot = Number(shape[3])
    const ys = [...(shape[1] ?? '').matchAll(/l-?[\d.]+ (-?[\d.]+)/g)].map(
      (hit) => Math.abs(Number(hit[1])),
    )
    const height = scale * Math.max(0, ...ys)
    top = Math.min(top, foot - height)
    bottom = Math.max(bottom, foot)
  }
  return { top, bottom }
}

/** 类目刻度那几段文字的落点。 */
function tickTops(svg: string): number[] {
  const glyphs = svg.matchAll(
    /<text[^>]*transform="translate\([\d.]+ ([\d.]+)\)"[^>]*>([^<]*)</g,
  )
  return [...glyphs]
    .filter((glyph) => ['一', '二', '三'].includes(glyph[2] ?? ''))
    .map((glyph) => Number(glyph[1]))
}

/** 图例逐条命中盒的纵向范围：`ecmeta_ssr_type="legend"` 那几个图元。 */
function legendSpan(svg: string): Span {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  const items = svg.matchAll(
    /<path d="M0 (-?[\d.]+)l[\d.]+ 0l0 ([\d.]+)[^"]*" transform="translate\([\d.]+ ([\d.]+)\)"[^>]*ecmeta_ssr_type="legend"/g,
  )
  for (const item of items) {
    const head = Number(item[3]) + Number(item[1])
    top = Math.min(top, head)
    bottom = Math.max(bottom, head + Number(item[2]))
  }
  return { top, bottom }
}

/**
 * 一块开着图例与横向缩放条的柱图。
 * @param slider 缩放条那一段
 * @param grid 绘图区那一段
 * @param fontSize 图例字号
 */
function optionOf(
  slider: OptionFragment[],
  grid: OptionFragment,
  fontSize: number,
): Record<string, unknown> {
  return {
    grid,
    legend: legendStyle(THEME, { fontSize, data: [{ name: '甲线' }] }),
    dataZoom: slider,
    xAxis: [categoryAxis(THEME, ['一', '二', '三'])],
    yAxis: [valueAxis(THEME, {})],
    series: [{ type: 'bar', name: '甲线', data: [12, 20, 8] }],
  }
}

/** 画成 SVG 串。 */
function render(
  option: Record<string, unknown>,
  size: { width: number; height: number },
): string {
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    ...size,
  })
  chart.setOption(option)
  const svg = chart.renderToSVGString()
  chart.dispose()
  return svg
}

/** 按 `bottomBand()` 摆好的那一份。 */
function tidy(fontSize: number): Record<string, unknown> {
  const band = bottomBand({ legend: true, legendFontSize: fontSize })
  return optionOf(
    dataZoomSlider(THEME, { bottom: band.zoom }),
    cartesianGrid({ legend: true, bottom: band.grid }),
    fontSize,
  )
}

describe('图例与横向缩放条同摆底部', () => {
  it('滑块整条落在图例之上，一个像素都不压到图例的字', () => {
    for (const size of [PRESET, WIDE]) {
      const svg = render(tidy(11), size)

      expect(sliderSpan(svg).bottom).toBeLessThanOrEqual(legendSpan(svg).top)
    }
  })

  it('图例字号调大也不重叠：那条带子是跟着字号算出来的', () => {
    const svg = render(tidy(24), WIDE)

    expect(sliderSpan(svg).bottom).toBeLessThanOrEqual(legendSpan(svg).top)
  })

  it('绘图区跟着让开：类目刻度一段都没画到滑块底下去', () => {
    const svg = render(tidy(11), WIDE)
    const top = sliderSpan(svg).top

    expect(tickTops(svg)).toHaveLength(3)
    for (const y of tickTops(svg)) expect(y).toBeLessThan(top)
  })

  it('反证：滑块贴底摆时，它整条压在图例的字上', () => {
    const stacked = optionOf(
      dataZoomSlider(THEME),
      cartesianGrid({ legend: true, bottom: 34 }),
      11,
    )
    const svg = render(stacked, WIDE)

    expect(sliderSpan(svg).bottom).toBeGreaterThan(legendSpan(svg).top)
  })
})
