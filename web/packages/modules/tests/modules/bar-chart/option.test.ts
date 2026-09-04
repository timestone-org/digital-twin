/**
 * @fileoverview 守对比柱图的 option 形状：非 ok 的行照常进 series 且 data 为空、
 * 图例逐条的名字都等于某个 series.name、实时档共用一个堆位、折线行不参与堆叠、
 * 百分比档画的是算好的占比且不画参考线、正负对称档的量程、双轴只在真有右轴行时出现、
 * 横向档把类目轴转到 Y 并把参考线绑到 X，以及提示框转义与柱面标签不转义这一对相反的口径。
 *
 * ⚠ 顶层 option 键拼错 typecheck 全绿、运行时静默无效，只能靠这里断言形状。
 * ⚠ 图例条的名字对不上任何一个 series.name 时，echarts 连图元都不建、只在 dev 下打一句
 * warn——那一整档状态因此静默消失，所以两边的名字要逐条对上（另有一条真 echarts 的用例）。
 */
import { describe, expect, it } from 'vitest'

import {
  BAR_ITEMS_KEY,
  BAR_SERIES_FIELD,
  BAR_VALUE_FIELD,
  barFieldKey,
  buildBarViews,
  type BarChartView,
} from '../../../src/modules/bar-chart/bars'
import {
  buildBarOption,
  pickedBarValue,
  refHostIndex,
  symmetricBound,
} from '../../../src/modules/bar-chart/option'
import { bottomBand } from '../../../src/shared/chart/chartKit'
import type { ChartTheme } from '../../../src/shared/chart/theme'

const HOUR = 3_600_000
const BASE = new Date(2026, 2, 4, 9, 0, 0).getTime()

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

const VARS: Record<string, string> = { '--brand': 'tone-brand' }

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

const THREE = [
  { name: '1# 线', unit: 't' },
  { name: '2# 线', unit: 't' },
  { name: '3# 线', unit: 't' },
]

const BASE_CONFIG = { [BAR_ITEMS_KEY]: THREE, precision: 0 }

function liveView(
  config: Record<string, unknown>,
  numbers: readonly unknown[],
  states: readonly ('ok' | 'pending' | 'error')[] = [],
): BarChartView {
  const slots: Record<string, { state: 'ok' | 'pending' | 'error' }> = {}
  numbers.forEach((_, index) => {
    slots[barFieldKey(index, BAR_VALUE_FIELD)] = {
      state: states[index] ?? 'ok',
    }
  })
  return buildBarViews({
    config,
    rows: numbers.map((value) => ({ [BAR_VALUE_FIELD]: value })),
    slots,
  })
}

function historyView(
  config: Record<string, unknown>,
  rows: readonly (readonly { t: number; v: unknown }[])[],
): BarChartView {
  const slots: Record<string, { state: 'ok' }> = {}
  rows.forEach((_, index) => {
    slots[barFieldKey(index, BAR_SERIES_FIELD)] = { state: 'ok' }
  })
  return buildBarViews({
    config: { ...config, valueSource: 'history' },
    rows: rows.map((points) => ({ [`${BAR_SERIES_FIELD}Points`]: points })),
    slots,
  })
}

function optionOf(
  config: Record<string, unknown>,
  view: BarChartView,
): Record<string, unknown> {
  return asRecord(buildBarOption(config, view, THEME, resolve))
}

function seriesAt(
  option: Record<string, unknown>,
  at: number,
): Record<string, unknown> {
  return asRecord(asArray(option.series)[at])
}

