/**
 * @fileoverview 守构成环图的 option 形状：每一片都占着 data 的位置（没读数的给 null
 * 并置灰）、图例是逐片状态的唯一承载面且不许点、逐片固定色压过色板且按文档序取色、
 * 内半径不小于外半径时被压回去、环心读数三档各自的算法与「实心饼不写心」这条闸、
 * 点一片上抛的是配置里的名称，以及提示框转义与扇区标签不转义这一对相反的口径。
 *
 * ⚠ 顶层 option 键拼错 typecheck 全绿、运行时静默无效，只能靠这里断言形状。
 * ⚠ 图例条的名字在 `series.data` 里找不到时，echarts 连图元都不建、只在 dev 下打一句
 * warn——那一整档状态因此静默消失，所以两边的名字要逐条对上。
 * ⚠ 提示框的函数 formatter 返回值被 echarts 原样 innerHTML；扇区标签走 canvas，
 * 转义了只会把 `&` 显示成字面量。两处口径相反，各钉一条。
 */
import { describe, expect, it } from 'vitest'

import type { ChartTheme } from '../../../src/shared/chart/theme'
import {
  buildPieOption,
  pickedSliceValue,
} from '../../../src/modules/pie-chart/option'
import {
  PIE_CENTER_LABELS,
  PIE_MIN_RING,
} from '../../../src/modules/pie-chart/options'
import {
  buildSliceViews,
  SLICE_ITEMS_KEY,
  type SliceView,
} from '../../../src/modules/pie-chart/slices'

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
  { name: '光伏', unit: 'kWh' },
  { name: '市电', unit: 'kWh' },
  { name: '储能', unit: 'kWh' },
]

function viewsOf(
  config: Record<string, unknown>,
  numbers: readonly unknown[],
  states: readonly ('ok' | 'pending' | 'error')[] = [],
): SliceView[] {
  const slots: Record<string, { state: 'ok' | 'pending' | 'error' }> = {}
  numbers.forEach((_, index) => {
    slots[`sliceValues[${String(index)}].value`] = {
      state: states[index] ?? 'ok',
    }
  })
  return buildSliceViews({
    config,
    rows: numbers.map((value) => ({ value })),
    slots,
  })
}

function optionOf(
  config: Record<string, unknown>,
  views: readonly SliceView[],
): Record<string, unknown> {
  return asRecord(buildPieOption(config, views, THEME, resolve))
}

function seriesOf(option: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asArray(option.series)[0])
}

const BASE = { [SLICE_ITEMS_KEY]: THREE }

