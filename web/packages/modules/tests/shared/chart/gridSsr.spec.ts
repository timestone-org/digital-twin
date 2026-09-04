/**
 * @fileoverview 拿**真** echarts + 本包那份按需注册跑一遍 SSR，钉住
 * `cartesianGrid()` 出的绘图区真的把刻度文字与轴名收在画布之内、绘图区没被挤没。
 *
 * ⚠ 这一条是别处抓不到的：直角坐标族其余用例都把 echarts 打了桩、断言的是 option
 * 对象的形状，而这里错的是「这份完全合法的 option 交给真 echarts 之后画歪了」。
 * echarts 6 把 `grid.containLabel` 废成了要另注册 `LegacyGridContainLabel` 才生效的
 * 键，本包的装配点没有装它：写了这个键只会每渲染一帧刷一句 warn，再走一条不带收缩
 * 下限的回退路——小画布上绘图区会被刻度文字挤成 0 宽，柱子一根都画不出来。
 * ⚠ 注册清单与 `shared/chart/echarts.ts` 那份对应，只把渲染器换成 SVG：
 * canvas 在 node 里出不了可断言的文本。装配点本身另有用例守着。
 */
import { BarChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { describe, expect, it } from 'vitest'

import {
  cartesianGrid,
  categoryAxis,
  valueAxis,
} from '../../../src/shared/chart/chartKit'
import type { ChartTheme } from '../../../src/shared/chart/theme'

echarts.use([BarChart, GridComponent, SVGRenderer])

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

const CATEGORIES = ['甲线', '乙线', '丙线']
const READINGS = [12_345, 8_000, 3_000]

/** 纵轴最大的那一档刻度：读数按 2000 一档分，顶到 14,000。 */
const TOP_TICK = '14,000'

/** 纵轴轴名，取一个长到必然要占地方的。 */
const AXIS_NAME = '发电量千瓦时'

/** SVG 里的一段文字与它的落点。 */
interface Glyph {
  x: number
  y: number
  text: string
}

/** 带单位的刻度文字：长到能把窄画布上的绘图区挤没。 */
function longTick(value: number): string {
  return `${value.toFixed(3)} 千瓦时`
}

/**
 * 把一份 grid 片段画成 SVG 串。
 * @param grid 绘图区片段
 * @param size 画布尺寸
 * @param longLabels 刻度文字要不要带上单位
 */
function renderSvg(
  grid: Record<string, unknown>,
  size: { width: number; height: number },
  longLabels = false,
): string {
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    ...size,
  })
  chart.setOption({
    grid,
    xAxis: [categoryAxis(THEME, CATEGORIES)],
    yAxis: [
      valueAxis(THEME, {
        name: AXIS_NAME,
        ...(longLabels ? { axisLabelFormatter: longTick } : {}),
      }),
    ],
    series: [{ type: 'bar', data: READINGS }],
  })
  const svg = chart.renderToSVGString()
  chart.dispose()
  return svg
}

/** SVG 里画出来的每一段文字。SVG 渲染器把落点写在 transform 上，不是 x/y。 */
function glyphsOf(svg: string): Glyph[] {
  const pattern =
    /<text[^>]*transform="translate\((-?[\d.]+) (-?[\d.]+)\)"[^>]*>([^<]*)</g
  return [...svg.matchAll(pattern)].map((hit) => ({
    x: Number(hit[1]),
    y: Number(hit[2]),
    text: hit[3] ?? '',
  }))
}

/** 落点跑到画布外的那些文字。 */
function outside(
  svg: string,
  size: { width: number; height: number },
): Glyph[] {
  return glyphsOf(svg).filter(
    (glyph) =>
      glyph.x < 0 ||
      glyph.y < 0 ||
      glyph.x > size.width ||
      glyph.y > size.height,
  )
}

/** 柱子的宽度：柱是一条 `M x y l 宽 0 …` 的路径。 */
function barWidth(svg: string): number {
  const hit = /<path d="M-?[\d.]+ -?[\d.]+l(-?[\d.]+) 0/.exec(svg)
  return hit ? Number(hit[1]) : 0
}

const WIDE = { width: 640, height: 400 }
const NARROW = { width: 120, height: 100 }

describe('cartesianGrid 出的绘图区', () => {
  it('纵轴最大的那一档刻度真的画在 SVG 里', () => {
    const svg = renderSvg(cartesianGrid(), WIDE)

    expect(svg).toContain(TOP_TICK)
  })

  it('刻度文字与轴名一个都没跑到画布外', () => {
    for (const size of [WIDE, NARROW]) {
      expect(outside(renderSvg(cartesianGrid(), size), size)).toEqual([])
    }
  })

  it('刻度文字长到快摆不下时绘图区也没被挤没：柱子还有宽度', () => {
    expect(barWidth(renderSvg(cartesianGrid(), NARROW, true))).toBeGreaterThan(
      0,
    )
  })

  it('不再写作废了的 containLabel', () => {
    expect('containLabel' in cartesianGrid()).toBe(false)
  })

  it('反证：改回 containLabel，同一张窄图上的柱子一根都不剩', () => {
    const legacy = {
      top: 16,
      right: 16,
      bottom: 6,
      left: 6,
      containLabel: true,
    }

    expect(barWidth(renderSvg(legacy, NARROW, true))).toBe(0)
  })

  it('反证：不收字时轴名会被画到画布外，这几条断言才是有牙的', () => {
    const loose = { ...cartesianGrid(), outerBoundsMode: 'none' }

    expect(outside(renderSvg(loose, WIDE), WIDE)).not.toEqual([])
  })

  it('关掉收字的族交回 echarts 缺省：轴文字仍被画布兜着，越不出去', () => {
    const opened = cartesianGrid({ labelsInside: false, left: 44 })

    expect('outerBoundsMode' in opened).toBe(false)
    expect(outside(renderSvg(opened, WIDE), WIDE)).toEqual([])
  })
})
