/**
 * @fileoverview 守趋势曲线的 option 形状：时间轴而不是类目轴、刻度按跨度分三档写法、
 * 没数的那几条照常进 option 且 data 给空数组（折线族的图例认的就是 series.name）、
 * 双轴时逐条挂对 `yAxisIndex` 且参考线跟着左轴走、面积填充只在两档上出现、
 * 提示框转义与数值标签不转义这一对相反的口径，以及点一条线上抛的是配置里的名称。
 *
 * ⚠ 顶层 option 键拼错 typecheck 全绿、运行时静默无效，只能靠这里断言形状。
 * ⚠ 最后一组拿**真 echarts** 跑 SSR：前面几条断言的都是 option 对象长什么样，
 * 而「这份合法的 option 交给真 echarts 之后画不画得出来」是另一回事——图例名在
 * series 里找不到时，echarts 连图元都不建，dev 下只有一句 warn。
 */
import { LineChart } from 'echarts/charts'
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
  buildTrendOption,
  markLineCarrier,
  pickedSeriesValue,
  tickFormatter,
} from '../../../src/modules/trend-chart/option'
import {
  SPAN_DAY_MS,
  SPAN_YEAR_MS,
} from '../../../src/modules/trend-chart/options'
import {
  buildSeriesViews,
  historyFieldKey,
  SERIES_ITEMS_KEY,
  type SeriesView,
} from '../../../src/modules/trend-chart/series'
import { bottomBand } from '../../../src/shared/chart/chartKit'
import type { ChartTheme } from '../../../src/shared/chart/theme'

const THEME: ChartTheme = {
  palette: ['tone-a', 'tone-b', 'tone-c'],
  text: 'tone-text',
  textMuted: 'tone-muted',
  axisLine: 'tone-axis',
  splitLine: 'tone-split',
  accent: 'tone-accent',
  idle: 'tone-idle',
  tooltipBg: 'tone-bg',
  tooltipBorder: 'tone-border',
}

const VARS: Record<string, string> = { '--brand': '#336699' }