describe('扇区', () => {
  it('没读数的那几片也占着 data 的位置，值给 null 而不是被剔掉', () => {
    const views = viewsOf(BASE, [60, 20, 20], ['ok', 'pending', 'error'])
    const data = asArray(seriesOf(optionOf(BASE, views)).data)

    expect(data.map((item) => asRecord(item).name)).toEqual([
      '光伏',
      '市电（等首帧）',
      '储能（取不到）',
    ])
    expect(data.map((item) => asRecord(item).value)).toEqual([60, null, null])
  })

  it('图例上每一个名字都在 data 里找得到，否则那一条图例根本不会被创建', () => {
    const config = { ...BASE, showLegend: true }
    const views = viewsOf(config, [60, 20, 20], ['ok', 'pending', 'error'])
    const option = optionOf(config, views)
    const names = asArray(seriesOf(option).data).map(
      (item) => asRecord(item).name,
    )

    for (const item of asArray(asRecord(option.legend).data)) {
      expect(names).toContain(asRecord(item).name)
    }
  })

  it('没读数的那几片置灰、且逐项关掉标签与引线', () => {
    const views = viewsOf(BASE, [60, 20, 20], ['ok', 'error', 'ok'])
    const data = asArray(seriesOf(optionOf(BASE, views)).data).map((item) =>
      asRecord(item),
    )

    expect(asRecord(data[1]?.itemStyle).color).toBe('tone-muted')
    expect(asRecord(data[1]?.label).show).toBe(false)
    expect(asRecord(data[1]?.labelLine).show).toBe(false)
    expect(Object.keys(asRecord(data[0]))).not.toContain('label')
  })

  it('读数全是 0 时不等分圆：那是凭空造出来的「各占 1/N」', () => {
    expect(
      seriesOf(optionOf(BASE, viewsOf(BASE, [0, 0, 0]))).stillShowZeroSum,
    ).toBe(false)
  })

  it('逐片固定色压过色板，没填的按文档序取色板', () => {
    const config = {
      [SLICE_ITEMS_KEY]: [
        { name: '光伏' },
        { name: '市电', color: 'var(--brand)' },
        { name: '储能' },
      ],
    }
    const data = asArray(
      seriesOf(optionOf(config, viewsOf(config, [1, 2, 3]))).data,
    )

    expect(
      data.map((item) => asRecord(asRecord(item).itemStyle).color),
    ).toEqual(['tone-a', 'tone-brand', 'tone-c'])
  })

  it('前面一片断了，后面那几片的颜色不跟着挪一格', () => {
    const views = viewsOf(BASE, [1, 2, 3], ['error', 'ok', 'ok'])
    const data = asArray(seriesOf(optionOf(BASE, views)).data)

    expect(
      data.map((item) => asRecord(asRecord(item).itemStyle).color),
    ).toEqual(['tone-muted', 'tone-b', 'tone-c'])
  })

  it('实心饼从圆心起画，环形留出内半径', () => {
    const views = viewsOf(BASE, [1])

    expect(
      seriesOf(optionOf({ ...BASE, chartStyle: 'pie' }, views)).radius,
    ).toEqual(['0%', '66%'])
    expect(
      seriesOf(
        optionOf(
          { ...BASE, chartStyle: 'donut', innerRadius: 40, outerRadius: 70 },
          views,
        ),
      ).radius,
    ).toEqual(['40%', '70%'])
  })

  it('内半径不小于外半径时被压回去，环带因此不会宽度为 0', () => {
    const radius = seriesOf(
      optionOf(
        { ...BASE, chartStyle: 'donut', innerRadius: 90, outerRadius: 70 },
        viewsOf(BASE, [1]),
      ),
    ).radius

    expect(radius).toEqual([`${String(70 - PIE_MIN_RING)}%`, '70%'])
  })

  it('玫瑰档把占比也映射到半径，另外两档不写这个键', () => {
    const views = viewsOf(BASE, [1])

    expect(
      seriesOf(optionOf({ ...BASE, chartStyle: 'rose' }, views)).roseType,
    ).toBe('radius')
    expect(
      Object.keys(seriesOf(optionOf({ ...BASE, chartStyle: 'donut' }, views))),
    ).not.toContain('roseType')
  })

  it('关掉数值标签时引线也跟着不画', () => {
    const views = viewsOf(BASE, [1])
    const off = seriesOf(optionOf({ ...BASE, showValueLabel: false }, views))

    expect(asRecord(off.label).show).toBe(false)
    expect(asRecord(off.labelLine).show).toBe(false)
  })
})

