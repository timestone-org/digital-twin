/**
 * @fileoverview 把 `buildPieOption` 出的 option 交给**真 echarts** 跑一遍 SSR
 * （`renderer: 'svg'` + `ssr: true` + `renderToSVGString()`），断言逐片状态那几条
 * 图例真的被画在了 SVG 上。
 *
 * ⚠ 这一条是本族其余用例抓不到的一类：那几份把 echarts 整包打了桩、断言的是 option
 * 对象的形状，而这里错的是「这份完全合法的 option 交给真 echarts 之后画不出来」。
 * 图例只认两条认领路径——名字等于某条 `series.name`，或名字在该系列的原始 `data` 里。
 * 两条都不中的图例项 `_createItem` 根本不会被调用：图例项不存在，dev 构建下每渲一次
 * 刷一句 warn，生产构建下连这个都没有。饼族走的是后一条：没读数的那几片以 `value: null`
 * 占着 `series.data` 的位置，名字由数据项自己带着。
 * ⚠ 这里按需 `use()` 一份带 SVGRenderer 的清单，而不是走 `shared/chart/echarts.ts`：
 * 那一份只装了 CanvasRenderer（canvas 在 node 里出不了可断言的文本）。注册清单要与
 * 渲染真正用到的逐项对应，整包 `import * as echarts` 会把所有组件都装上，测不出真实条件。
 * ⚠ 末尾那条反证不能省：不跑一次「名字只在 legend.data 里、不在 series.data 里」的
 * 对照，本文件在实现退化回「没读数的片不进 series.data」时会继续全绿。
 */
import { PieChart } from 'echarts/charts'
import {
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { init, use, type ECharts } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { describe, expect, it } from 'vitest'

import { buildPieOption } from '../../../src/modules/pie-chart/option'
import {
  buildSliceViews,
  SLICE_ITEMS_KEY,
  SLICE_NOTES,
  sliceFieldKey,
  type SliceView,
} from '../../../src/modules/pie-chart/slices'
import type { ChartTheme } from '../../../src/shared/chart/theme'

use([PieChart, LegendComponent, TooltipComponent, TitleComponent, SVGRenderer])

/** 真渲染要量得出字宽，主题在这里是真色串，不从 CSS 变量读。 */
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

const CANVAS = { width: 640, height: 400 }

const THREE = [
  { name: '光伏', unit: 'kWh' },
  { name: '市电', unit: 'kWh' },
  { name: '储能', unit: 'kWh' },
]

const CONFIG = { [SLICE_ITEMS_KEY]: THREE, showLegend: true, precision: 0 }

function resolve(): string {
  return ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 三片各按传进来的档取值，读数一律取得到。
 * @param states 逐片所在的档，文档序
 */
function viewsOf(states: readonly ('ok' | 'pending' | 'error')[]): SliceView[] {
  const slots: Record<string, { state: 'ok' | 'pending' | 'error' }> = {}
  states.forEach((state, index) => {
    slots[sliceFieldKey(index)] = { state }
  })
  return buildSliceViews({
    config: CONFIG,
    rows: states.map((_, index) => ({ value: 30 + index })),
    slots,
  })
}

/** 拿真 echarts 把一份 option 画成 SVG 串。 */
function renderSvg(option: Record<string, unknown>): string {
  const chart: ECharts = init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    ...CANVAS,
  })
  chart.setOption(option)
  const svg = chart.renderToSVGString()
  chart.dispose()
  return svg
}

function optionOf(views: readonly SliceView[]): Record<string, unknown> {
  return asRecord(buildPieOption(CONFIG, views, THEME, resolve))
}

/** 把没读数的那几片从 `series.data` 里剔掉，`legend.data` 原样留着。 */
function dropBlankSlices(
  option: Record<string, unknown>,
): Record<string, unknown> {
  const series = asRecord(asArray(option.series)[0])
  const kept = asArray(series.data).filter(
    (item) => asRecord(item).value !== null,
  )
  return { ...option, series: [{ ...series, data: kept }] }
}

describe('真 echarts 画得出逐片状态没有', () => {
  it('非 ok 的那两片，带原因的图例名真的出现在 SVG 里', () => {
    const svg = renderSvg(optionOf(viewsOf(['ok', 'pending', 'error'])))

    expect(svg).toContain('光伏')
    expect(svg).toContain(`市电（${SLICE_NOTES.pending}）`)
    expect(svg).toContain(`储能（${SLICE_NOTES.error}）`)
  })

  it('反证：名字只挂在 legend.data 上、不在 series.data 里时，那两条一个字都画不出来', () => {
    const views = viewsOf(['ok', 'pending', 'error'])
    const svg = renderSvg(dropBlankSlices(optionOf(views)))

    expect(svg).toContain('光伏')
    expect(svg).not.toContain(`市电（${SLICE_NOTES.pending}）`)
    expect(svg).not.toContain(`储能（${SLICE_NOTES.error}）`)
  })
})