describe('系列', () => {
  it('非 ok 的行照常进 series、data 给空数组，名字由 series.name 带着', () => {
    const view = liveView(BASE_CONFIG, [30, 10, 20], ['ok', 'pending', 'error'])
    const option = optionOf(BASE_CONFIG, view)

    expect(asArray(option.series)).toHaveLength(3)
    expect(seriesAt(option, 1).name).toBe('2# 线（等首帧）')
    expect(seriesAt(option, 1).data).toEqual([])
    expect(seriesAt(option, 2).data).toEqual([])
  })

  it('图例上每一个名字都等于某条 series.name，否则那一条根本不会被创建', () => {
    const config = { ...BASE_CONFIG, showLegend: true }
    const view = liveView(config, [30, 10, 20], ['ok', 'pending', 'error'])
    const option = optionOf(config, view)
    const names = asArray(option.series).map((item) => asRecord(item).name)

    for (const entry of asArray(asRecord(option.legend).data)) {
      expect(names).toContain(asRecord(entry).name)
    }
  })

  it('画不出东西的那几条图例置灰，取不到的那一条文字也置灰', () => {
    const config = { ...BASE_CONFIG, showLegend: true }
    const view = liveView(config, [30, 10, 20], ['ok', 'pending', 'error'])
    const data = asArray(asRecord(optionOf(config, view).legend).data).map(
      (item) => asRecord(item),
    )

    expect(data.map((item) => asRecord(item.textStyle).color)).toEqual([
      'tone-text',
      'tone-text',
      'tone-muted',
    ])
    expect(data.map((item) => asRecord(item.itemStyle).color)).toEqual([
      'tone-a',
      'tone-muted',
      'tone-muted',
    ])
  })

  it('逐行固定色压过色板，没填的按文档序取色板', () => {
    const config = {
      [BAR_ITEMS_KEY]: [{ name: '甲' }, { name: '乙', color: 'var(--brand)' }],
    }
    const option = optionOf(config, liveView(config, [1, 2]))

    expect(asRecord(seriesAt(option, 0).itemStyle).color).toBe('tone-a')
    expect(asRecord(seriesAt(option, 1).itemStyle).color).toBe('tone-brand')
  })

  it('前面一行断了，后面那几行的颜色不跟着挪一格', () => {
    const config = { ...BASE_CONFIG, showLegend: true }
    const view = liveView(config, [1, 2, 3], ['error', 'ok', 'ok'])
    const option = optionOf(config, view)

    expect(asRecord(seriesAt(option, 1).itemStyle).color).toBe('tone-b')
    expect(asRecord(seriesAt(option, 2).itemStyle).color).toBe('tone-c')
  })

  it('主题取不到弱化色时省掉那个键，不写空串——空串会被画成透明', () => {
    const config = { ...BASE_CONFIG, showLegend: true }
    const bare: ChartTheme = { ...THEME, textMuted: '' }
    const view = liveView(config, [1], ['error'])
    const legend = asRecord(
      asRecord(buildBarOption(config, view, bare, resolve)).legend,
    )
    const first = asRecord(asArray(legend.data)[0])

    expect(Object.keys(asRecord(first.textStyle))).not.toContain('color')
    expect(Object.keys(asRecord(first.itemStyle))).not.toContain('color')
  })
})

describe('堆叠', () => {
  it('实时档所有柱共用一个堆位，否则每根柱缩到 1/N 宽还偏在自己那一格里', () => {
    const option = optionOf(BASE_CONFIG, liveView(BASE_CONFIG, [1, 2]))

    expect(seriesAt(option, 0).stack).toBe(seriesAt(option, 1).stack)
    expect(typeof seriesAt(option, 0).stack).toBe('string')
  })

  it('历史并排档只有写了分组名的那几行才堆，留空的不写这个键', () => {
    const config = {
      [BAR_ITEMS_KEY]: [{ name: '甲', stack: 'A' }, { name: '乙' }],
      valueSource: 'history',
    }
    const view = historyView(config, [[{ t: BASE, v: 1 }], [{ t: BASE, v: 2 }]])
    const option = optionOf(config, view)

    expect(seriesAt(option, 0).stack).toBe('A')
    expect(Object.keys(seriesAt(option, 1))).not.toContain('stack')
  })

  it('堆叠档里没写分组名的那几行落到同一个默认堆位上', () => {
    const config = {
      [BAR_ITEMS_KEY]: [{ name: '甲' }, { name: '乙' }],
      chartStyle: 'stacked',
      valueSource: 'history',
    }
    const view = historyView(config, [[{ t: BASE, v: 1 }], [{ t: BASE, v: 2 }]])
    const option = optionOf(config, view)

    expect(seriesAt(option, 0).stack).toBe(seriesAt(option, 1).stack)
  })

  it('折线行永远不堆：把达标率加到产量上去，那条线不对应任何真实的量', () => {
    const config = {
      [BAR_ITEMS_KEY]: [
        { name: '产量', stack: 'A' },
        { name: '达标率', stack: 'A', plot: 'line' },
      ],
      chartStyle: 'stacked',
      valueSource: 'history',
    }
    const view = historyView(config, [[{ t: BASE, v: 1 }], [{ t: BASE, v: 2 }]])
    const option = optionOf(config, view)

    expect(seriesAt(option, 0).stack).toBe('A')
    expect(seriesAt(option, 1).type).toBe('line')
    expect(Object.keys(seriesAt(option, 1))).not.toContain('stack')
  })
})

