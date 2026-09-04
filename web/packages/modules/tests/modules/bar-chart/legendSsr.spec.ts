/**
 * @fileoverview 拿**真 echarts** 跑一遍 SSR，断言逐行状态那几条图例真的被画出来了。
 *
 * ⚠ 这一条是别处抓不到的：本族其余用例把 echarts 整包打桩、断言的是 option 对象的形状，
 * 而这里错的是「这份完全合法的 option 交给真 echarts 之后画不出来」。
 * echarts 的图例只认两条认领路径——名字等于某条 `series.name`，或名字在该系列的
 * 原始 data 里。两条都不中的图例项 `_createItem` 根本不会被调用：图例项不存在，
 * dev 构建下每渲染一次刷一句 `series not exists` 的 warn，生产构建下连这个都没有。
 * 柱族走的是前一条：非 ok 的行 series 照常进 option、`data` 给空数组，
 * 名字由 series 自己带着。
 * ⚠ 这里显式 `use` 一遍组件而不是走 `shared/chart/echarts.ts`：那一份只装了
 * CanvasRenderer，而 SSR 要的是 SVGRenderer；装配点本身另有用例守着。
 * ⚠ 最后那条反证不能省：不跑一次「名字对不上」的对照，本文件在实现退化成
 * 「图例照单全收」时会继续全绿。
 */
import { BarChart, LineChart } from 'echarts/charts'
import {
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
  BAR_NOTES,
  BAR_VALUE_FIELD,
  barFieldKey,
  buildBarViews,
  type BarChartView,
} from '../../../src/modules/bar-chart/bars'
import { buildBarOption } from '../../../src/modules/bar-chart/option'
import type { ChartTheme } from '../../../src/shared/chart/theme'

echarts.use([
  BarChart,
  LineChart,
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

const SIZE = { width: 640, height: 400 }

const THREE = [
  { name: '1# 线', unit: 't' },
  { name: '2# 线', unit: 't' },
  { name: '3# 线', unit: 't' },
]

const CONFIG = { [BAR_ITEMS_KEY]: THREE, showLegend: true, precision: 0 }

function viewOf(states: readonly ('ok' | 'pending' | 'error')[]): BarChartView {
  const slots: Record<string, { state: 'ok' | 'pending' | 'error' }> = {}
  states.forEach((state, index) => {
    slots[barFieldKey(index, BAR_VALUE_FIELD)] = { state }
  })
  return buildBarViews({
    config: CONFIG,
    rows: states.map((_, index) => ({ [BAR_VALUE_FIELD]: 30 + index })),
    slots,
  })
}

/** 把一份 option 交给真 echarts 画成 SVG 串。 */
function renderSvg(
  option: Parameters<echarts.ECharts['setOption']>[0],
): string {
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    ...SIZE,
  })
  chart.setOption(option)
  const svg = chart.renderToSVGString()
  chart.dispose()
  return svg
}

describe('真 echarts 画得出逐行状态没有', () => {
  it('非 ok 的那两条图例真的出现在 SVG 里，而不是被静默丢掉', () => {
    const view = viewOf(['ok', 'pending', 'error'])
    const svg = renderSvg(buildBarOption(CONFIG, view, THEME, () => ''))

    expect(svg).toContain('1# 线')
    expect(svg).toContain(`2# 线（${BAR_NOTES.pending}）`)
    expect(svg).toContain(`3# 线（${BAR_NOTES.error}）`)
  })

  it('一行都画不出来时三条状态仍然全在图上：那时它们是屏上唯一的说明', () => {
    const view = viewOf(['error', 'error', 'pending'])
    const svg = renderSvg(buildBarOption(CONFIG, view, THEME, () => ''))

    for (const series of view.series) {
      expect(svg).toContain(series.legendName)
    }
  })

  it('历史档的空序列同样画得出图例：那一条也是 data 为空的 series', () => {
    const config = { ...CONFIG, valueSource: 'history' }
    const view = buildBarViews({
      config,
      rows: [{ seriesPoints: [{ t: 1, v: 5 }] }, { seriesPoints: [] }],
      slots: {
        [barFieldKey(0, 'series')]: { state: 'ok' },
        [barFieldKey(1, 'series')]: { state: 'error' },
      },
    })
    const svg = renderSvg(buildBarOption(config, view, THEME, () => ''))

    expect(svg).toContain(`2# 线（${BAR_NOTES.error}）`)
  })

  it('反证：名字对不上任何一条 series.name 的图例项根本不会被创建', () => {
    const svg = renderSvg({
      legend: { data: [{ name: '接得上' }, { name: '对不上' }] },
      xAxis: { type: 'category', data: ['甲'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', name: '接得上', data: [1] }],
    })

    expect(svg).toContain('接得上')
    expect(svg).not.toContain('对不上')
  })
})
