/**
 * @fileoverview 拿**真** echarts 跑一遍 SSR，量出横向条形档开着缩放条时，
 * 竖着摆在右侧的滑块底下没有压着任何文字。
 *
 * ⚠ 这一条是别处抓不到的：本族其余用例断言的是 option 对象的形状，而让错边这件事
 * 形状上完全合法——`grid.bottom` 加得再大，值轴刻度与柱面读数照旧画到最右，被竖滑块
 * 整条盖住，没有任何报错。
 * ⚠ 断言量的是每段文字的落点（SVG 把它写在 transform 上），与滑块图元的左沿比：
 * 滑块那几个图元画在一套转了 90° 的坐标里（`matrix(0,d,d,0,tx,ty)`），tx 就是左沿。
 * ⚠ 这里显式 `use` 一遍组件而不是走 `shared/chart/echarts.ts`：那一份只装了
 * CanvasRenderer，而 SSR 要的是 SVGRenderer；装配点本身另有用例守着。
 */
import { BarChart, LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { describe, expect, it } from 'vitest'

import {
  BAR_ITEMS_KEY,
  BAR_VALUE_FIELD,
  barFieldKey,
  buildBarViews,
} from '../../../src/modules/bar-chart/bars'
import { buildBarOption } from '../../../src/modules/bar-chart/option'
import type { ChartTheme } from '../../../src/shared/chart/theme'

echarts.use([
  BarChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
])

/** 真 echarts 要量得出字宽，主题色给的是真色串。 */
const THEME: ChartTheme = {
  palette: ['#3366cc', '#33aa77', '#ddaa33'],
  text: '#222222',
  textMuted: '#888888',
  axisLine: '#cccccc',
  splitLine: '#eeeeee',
  accent: '#3366cc',
  idle: '#999999',
  tooltipBg: '#ffffff',
  tooltipBorder: '#dddddd',
}

const SIZE = { width: 720, height: 460 }

const CONFIG = {
  [BAR_ITEMS_KEY]: [
    { name: '1# 线', unit: 't' },
    { name: '2# 线', unit: 't' },
  ],
  chartStyle: 'horizontal',
  showDataZoom: true,
  showValueLabel: true,
  precision: 0,
}

/** 读数取到六位数：柱面标签越长，被滑块压住的那一截越明显。 */
const READINGS = [128_000, 96_000]

function resolve(): string {
  return ''
}

/** 一整块画出来的 SVG 串。 */
function render(grid: Record<string, unknown> = {}): string {
  const slots = Object.fromEntries(
    READINGS.map((_, index) => [
      barFieldKey(index, BAR_VALUE_FIELD),
      { state: 'ok' as const },
    ]),
  )
  const view = buildBarViews({
    config: CONFIG,
    rows: READINGS.map((value) => ({ [BAR_VALUE_FIELD]: value })),
    slots,
  })
  const option = buildBarOption(CONFIG, view, THEME, resolve)
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    ...SIZE,
  })
  chart.setOption({
    ...option,
    grid: { ...(option.grid as Record<string, unknown>), ...grid },
  })
  const svg = chart.renderToSVGString()
  chart.dispose()
  return svg
}

/** 竖滑块那一条带子的左沿。 */
function sliderLeft(svg: string): number {
  const shapes = [
    ...svg.matchAll(/transform="matrix\(0,[\d.]+,[\d.]+,0,([\d.]+),[\d.]+\)"/g),
  ].map((shape) => Number(shape[1]))
  return Math.min(...shapes)
}

/** 一段文字画出来的左右两沿。 */
interface Ink {
  left: number
  right: number
  text: string
}

/** 中日韩字符按一个字宽算，其余按 0.55 个字宽——SVG 串里没有字宽，只能估。 */
const CJK = /[\u3000-\u9fff\uff00-\uffef]/

/**
 * 一段文字占多宽。
 * ⚠ 估宽偏小的那一头是保守的：它只会让本文件漏报，不会误报一次不存在的重叠。
 * @param text 这一段文字
 * @param size 字号
 */
function inkWidth(text: string, size: number): number {
  return [...text].reduce(
    (sum, char) => sum + size * (CJK.test(char) ? 1 : 0.55),
    0,
  )
}

/** 一个属性的值；没写这个属性给空串。 */
function attrOf(tag: string, name: string): string {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? ''
}

/**
 * 每一段文字画在哪。
 * ⚠ 落点写在 transform 上，`x` 属性是在它之上再挪一段（图例的文字就靠它避开色块）；
 * 三种 `text-anchor` 各自决定落点是左沿、中点还是右沿——逐个属性去问，
 * 拿一条正则一把梭会因为属性次序不同而静默把 anchor 读成缺省的 start。
 */
function inks(svg: string): Ink[] {
  return [...svg.matchAll(/<text([^>]*)>([^<]*)</g)].map((hit) => {
    const tag = hit[1] ?? ''
    const text = hit[2] ?? ''
    const size = Number(/font-size:(\d+)px/.exec(tag)?.[1] ?? 11)
    const at =
      Number(/translate\(([\d.-]+) /.exec(tag)?.[1] ?? 0) +
      Number(attrOf(tag, 'x') || 0)
    const width = inkWidth(text, size)
    const anchor = attrOf(tag, 'text-anchor')
    const left =
      anchor === 'middle' ? at - width / 2 : anchor === 'end' ? at - width : at
    return { left, right: left + width, text }
  })
}

/** 伸到滑块底下去的那几段文字。 */
function covered(svg: string): Ink[] {
  const left = sliderLeft(svg)
  return inks(svg).filter((ink) => ink.right > left)
}

describe('横向条形档的竖滑块', () => {
  it('真画出一条竖滑块，而不是在底下摆一条横的', () => {
    const svg = render()

    expect(Number.isFinite(sliderLeft(svg))).toBe(true)
    expect(sliderLeft(svg)).toBeGreaterThan(SIZE.width / 2)
  })

  it('滑块底下一段文字都没压着：值轴刻度与柱面读数都收在它左边', () => {
    const svg = render()

    expect(inks(svg).length).toBeGreaterThan(4)
    expect(covered(svg)).toEqual([])
  })

  it('反证：右边只让 16 时，最右那一档刻度被压在滑块下', () => {
    expect(covered(render({ right: 16 })).length).toBeGreaterThan(0)
  })
})