describe('双轴', () => {
  it('一行都没挂右轴时只出一条值轴', () => {
    const option = optionOf(BASE_CONFIG, liveView(BASE_CONFIG, [1]))

    expect(asArray(option.yAxis)).toHaveLength(1)
    expect(seriesAt(option, 0).yAxisIndex).toBe(0)
  })

  it('有一行挂右轴就多出第二条值轴，且第二条不再画分隔线', () => {
    const config = {
      [BAR_ITEMS_KEY]: [
        { name: '产量' },
        { name: '达标率', axis: 'right', plot: 'line' },
      ],
    }
    const option = optionOf(config, liveView(config, [1, 2]))

    expect(asArray(option.yAxis)).toHaveLength(2)
    expect(seriesAt(option, 1).yAxisIndex).toBe(1)
    expect(asRecord(asRecord(asArray(option.yAxis)[1]).splitLine).show).toBe(
      false,
    )
  })
})

describe('百分比档', () => {
  it('画的是取值层算好的占比，值轴量程钉死 0–100', () => {
    const config = { ...BASE_CONFIG, chartStyle: 'percent' }
    const view = historyView(config, [
      [{ t: BASE, v: 30 }],
      [{ t: BASE, v: 10 }],
    ])
    const option = optionOf(config, view)

    expect(seriesAt(option, 0).data).toEqual([75])
    expect(seriesAt(option, 1).data).toEqual([25])
    expect(asRecord(asArray(option.yAxis)[0]).min).toBe(0)
    expect(asRecord(asArray(option.yAxis)[0]).max).toBe(100)
  })

  it('一整列全缺时那一列留空，而不是一排 0%', () => {
    const config = { ...BASE_CONFIG, chartStyle: 'percent' }
    const view = historyView(config, [
      [
        { t: BASE, v: 30 },
        { t: BASE + HOUR, v: null },
      ],
      [
        { t: BASE, v: 10 },
        { t: BASE + HOUR, v: null },
      ],
    ])
    const option = optionOf(config, view)

    expect(seriesAt(option, 0).data).toEqual([75, null])
  })

  it('不画参考线：阈值写的是原始单位，摆在占比轴上落在一个与谁都无关的高度', () => {
    const config = {
      ...BASE_CONFIG,
      chartStyle: 'percent',
      refLines: [{ value: 500, label: '目标' }],
    }
    const option = optionOf(config, liveView(config, [30, 10]))

    expect(Object.keys(seriesAt(option, 0))).not.toContain('markLine')
  })

  it('图例不许点：点掉一条剩下的加起来不再是 100%，而屏上的数字一个都没变', () => {
    const config = {
      ...BASE_CONFIG,
      chartStyle: 'percent',
      showLegend: true,
    }
    const option = optionOf(config, liveView(config, [30, 10]))

    expect(asRecord(option.legend).selectedMode).toBe(false)
  })

  it('别的档图例照常可点，不写这个键', () => {
    const config = { ...BASE_CONFIG, showLegend: true }
    const option = optionOf(config, liveView(config, [30, 10]))

    expect(Object.keys(asRecord(option.legend))).not.toContain('selectedMode')
  })
})