describe('两处相反的转义口径', () => {
  it('扇区标签走 canvas，原样写名字与读数', () => {
    const config = { ...BASE, showValueLabel: true }
    const label = asRecord(
      seriesOf(optionOf(config, viewsOf(config, [75, 25]))).label,
    )

    expect(call(label.formatter, { dataIndex: 0 })).toBe('光伏\n75kWh · 75%')
    expect(call(label.formatter, { dataIndex: 9 })).toBe('')
  })

  it('提示框的返回值被原样 innerHTML，名字与单位逐段转义', () => {
    const config = { [SLICE_ITEMS_KEY]: [{ name: '<b>光伏', unit: ' & 备用' }] }
    const tooltip = asRecord(optionOf(config, viewsOf(config, [12])).tooltip)

    expect(call(tooltip.formatter, { dataIndex: 0 })).toBe(
      '&lt;b&gt;光伏<br/>12 &amp; 备用 · 100%',
    )
    expect(call(tooltip.formatter, {})).toBe('')
  })

  it('算不出占比时两处都只写读数，不挂一个空的百分号', () => {
    const config = { ...BASE, showValueLabel: true }
    const views = viewsOf(config, [0, 0])
    const option = optionOf(config, views)
    const label = asRecord(seriesOf(option).label)

    expect(call(label.formatter, { dataIndex: 0 })).toBe('光伏\n0kWh')
    expect(call(asRecord(option.tooltip).formatter, { dataIndex: 1 })).toBe(
      '市电<br/>0kWh',
    )
  })

  it('下标按文档序取：前面一片断了，标签不许串到相邻那一片上', () => {
    const config = { ...BASE, showValueLabel: true }
    const views = viewsOf(config, [10, 30, 70], ['error', 'ok', 'ok'])
    const option = optionOf(config, views)
    const label = asRecord(seriesOf(option).label)

    expect(call(label.formatter, { dataIndex: 1 })).toBe('市电\n30kWh · 30%')
    expect(call(label.formatter, { dataIndex: 0 })).toBe('')
    expect(call(asRecord(option.tooltip).formatter, { dataIndex: 0 })).toBe(
      '光伏（取不到）',
    )
  })

  it('关掉提示框就只留一个 show:false，不留半份样式', () => {
    expect(
      optionOf({ ...BASE, showTooltip: false }, viewsOf(BASE, [1])).tooltip,
    ).toEqual({ show: false })
  })
})