function resolve(name: string): string {
  return VARS[name] ?? ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function call(raw: unknown, params: unknown): string {
  return typeof raw === 'function'
    ? String((raw as (input: unknown) => unknown)(params))
    : ''
}

const TWO = [
  { name: '进水', unit: '℃' },
  { name: '回水', unit: '℃' },
]

/** 一条序列的原始点，时刻按分钟递增。 */
function points(
  start: number,
  ...values: number[]
): { t: number; v: number }[] {
  return values.map((v, index) => ({ t: start + index * 60_000, v }))
}

function viewsOf(
  config: Record<string, unknown>,
  rows: readonly unknown[],
  states: readonly ('ok' | 'pending' | 'error')[] = [],
): SeriesView[] {
  const slots: Record<string, { state: 'ok' | 'pending' | 'error' }> = {}
  rows.forEach((_, index) => {
    slots[historyFieldKey(index)] = { state: states[index] ?? 'ok' }
  })
  return buildSeriesViews({ config, rows, slots })
}

function optionOf(
  config: Record<string, unknown>,
  views: readonly SeriesView[],
): Record<string, unknown> {
  return asRecord(buildTrendOption(config, views, THEME, resolve))
}

function seriesAt(
  option: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  return asRecord(asArray(option.series)[index])
}

const BASE = { [SERIES_ITEMS_KEY]: TWO }
const ROWS = [
  { series: 3, seriesPoints: points(1_700_000_000_000, 1, 2, 3) },
  { series: 6, seriesPoints: points(1_700_000_000_000, 4, 5, 6) },
]

describe('绘图区', () => {
  it('刻度文字用 echarts 6 的那一对键收进绘图区，不写作废了的 containLabel', () => {
    const grid = asRecord(optionOf(BASE, []).grid)

    expect('containLabel' in grid).toBe(false)
    expect(grid.outerBoundsMode).toBe('same')
    expect(grid.outerBoundsContain).toBe('all')
  })
})

describe('时间轴', () => {
  it('是时间轴而不是类目轴，两条窗口不同的系列才对得齐', () => {
    const option = optionOf(BASE, viewsOf(BASE, ROWS))

    expect(asRecord(option.xAxis).type).toBe('time')
    expect(seriesAt(option, 0).data).toEqual([
      [1_700_000_000_000, 1],
      [1_700_000_060_000, 2],
      [1_700_000_120_000, 3],
    ])
  })

  it('刻度按实际跨度分四档写法', () => {
    const at = Date.UTC(2026, 1, 3, 4, 5, 6)
    const local = new Date(at)
    const hh = String(local.getHours()).padStart(2, '0')

    expect(tickFormatter(60_000)(at)).toBe(
      `${hh}:${String(local.getMinutes()).padStart(2, '0')}:06`,
    )
    expect(tickFormatter(SPAN_DAY_MS - 1)(at)).toBe(
      `${hh}:${String(local.getMinutes()).padStart(2, '0')}`,
    )
    expect(tickFormatter(SPAN_DAY_MS + 1)(at)).toContain('-')
    expect(tickFormatter(SPAN_YEAR_MS + 1)(at)).toBe(
      `${String(local.getFullYear())}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`,
    )
  })

  it('两端留白收的是一对百分比串，收布尔会被静默忽略', () => {
    expect(asRecord(optionOf(BASE, []).xAxis).boundaryGap).toEqual([0, 0])
    expect(
      asRecord(optionOf({ ...BASE, boundaryGap: true }, []).xAxis).boundaryGap,
    ).toEqual(['2%', '2%'])
  })

  it('轴名留空时整个键都不写，不摆一个空名字', () => {
    const named = optionOf({ ...BASE, xAxisName: ' 时间 ' }, [])

    expect(asRecord(named.xAxis).name).toBe('时间')
    expect('name' in asRecord(optionOf(BASE, []).xAxis)).toBe(false)
  })
})

describe('逐条状态落在图例上', () => {
  it('没数的那几条照常进 option、data 给空数组', () => {
    const views = viewsOf(BASE, ROWS, ['ok', 'error'])
    const option = optionOf({ ...BASE, showLegend: true }, views)

    expect(asArray(option.series).map((item) => asRecord(item).name)).toEqual([
      '进水',
      '回水（取不到）',
    ])
    expect(seriesAt(option, 1).data).toEqual([])
  })

  it('图例上每一个名字都与某条 series 的 name 逐字相同', () => {
    const views = viewsOf(BASE, ROWS, ['ok', 'pending'])
    const option = optionOf({ ...BASE, showLegend: true }, views)
    const names = asArray(option.series).map((item) => asRecord(item).name)

    expect(
      asArray(asRecord(option.legend).data).map((item) => asRecord(item).name),
    ).toEqual(names)
  })

  it('取不到的那一条图例文字置灰，图例本身缺省开着', () => {
    const views = viewsOf(BASE, ROWS, ['ok', 'error'])
    const legend = asRecord(optionOf(BASE, views).legend)
    const items = asArray(legend.data).map((item) => asRecord(item))

    expect(asRecord(items[0]?.textStyle).color).toBe('tone-text')
    expect(asRecord(items[1]?.textStyle).color).toBe('tone-muted')
    expect(asRecord(items[1]?.itemStyle).color).toBe('tone-muted')
  })

  it('关掉图例就只剩一个 show:false，不留半份数据', () => {
    expect(optionOf({ ...BASE, showLegend: false }, []).legend).toEqual({
      show: false,
    })
  })
})

describe('画法与配色', () => {
  it('五档画法各自只改折线本身的形状', () => {
    const views = viewsOf(BASE, ROWS)

    expect(
      seriesAt(optionOf({ ...BASE, chartStyle: 'smooth' }, views), 0).smooth,
    ).toBe(true)
    expect(
      seriesAt(optionOf({ ...BASE, chartStyle: 'step' }, views), 0).step,
    ).toBe('end')
    expect(
      seriesAt(optionOf({ ...BASE, chartStyle: 'stackedArea' }, views), 0)
        .stack,
    ).toBe('trend')
    expect('stack' in seriesAt(optionOf(BASE, views), 0)).toBe(false)
  })

  it('面积填充只在带面积的两档上出现，其余档整个键都不写', () => {
    const views = viewsOf(BASE, ROWS)

    expect('areaStyle' in seriesAt(optionOf(BASE, views), 0)).toBe(false)
    expect(
      asRecord(
        seriesAt(optionOf({ ...BASE, chartStyle: 'area' }, views), 0).areaStyle,
      ).opacity,
    ).toBe(0.18)
  })

  it('渐变末端色填了就用它，留空由主色派生同色渐隐', () => {
    const views = viewsOf(
      { ...BASE, [SERIES_ITEMS_KEY]: [{ color: 'var(--brand)' }] },
      [ROWS[0]],
    )
    const shared = {
      ...BASE,
      [SERIES_ITEMS_KEY]: [{ color: 'var(--brand)' }],
      chartStyle: 'area',
      areaGradient: true,
    }
    const derived = asRecord(
      asRecord(seriesAt(optionOf(shared, views), 0).areaStyle).color,
    )
    const explicit = asRecord(
      asRecord(
        seriesAt(
          optionOf({ ...shared, areaGradientTo: 'var(--brand)' }, views),
          0,
        ).areaStyle,
      ).color,
    )

    expect(derived.type).toBe('linear')
    expect(asRecord(asArray(derived.colorStops)[1]).color).toBe(
      'rgba(51, 102, 153, 0)',
    )
    expect(asRecord(asArray(explicit.colorStops)[1]).color).toBe('#336699')
  })

  it('取不到颜色时省掉那个键，绝不写 color 空串', () => {
    const bare: ChartTheme = { ...THEME, palette: [] }
    const views = viewsOf(BASE, ROWS)
    const option = asRecord(
      buildTrendOption(
        { ...BASE, chartStyle: 'area', areaGradient: true },
        views,
        bare,
        resolve,
      ),
    )
    const series = asRecord(asArray(option.series)[0])

    expect('color' in asRecord(series.lineStyle)).toBe(false)
    expect('color' in asRecord(series.areaStyle)).toBe(false)
  })

  it('逐条固定色压过色板，色板按文档序取而不是按第几条画得出来', () => {
    const config = {
      [SERIES_ITEMS_KEY]: [
        { name: '甲' },
        { name: '乙', color: 'var(--brand)' },
      ],
    }
    const views = viewsOf(config, ROWS, ['error', 'ok'])
    const option = optionOf(config, views)

    expect(asRecord(seriesAt(option, 0).lineStyle).color).toBe('tone-a')
    expect(asRecord(seriesAt(option, 1).lineStyle).color).toBe('#336699')
  })
})

describe('双轴与参考线', () => {
  const config = {
    [SERIES_ITEMS_KEY]: [
      { name: '功率', axis: 'right' },
      { name: '温度', axis: 'left' },
    ],
    dualAxis: true,
    refLines: [{ value: 80, label: '上限' }],
  }

  it('没开双轴时只有一根轴，右轴那一档静默等同左轴', () => {
    const flat = { ...config, dualAxis: false }
    const option = optionOf(flat, viewsOf(flat, ROWS))

    expect(asArray(option.yAxis)).toHaveLength(1)
    expect(seriesAt(option, 0).yAxisIndex).toBe(0)
  })

  it('开了双轴时逐条挂对轴，右轴不再画一遍分隔线', () => {
    const option = optionOf(config, viewsOf(config, ROWS))

    expect(asArray(option.yAxis)).toHaveLength(2)
    expect(seriesAt(option, 0).yAxisIndex).toBe(1)
    expect(seriesAt(option, 1).yAxisIndex).toBe(0)
    expect(asRecord(asArray(option.yAxis)[1]).splitLine).toEqual({
      show: false,
    })
  })

  it('参考线只挂一条 series，且挂在左轴那一条上', () => {
    const option = optionOf(config, viewsOf(config, ROWS))

    expect('markLine' in seriesAt(option, 0)).toBe(false)
    expect(
      asArray(asRecord(seriesAt(option, 1).markLine).data).map(
        (item) => asRecord(item).yAxis,
      ),
    ).toEqual([80])
  })

  it('一条左轴系列都没有时退到第一条画得出来的，都画不出来就不挂', () => {
    const rightOnly = viewsOf(
      { ...config, [SERIES_ITEMS_KEY]: [{ name: '甲', axis: 'right' }] },
      [ROWS[0]],
    )

    expect(markLineCarrier(rightOnly, true)).toBe(0)
    expect(markLineCarrier(viewsOf(BASE, ROWS, ['error', 'error']), true)).toBe(
      -1,
    )
  })

  it('参考值不是数的那几行整行丢掉，颜色与字号照收', () => {
    const withRefs = {
      ...BASE,
      refLines: [
        { value: 'x' },
        {
          value: 12,
          label: '上限',
          color: 'var(--brand)',
          fontSize: 14,
          lineType: 'solid',
        },
      ],
    }
    const data = asArray(
      asRecord(seriesAt(optionOf(withRefs, viewsOf(BASE, ROWS)), 0).markLine)
        .data,
    )

    expect(data).toHaveLength(1)
    expect(asRecord(asRecord(data[0]).lineStyle).color).toBe('#336699')
    expect(asRecord(asRecord(data[0]).label).fontSize).toBe(14)
  })
})

describe('提示框、标签与缩放条', () => {
  it('提示框逐段转义，抬头是精确到秒的时刻', () => {
    const config = {
      ...BASE,
      [SERIES_ITEMS_KEY]: [{ name: '<b>甲', unit: '℃' }],
    }
    const views = viewsOf(config, [ROWS[0]])
    const formatter = asRecord(optionOf(config, views).tooltip).formatter
    const text = call(formatter, [
      { seriesIndex: 0, value: [1_700_000_000_000, 1.5] },
      { seriesIndex: 9, value: [1_700_000_000_000, 2] },
    ])

    expect(text).toContain('&lt;b&gt;甲：1.5℃')
    expect(text).not.toContain('<b>甲')
    expect(text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    expect(call(formatter, [{ seriesIndex: 0, value: 'x' }])).toBe('')
  })

  it('关掉提示框只剩一个 show:false', () => {
    expect(optionOf({ ...BASE, showTooltip: false }, []).tooltip).toEqual({
      show: false,
    })
  })

  it('数值标签缺省关着；开了走这一条自己的单位，且不转义', () => {
    const config = {
      ...BASE,
      [SERIES_ITEMS_KEY]: [{ unit: '&' }],
      showValueLabel: true,
    }
    const views = viewsOf(config, [ROWS[0]])
    const label = asRecord(seriesAt(optionOf(config, views), 0).label)

    expect(asRecord(seriesAt(optionOf(BASE, views), 0).label).show).toBe(false)
    expect(call(label.formatter, { value: [1, 2.5] })).toBe('2.5&')
    expect(call(label.formatter, { value: [1, 'x'] })).toBe('')
  })

  it('缩放条按开关出现，出现时给底部让位', () => {
    const zoomed = optionOf({ ...BASE, showDataZoom: true }, [])

    const bare = optionOf(
      { ...BASE, showDataZoom: true, showLegend: false },
      [],
    )

    expect(asArray(zoomed.dataZoom)).toHaveLength(2)
    expect(Number(asRecord(zoomed.grid).bottom)).toBeGreaterThan(
      Number(asRecord(bare.grid).bottom),
    )
    expect('dataZoom' in optionOf(BASE, [])).toBe(false)
  })

  it('滑块摞在图例之上：两者都锚在画布底，不错开就横穿图例的字', () => {
    // ⚠ 落位钉的是共用那一份，真渲染量在 tests/shared/chart/bottomBandSsr.spec.ts
    const band = bottomBand({ legend: true, legendFontSize: 11 })
    const zoomed = optionOf({ ...BASE, showDataZoom: true }, [])

    expect(asRecord(asArray(zoomed.dataZoom)[0]).bottom).toBe(band.zoom)
    expect(asRecord(zoomed.grid).bottom).toBe(band.grid)
    expect(band.zoom).toBeGreaterThan(4)
  })

  it('关掉图例时滑块回到贴底，绘图区少让一条带子', () => {
    const bare = optionOf(
      { ...BASE, showDataZoom: true, showLegend: false },
      [],
    )

    expect(asRecord(asArray(bare.dataZoom)[0]).bottom).toBe(4)
    expect(asRecord(bare.grid).bottom).toBe(34)
  })

  it('点某一条线上抛配置里写的名称，不是带去重后缀的图例名', () => {
    const config = { [SERIES_ITEMS_KEY]: [{ name: '甲' }, { name: '甲' }] }
    const views = viewsOf(config, ROWS)

    expect(pickedSeriesValue(views, { seriesIndex: 1 })).toBe('甲')
    expect(pickedSeriesValue(views, { seriesIndex: 9 })).toBe('')
  })
})

/**
 * ⚠ 这一组是前面全部 option 断言都抓不到的那一类：option 完全合法、形状也对，
 * 但交给真 echarts 之后那几条图例根本不会被创建。图例只认「名字等于某条 series 的
 * name」或「名字在该 series 的原始 data 里」这两条路径。
 */
describe('真 echarts 画出来的样子', () => {
  echarts.use([
    LineChart,
    DataZoomComponent,
    GridComponent,
    LegendComponent,
    MarkLineComponent,
    TooltipComponent,
    SVGRenderer,
  ])

  /** 拿真 echarts 跑一次 SSR，回这一帧的 SVG。 */
  function renderSvg(option: Record<string, unknown>): string {
    const chart = echarts.init(null, null, {
      renderer: 'svg',
      ssr: true,
      width: 640,
      height: 360,
    })
    chart.setOption(option)
    const svg = chart.renderToSVGString()
    chart.dispose()
    return svg
  }

  it('等首帧与取不到的那两条，名字真的画在了图例上', () => {
    const config = {
      [SERIES_ITEMS_KEY]: [
        { name: '进水' },
        { name: '回水' },
        { name: '排气' },
      ],
      showLegend: true,
    }
    const rows = [
      ...ROWS,
      { series: 9, seriesPoints: points(1_700_000_000_000, 7) },
    ]
    const views = viewsOf(config, rows, ['ok', 'pending', 'error'])
    const svg = renderSvg(optionOf(config, views))

    expect(svg).toContain('进水')
    expect(svg).toContain('回水（等首帧）')
    expect(svg).toContain('排气（取不到）')
  })

  it('把没数的那几条从 option 里剔掉，图例上就一个字都没有了', () => {
    const config = {
      [SERIES_ITEMS_KEY]: [{ name: '进水' }, { name: '回水' }],
      showLegend: true,
    }
    const views = viewsOf(config, ROWS, ['ok', 'error'])
    const option = optionOf(config, views)
    const pruned = {
      ...option,
      series: asArray(option.series).slice(0, 1),
    }

    expect(renderSvg(pruned)).not.toContain('回水（取不到）')
  })
})