describe('正负对称档', () => {
  it('量程按最大绝对值向两侧铺开，负值照实向下画', () => {
    const config = { ...BASE_CONFIG, chartStyle: 'diverging' }
    const view = liveView(config, [-40, 120])
    const option = optionOf(config, view)
    const axis = asRecord(asArray(option.yAxis)[0])

    expect(symmetricBound(view)).toBe(120)
    expect(axis.min).toBe(-120)
    expect(axis.max).toBe(120)
    expect(seriesAt(option, 0).data).toEqual([
      { value: -40, label: { position: 'bottom' } },
      null,
    ])
  })

  it('一格读数都没有时不写量程，免得钉死一个 0 到 0 的轴', () => {
    const config = { ...BASE_CONFIG, chartStyle: 'diverging' }
    const view = liveView(config, [1], ['error'])

    expect(symmetricBound(view)).toBeUndefined()
    expect(
      Object.keys(asRecord(asArray(optionOf(config, view).yAxis)[0])),
    ).toContain('min')
  })
})

describe('横向条形档', () => {
  it('类目轴转到 Y 并反序，值轴转到 X', () => {
    const config = { ...BASE_CONFIG, chartStyle: 'horizontal' }
    const option = optionOf(config, liveView(config, [30, 10]))
    const category = asRecord(asArray(option.yAxis)[0])

    expect(category.type).toBe('category')
    expect(category.inverse).toBe(true)
    expect(asRecord(asArray(option.xAxis)[0]).type).toBe('value')
    expect(seriesAt(option, 0).xAxisIndex).toBe(0)
  })

  it('参考线绑到值那一根轴上，绑错就横竖倒置', () => {
    const refs = [{ value: 50, label: '目标' }]
    const upright = optionOf(
      { ...BASE_CONFIG, refLines: refs },
      liveView(BASE_CONFIG, [30]),
    )
    const sideways = optionOf(
      { ...BASE_CONFIG, chartStyle: 'horizontal', refLines: refs },
      liveView(BASE_CONFIG, [30]),
    )
    const first = (option: Record<string, unknown>): Record<string, unknown> =>
      asRecord(asArray(asRecord(seriesAt(option, 0).markLine).data)[0])

    expect(Object.keys(first(upright))).toContain('yAxis')
    expect(Object.keys(first(sideways))).toContain('xAxis')
  })

  it('负值的标签翻到条的左边，不压在 0 线右侧', () => {
    const config = { ...BASE_CONFIG, chartStyle: 'horizontal' }
    const option = optionOf(config, liveView(config, [-40]))

    expect(asArray(seriesAt(option, 0).data)[0]).toEqual({
      value: -40,
      label: { position: 'left' },
    })
  })
})