describe('图例是逐片状态的唯一承载面', () => {
  it('配了但没数的那几片仍列在图例上，取不到的那一条文字置灰', () => {
    const config = { ...BASE, showLegend: true }
    const views = viewsOf(config, [60, 20, 20], ['ok', 'pending', 'error'])
    const legend = asRecord(optionOf(config, views).legend)
    const data = asArray(legend.data).map((item) => asRecord(item))

    expect(data.map((item) => item.name)).toEqual([
      '光伏',
      '市电（等首帧）',
      '储能（取不到）',
    ])
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

  it('图例不许点：点掉一片会让圆心角重新归一，而占比是一次算死的', () => {
    const config = { ...BASE, showLegend: true }
    const legend = asRecord(optionOf(config, viewsOf(config, [60, 40])).legend)

    expect(legend.selectedMode).toBe(false)
  })

  it('主题取不到弱化色时省掉那个键，不写空串', () => {
    const config = { ...BASE, showLegend: true }
    const bare: ChartTheme = { ...THEME, textMuted: '' }
    const views = buildSliceViews({
      config,
      rows: [{ value: 1 }],
      slots: { 'sliceValues[0].value': { state: 'error' } },
    })
    const legend = asRecord(
      asRecord(buildPieOption(config, views, bare, resolve)).legend,
    )
    const first = asRecord(asArray(legend.data)[0])

    expect(Object.keys(asRecord(first.textStyle))).not.toContain('color')
    expect(Object.keys(asRecord(first.itemStyle))).not.toContain('color')
  })

  it('缺省开着：关着的话取不到的那几片在屏上一个字都没有', () => {
    const views = viewsOf(BASE, [1])

    expect(asRecord(optionOf(BASE, views).legend).show).toBeUndefined()
    expect(optionOf({ ...BASE, showLegend: false }, views).legend).toEqual({
      show: false,
    })
  })

  it('开了图例时圆心上提，给底部那条图例让位', () => {
    const views = viewsOf(BASE, [1])

    expect(seriesOf(optionOf(BASE, views)).center).toEqual(['50%', '45%'])
    expect(
      seriesOf(optionOf({ ...BASE, showLegend: false }, views)).center,
    ).toEqual(['50%', '50%'])
  })
})

describe('点一片上抛的值', () => {
  it('上抛配置里写的名称，不是带去重后缀的图例名', () => {
    const config = {
      [SLICE_ITEMS_KEY]: [{ name: '光伏' }, { name: '光伏' }, {}],
    }
    const views = viewsOf(config, [1, 2, 3])

    expect(views[1]?.legendName).toBe('光伏#1')
    expect(pickedSliceValue(views, { dataIndex: 1 })).toBe('光伏')
  })

  it('没起名的那几片点了不上抛，也不上抛一个「第 N 片」', () => {
    const config = { [SLICE_ITEMS_KEY]: [{}] }
    const views = viewsOf(config, [1])

    expect(pickedSliceValue(views, { dataIndex: 0 })).toBe('')
    expect(pickedSliceValue(views, { dataIndex: 9 })).toBe('')
  })
})

describe('环心读数', () => {
  it('缺省不画，也不留一个空标题占着圆心', () => {
    expect(Object.keys(optionOf(BASE, viewsOf(BASE, [1])))).not.toContain(
      'title',
    )
  })

  it('合计只加当前画得出来的那几片', () => {
    const config = {
      ...BASE,
      chartStyle: 'donut',
      centerText: 'sum',
      precision: 0,
    }
    const views = viewsOf(config, [60, 20, 20], ['ok', 'ok', 'error'])
    const title = asRecord(optionOf(config, views).title)

    expect(title.text).toBe('80')
    expect(title.subtext).toBe(PIE_CENTER_LABELS.sum)
  })

  it('最大片取的是读数不是占比，片数不带小数', () => {
    const shared = {
      ...BASE,
      chartStyle: 'donut',
      precision: 0,
      centerUnit: '',
    }
    const views = viewsOf(shared, [60, 25])

    expect(
      asRecord(optionOf({ ...shared, centerText: 'max' }, views).title).text,
    ).toBe('60')
    expect(
      asRecord(optionOf({ ...shared, centerText: 'count' }, views).title).text,
    ).toBe('2')
  })

  it('环心单位留空时合计跟随整块的单位', () => {
    const config = {
      ...BASE,
      chartStyle: 'donut',
      centerText: 'sum',
      unit: 'kWh',
      precision: 0,
    }

    expect(
      asRecord(optionOf(config, viewsOf(config, [60, 20])).title).text,
    ).toBe('80kWh')
    expect(
      asRecord(
        optionOf({ ...config, centerUnit: '台' }, viewsOf(config, [60, 20]))
          .title,
      ).text,
    ).toBe('80台')
  })

  it('实心饼没有心可写，配了也不画', () => {
    const config = { ...BASE, chartStyle: 'pie', centerText: 'sum' }

    expect(Object.keys(optionOf(config, viewsOf(config, [1])))).not.toContain(
      'title',
    )
  })

  it('一片都画不出来时不画环心，免得中间挂一个 0', () => {
    const config = { ...BASE, chartStyle: 'donut', centerText: 'sum' }
    const views = viewsOf(config, [1, 2, 3], ['error', 'error', 'pending'])

    expect(Object.keys(optionOf(config, views))).not.toContain('title')
  })

  it('环心那一段锚在圆心上，不随文字长度左右漂，也跟着圆心一起上提', () => {
    const config = { ...BASE, chartStyle: 'donut', centerText: 'count' }
    const title = asRecord(
      optionOf({ ...config, showLegend: false }, viewsOf(config, [1])).title,
    )

    expect(title.left).toBe('50%')
    expect(title.top).toBe('50%')
    expect(asRecord(optionOf(config, viewsOf(config, [1])).title).top).toBe(
      '45%',
    )
    expect(title.textAlign).toBe('center')
    expect(title.textVerticalAlign).toBe('middle')
  })
})

describe('整块的顶层键', () => {
  it('背景透明、动画缺省关着，色板可被自定义色板整片顶掉', () => {
    const config = {
      ...BASE,
      palette: [{ color: 'var(--brand)' }],
    }
    const option = optionOf(config, viewsOf(config, [1, 2]))
    const data = asArray(seriesOf(option).data)

    expect(option.backgroundColor).toBe('transparent')
    expect(option.animation).toBe(false)
    expect(
      data.map((item) => asRecord(asRecord(item).itemStyle).color),
    ).toEqual(['tone-brand', 'tone-brand'])
  })

  it('开了动画就把时长一起带上', () => {
    const option = optionOf(
      { ...BASE, animation: true, animationDuration: 300 },
      viewsOf(BASE, [1]),
    )

    expect(option.animation).toBe(true)
    expect(option.animationDuration).toBe(300)
  })
})