describe('参考线', () => {
  it('只挂在一条系列上，优先挑左轴的那一条', () => {
    const config = {
      [BAR_ITEMS_KEY]: [{ name: '达标率', axis: 'right' }, { name: '产量' }],
      refLines: [{ value: 50 }],
    }
    const view = liveView(config, [30, 10])
    const option = optionOf(config, view)

    expect(refHostIndex(view)).toBe(1)
    expect(Object.keys(seriesAt(option, 0))).not.toContain('markLine')
    expect(Object.keys(seriesAt(option, 1))).toContain('markLine')
  })

  it('一条都画不出来时谁也不挂，不给一条空系列硬塞参考线', () => {
    const config = { ...BASE_CONFIG, refLines: [{ value: 50 }] }
    const view = liveView(config, [1], ['error'])

    expect(refHostIndex(view)).toBe(-1)
    expect(Object.keys(seriesAt(optionOf(config, view), 0))).not.toContain(
      'markLine',
    )
  })

  it('参考值填不出数的那几行整行跳过，不画一条落在 0 上的线', () => {
    const config = {
      ...BASE_CONFIG,
      refLines: [{ label: '没填值' }, { value: '80', color: 'var(--brand)' }],
    }
    const option = optionOf(config, liveView(config, [30]))
    const data = asArray(asRecord(seriesAt(option, 0).markLine).data)

    expect(data).toHaveLength(1)
    expect(asRecord(data[0]).yAxis).toBe(80)
  })

  it('参考线的颜色也过一遍解析：线与文字都不许把变量名交给 canvas', () => {
    const config = {
      ...BASE_CONFIG,
      refLines: [{ value: 80, label: '目标', color: 'var(--brand)' }],
    }
    const item = asRecord(
      asArray(
        asRecord(seriesAt(optionOf(config, liveView(config, [30])), 0).markLine)
          .data,
      )[0],
    )

    expect(asRecord(item.lineStyle).color).toBe('tone-brand')
    expect(asRecord(item.label).color).toBe('tone-brand')
  })

  it('一条参考线都没配时不写 markLine 这个键', () => {
    const option = optionOf(BASE_CONFIG, liveView(BASE_CONFIG, [30]))

    expect(Object.keys(seriesAt(option, 0))).not.toContain('markLine')
  })
})

describe('两处相反的转义口径', () => {
  it('柱面标签走 canvas，原样写读数；关掉标签时只留一个 show:false', () => {
    const config = { ...BASE_CONFIG, showValueLabel: true }
    const option = optionOf(config, liveView(config, [30]))
    const label = asRecord(seriesAt(option, 0).label)

    expect(call(label.formatter, { value: 30 })).toBe('30t')
    expect(call(label.formatter, { value: null })).toBe('')

    const off = optionOf(
      { ...config, showValueLabel: false },
      liveView(config, [30]),
    )

    expect(asRecord(seriesAt(off, 0).label)).toEqual({ show: false })
  })

  it('标签色写 var(--x) 时解析成实际色值：canvas 不认变量名，原样丢进去静默丢色', () => {
    const config = { ...BASE_CONFIG, labelColor: 'var(--brand)' }
    const label = asRecord(
      seriesAt(optionOf(config, liveView(config, [30])), 0).label,
    )

    expect(label.color).toBe('tone-brand')
  })

  it('取不到那个变量时退回主题弱化色，不把「var(--x)」原样交给 canvas', () => {
    const config = { ...BASE_CONFIG, labelColor: 'var(--nope)' }
    const label = asRecord(
      seriesAt(optionOf(config, liveView(config, [30])), 0).label,
    )

    expect(label.color).toBe('tone-muted')
  })

  it('百分比档的标签写的是百分号，不是原始读数', () => {
    const config = {
      ...BASE_CONFIG,
      chartStyle: 'percent',
      showValueLabel: true,
    }
    const option = optionOf(config, liveView(config, [30, 10]))

    expect(
      call(asRecord(seriesAt(option, 0).label).formatter, { value: 75 }),
    ).toBe('75%')
  })

  it('提示框的返回值被原样 innerHTML，名字与单位逐段转义', () => {
    const config = {
      [BAR_ITEMS_KEY]: [{ name: '<b>甲', unit: ' & 备用' }],
      precision: 0,
    }
    const option = optionOf(config, liveView(config, [12]))

    expect(
      call(asRecord(option.tooltip).formatter, [
        { seriesIndex: 0, dataIndex: 0, axisValueLabel: '<i>09:00' },
      ]),
    ).toBe('&lt;i&gt;09:00<br/>&lt;b&gt;甲 12 &amp; 备用')
  })

  it('提示框把没读数的那一格写成「—」，不留一行空白', () => {
    const view = liveView(BASE_CONFIG, [30, 10])
    const option = optionOf(BASE_CONFIG, view)

    expect(
      call(asRecord(option.tooltip).formatter, [
        { seriesIndex: 0, dataIndex: 1, axisValueLabel: '2# 线' },
      ]),
    ).toBe('2# 线<br/>1# 线 —')
  })

  it('百分比档的提示框同时给原值与占比', () => {
    const config = { ...BASE_CONFIG, chartStyle: 'percent' }
    const option = optionOf(config, liveView(config, [30, 10]))

    expect(
      call(asRecord(option.tooltip).formatter, [
        { seriesIndex: 0, dataIndex: 0, axisValueLabel: '' },
      ]),
    ).toBe('1# 线 30t · 75%')
  })

  it('认不出的那一条参数整条跳过；一条都认不出就给空串', () => {
    const option = optionOf(BASE_CONFIG, liveView(BASE_CONFIG, [30]))

    expect(call(asRecord(option.tooltip).formatter, [{ seriesIndex: 9 }])).toBe(
      '',
    )
    expect(call(asRecord(option.tooltip).formatter, 'nope')).toBe('')
  })

  it('关掉提示框就只留一个 show:false，不留半份样式', () => {
    expect(
      optionOf(
        { ...BASE_CONFIG, showTooltip: false },
        liveView(BASE_CONFIG, [1]),
      ).tooltip,
    ).toEqual({ show: false })
  })
})

describe('柱体外观', () => {
  it('柱宽留空时不写这个键，填了钳到区间里', () => {
    const bare = optionOf(BASE_CONFIG, liveView(BASE_CONFIG, [1]))
    const wide = optionOf(
      { ...BASE_CONFIG, barWidth: 9_999 },
      liveView(BASE_CONFIG, [1]),
    )

    expect(Object.keys(seriesAt(bare, 0))).not.toContain('barMaxWidth')
    expect(seriesAt(wide, 0).barMaxWidth).toBe(200)
  })

  it('开了渐变：竖柱透的那一头在上，横条透的那一头在右', () => {
    const hexed = { [BAR_ITEMS_KEY]: [{ name: '甲', color: '#3366cc' }] }
    const config = { ...hexed, barGradient: true, barTopAlpha: 0.4 }
    const fill = (extra: Record<string, unknown>): Record<string, unknown> =>
      asRecord(
        asRecord(
          seriesAt(optionOf({ ...config, ...extra }, liveView(config, [1])), 0)
            .itemStyle,
        ).color,
      )
    const upright = fill({})
    const sideways = fill({ chartStyle: 'horizontal' })

    expect(upright.y2).toBe(1)
    expect(
      asArray(upright.colorStops).map((stop) => asRecord(stop).color),
    ).toEqual(['rgba(51, 102, 204, 0.4)', '#3366cc'])
    expect(sideways.x2).toBe(1)
    expect(
      asArray(sideways.colorStops).map((stop) => asRecord(stop).color),
    ).toEqual(['#3366cc', 'rgba(51, 102, 204, 0.4)'])
  })

  it('主色解析不出透明度时退回纯色，不画一块两端同色的假渐变', () => {
    const config = { ...BASE_CONFIG, barGradient: true }
    const option = optionOf(config, liveView(config, [1]))

    expect(asRecord(seriesAt(option, 0).itemStyle).color).toBe('tone-a')
  })

  it('填了渐变末端色就用它，不再从主色派生', () => {
    const config = {
      ...BASE_CONFIG,
      barGradient: true,
      barGradientTo: 'var(--brand)',
    }
    const fill = asRecord(
      asRecord(seriesAt(optionOf(config, liveView(config, [1])), 0).itemStyle)
        .color,
    )

    expect(
      asArray(fill.colorStops).map((stop) => asRecord(stop).color),
    ).toEqual(['tone-brand', 'tone-a'])
  })

  it('关着渐变时填充就是那一个色串，不套一层渐变对象', () => {
    const option = optionOf(BASE_CONFIG, liveView(BASE_CONFIG, [1]))

    expect(asRecord(seriesAt(option, 0).itemStyle).color).toBe('tone-a')
  })

  it('折线行不吃柱体那一套：只给线色与点色，不写圆角', () => {
    const config = { [BAR_ITEMS_KEY]: [{ name: '达标率', plot: 'line' }] }
    const option = optionOf(config, liveView(config, [1]))

    expect(seriesAt(option, 0).type).toBe('line')
    expect(asRecord(seriesAt(option, 0).lineStyle).color).toBe('tone-a')
    expect(Object.keys(asRecord(seriesAt(option, 0).itemStyle))).toEqual([
      'color',
    ])
  })
})

describe('轴与缩放', () => {
  it('类目标签间隔留空自动、填 0 全显、填 n 每隔 n 个', () => {
    const auto = optionOf(BASE_CONFIG, liveView(BASE_CONFIG, [1]))
    const all = optionOf(
      { ...BASE_CONFIG, xLabelInterval: '0' },
      liveView(BASE_CONFIG, [1]),
    )
    const every = optionOf(
      { ...BASE_CONFIG, xLabelInterval: '3' },
      liveView(BASE_CONFIG, [1]),
    )
    const at = (option: Record<string, unknown>): unknown =>
      asRecord(asRecord(asArray(option.xAxis)[0]).axisLabel).interval

    expect(at(auto)).toBe('auto')
    expect(at(all)).toBe(0)
    expect(at(every)).toBe(3)
  })

  it('轴名跟着几何走：横向档 X 是值轴、Y 是类目轴', () => {
    const config = { ...BASE_CONFIG, xAxisName: '时间', yAxisName: '产量' }
    const upright = optionOf(config, liveView(config, [1]))
    const sideways = optionOf(
      { ...config, chartStyle: 'horizontal' },
      liveView(config, [1]),
    )

    expect(asRecord(asArray(upright.xAxis)[0]).name).toBe('时间')
    expect(asRecord(asArray(upright.yAxis)[0]).name).toBe('产量')
    expect(asRecord(asArray(sideways.yAxis)[0]).name).toBe('产量')
    expect(asRecord(asArray(sideways.xAxis)[0]).name).toBe('时间')
  })

  it('值轴刻度只用整块那一份口径，不带任何一行自己的单位', () => {
    const config = {
      [BAR_ITEMS_KEY]: [{ name: '甲', unit: 't' }],
      unit: 'kW',
      precision: 0,
    }
    const option = optionOf(config, liveView(config, [1]))

    expect(
      call(
        asRecord(asRecord(asArray(option.yAxis)[0]).axisLabel).formatter,
        12.6,
      ),
    ).toBe('13kW')
  })

  it('百分比档的值轴刻度写百分号，不带整块那一档的单位', () => {
    const config = { ...BASE_CONFIG, chartStyle: 'percent', unit: 'kW' }
    const option = optionOf(config, liveView(config, [30, 10]))

    expect(
      call(
        asRecord(asRecord(asArray(option.yAxis)[0]).axisLabel).formatter,
        25,
      ),
    ).toBe('25%')
  })

  it('开了缩放条才写 dataZoom，横向档滑块跟着转成竖的', () => {
    const bare = optionOf(BASE_CONFIG, liveView(BASE_CONFIG, [1]))
    const zoomed = optionOf(
      { ...BASE_CONFIG, showDataZoom: true },
      liveView(BASE_CONFIG, [1]),
    )
    const sideways = optionOf(
      { ...BASE_CONFIG, showDataZoom: true, chartStyle: 'horizontal' },
      liveView(BASE_CONFIG, [1]),
    )

    expect(Object.keys(bare)).not.toContain('dataZoom')
    expect(asRecord(asArray(zoomed.dataZoom)[0]).orient).toBe('horizontal')
    expect(asRecord(asArray(sideways.dataZoom)[0]).orient).toBe('vertical')
  })

  it('滑块摞在图例之上，绘图区把两条带子一起让开', () => {
    // ⚠ 落位钉的是共用那一份：图例与滑块都锚在画布底，各让各的会让选窗条横穿
    //   图例的字（那一条由 tests/shared/chart/bottomBandSsr.spec.ts 真渲染量着）
    const band = bottomBand({ legend: true, legendFontSize: 11 })
    const config = { ...BASE_CONFIG, showDataZoom: true }
    const option = optionOf(config, liveView(config, [1]))

    expect(asRecord(asArray(option.dataZoom)[0]).bottom).toBe(band.zoom)
    expect(asRecord(option.grid).bottom).toBe(band.grid)
    expect(band.zoom).toBeGreaterThan(4)
  })

  it('图例字号调大时滑块跟着往上让，写死一个常量会被图例顶穿', () => {
    const base = { ...BASE_CONFIG, showDataZoom: true }
    const small = optionOf(base, liveView(base, [1]))
    const large = optionOf({ ...base, legendFontSize: 28 }, liveView(base, [1]))

    expect(Number(asRecord(asArray(large.dataZoom)[0]).bottom)).toBeGreaterThan(
      Number(asRecord(asArray(small.dataZoom)[0]).bottom),
    )
  })

  it('关掉图例时滑块回到贴底，绘图区少让一条带子', () => {
    const config = { ...BASE_CONFIG, showDataZoom: true, showLegend: false }
    const option = optionOf(config, liveView(config, [1]))

    expect(asRecord(asArray(option.dataZoom)[0]).bottom).toBe(4)
    expect(asRecord(option.grid).bottom).toBe(34)
  })

  it('横向档让开的是右边那一条：滑块竖在右侧，值轴刻度与柱面读数都在那儿', () => {
    const config = {
      ...BASE_CONFIG,
      showDataZoom: true,
      chartStyle: 'horizontal',
    }
    const grid = asRecord(optionOf(config, liveView(config, [1])).grid)

    const slider = asRecord(
      asArray(optionOf(config, liveView(config, [1])).dataZoom)[0],
    )

    expect(grid.right).toBe(34)
    // 竖滑块一点都不占底下那条带子：多让的话图白白被压扁一截
    expect(grid.bottom).toBe(26)
    expect(Object.keys(slider)).not.toContain('bottom')
  })
})

describe('点一根柱上抛的值', () => {
  it('上抛配置里写的名称，不是带去重后缀的图例名', () => {
    const config = { [BAR_ITEMS_KEY]: [{ name: '甲' }, { name: '甲' }, {}] }
    const view = liveView(config, [1, 2, 3])

    expect(view.series[1]?.legendName).toBe('甲#1')
    expect(pickedBarValue(view, { seriesIndex: 1 })).toBe('甲')
  })

  it('没起名的那几行点了不上抛，也不上抛一个「第 N 行」', () => {
    const config = { [BAR_ITEMS_KEY]: [{}] }
    const view = liveView(config, [1])

    expect(pickedBarValue(view, { seriesIndex: 0 })).toBe('')
    expect(pickedBarValue(view, { seriesIndex: 9 })).toBe('')
  })
})

describe('整块的顶层键', () => {
  it('背景透明、动画缺省关着，色板可被自定义色板整片顶掉', () => {
    const config = { ...BASE_CONFIG, palette: [{ color: 'var(--brand)' }] }
    const option = optionOf(config, liveView(config, [1, 2]))

    expect(option.backgroundColor).toBe('transparent')
    expect(option.animation).toBe(false)
    expect(asRecord(seriesAt(option, 0).itemStyle).color).toBe('tone-brand')
    expect(asRecord(seriesAt(option, 1).itemStyle).color).toBe('tone-brand')
  })

  it('开了动画就把时长一起带上', () => {
    const option = optionOf(
      { ...BASE_CONFIG, animation: true, animationDuration: 300 },
      liveView(BASE_CONFIG, [1]),
    )

    expect(option.animation).toBe(true)
    expect(option.animationDuration).toBe(300)
  })

  it('关掉图例只留 show:false，且圆心区不再给它让位', () => {
    const option = optionOf(
      { ...BASE_CONFIG, showLegend: false },
      liveView(BASE_CONFIG, [1]),
    )

    expect(option.legend).toEqual({ show: false })
    expect(asRecord(option.grid).bottom).toBe(6)
  })
})
