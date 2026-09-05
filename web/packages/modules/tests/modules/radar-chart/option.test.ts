/**
 * @fileoverview 守多维雷达 option 的形状：画不出来的轴整根不进 indicator、改由一条
 * 空 series 在图例上占名（图例只认 series 名，这是它唯一的承载面）、两组共用同一套
 * 逐轴量程、超出量程的读数几何上夹回去而文案照说原值、不足三根轴时连轮子带 series
 * 一起不写，以及提示框转义与顶点标签不转义这一对相反的口径。
 *
 * ⚠ 顶层 option 键拼错 typecheck 全绿、运行时静默无效，只能靠这里断言形状。
 * ⚠ 这一份断言的是 option 对象；「这份合法的 option 交给真 echarts 之后画不画得出来」
 * 由 ssr.test.ts 那条兜。
 */
import { describe, expect, it } from 'vitest'

import type { ModuleSlotMeta } from '@dt/contracts'

import {
  AXIS_ITEMS_KEY,
  AXIS_NOTES,
  axisFieldKey,
  buildAxisViews,
  COMPARE_NOTES,
  type AxisView,
} from '../../../src/modules/radar-chart/axes'
import {
  buildGroups,
  buildRadarOption,
  pickedGroupValue,
} from '../../../src/modules/radar-chart/option'
import {
  PERCENT_FULL,
  RADAR_AREA_OPACITY_MAX,
  RADAR_SPLIT_MAX,
  RADAR_SPLIT_MIN,
} from '../../../src/modules/radar-chart/options'
import type { ChartTheme } from '../../../src/shared/chart/theme'

const THEME: ChartTheme = {
  palette: ['tone-a', 'tone-b', 'tone-c'],
  text: 'tone-text',
  textMuted: 'tone-muted',
  axisLine: 'tone-axis',
  splitLine: '#204060',
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

type State = 'ok' | 'pending' | 'error'

const FOUR = [
  { name: '能效', min: 0, max: 100, unit: '分' },
  { name: '达标率', min: 0, max: 100, unit: '分' },
  { name: '健康度', min: 0, max: 100, unit: '分' },
  { name: '清洁度', min: 0, max: 100, unit: '分' },
]

const BASE = { [AXIS_ITEMS_KEY]: FOUR, precision: 0 }

function viewsOf(
  config: Record<string, unknown>,
  own: readonly unknown[],
  opts: {
    compare?: readonly unknown[]
    states?: readonly State[]
    compareStates?: readonly State[]
  } = {},
): AxisView[] {
  const slots: Record<string, ModuleSlotMeta> = {}
  own.forEach((_, index) => {
    slots[axisFieldKey(index, 'value')] = {
      state: opts.states?.[index] ?? 'ok',
    }
  })
  opts.compare?.forEach((_, index) => {
    slots[axisFieldKey(index, 'compare')] = {
      state: opts.compareStates?.[index] ?? 'ok',
    }
  })
  return buildAxisViews({
    config,
    rows: own.map((value, index) => ({
      value,
      compare: opts.compare?.[index],
    })),
    slots,
  })
}

function optionOf(
  config: Record<string, unknown>,
  views: readonly AxisView[],
): Record<string, unknown> {
  return asRecord(buildRadarOption(config, views, THEME, resolve))
}

function radarOf(option: Record<string, unknown>): Record<string, unknown> {
  return asRecord(option.radar)
}

function seriesOf(option: Record<string, unknown>): Record<string, unknown>[] {
  return asArray(option.series).map((item) => asRecord(item))
}

function namesOf(option: Record<string, unknown>): unknown[] {
  return seriesOf(option).map((item) => item.name)
}

function firstValue(series: Record<string, unknown>): unknown {
  return asRecord(asArray(series.data)[0]).value
}

describe('画得出来的轴才进轮子', () => {
  it('四根轴全好时逐轴量程原样进 indicator', () => {
    const option = optionOf(BASE, viewsOf(BASE, [80, 90, 70, 60]))

    expect(asArray(radarOf(option).indicator)).toEqual([
      { name: '能效', min: 0, max: 100 },
      { name: '达标率', min: 0, max: 100 },
      { name: '健康度', min: 0, max: 100 },
      { name: '清洁度', min: 0, max: 100 },
    ])
  })

  it('取不到的那根轴整根不进 indicator，形状少一个顶点而不是塌到圆心', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      states: ['ok', 'error', 'ok', 'ok'],
    })
    const option = optionOf(BASE, views)

    expect(
      asArray(radarOf(option).indicator).map((item) => asRecord(item).name),
    ).toEqual(['能效', '健康度', '清洁度'])
    expect(firstValue(seriesOf(option)[0] ?? {})).toEqual([80, 70, 60])
  })

  it('量程配错的那根轴同样整根不进，读数没有被夹成 0', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 0, max: 100 },
        { name: '达标率', min: 0, max: 100 },
        { name: '健康度', min: 0, max: 100 },
        { name: '清洁度', min: 100, max: 0 },
      ],
    }
    const option = optionOf(config, viewsOf(config, [80, 90, 70, 60]))

    expect(asArray(radarOf(option).indicator).length).toBe(3)
    expect(firstValue(seriesOf(option)[0] ?? {})).toEqual([80, 90, 70])
  })

  it('轮子上的轴名不带后缀：带后缀的那几根根本不在轮子上', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      states: ['ok', 'error', 'ok', 'ok'],
    })
    const names = asArray(radarOf(optionOf(BASE, views)).indicator).map(
      (item) => asRecord(item).name,
    )

    expect(names).not.toContain(`达标率（${AXIS_NOTES.error}）`)
  })

  it('画得出来的轴不足三根时连轮子带 series 一起不写', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 0, max: 100 },
        { name: '达标率', min: 0, max: 100 },
      ],
    }
    const option = optionOf(config, viewsOf(config, [80, 90]))

    expect(Object.keys(option)).not.toContain('radar')
    expect(Object.keys(option)).not.toContain('series')
    expect(Object.keys(option)).not.toContain('legend')
    expect(option.backgroundColor).toBe('transparent')
  })

  it('网格环数被夹进可配区间，手编的配置绕不过去', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60])

    expect(
      radarOf(optionOf({ ...BASE, splitCount: 99 }, views)).splitNumber,
    ).toBe(RADAR_SPLIT_MAX)
    expect(
      radarOf(optionOf({ ...BASE, splitCount: -5 }, views)).splitNumber,
    ).toBe(RADAR_SPLIT_MIN)
  })

  it('网格形状取自取值表，不在名单里的回落多边形', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60])

    expect(radarOf(optionOf({ ...BASE, shape: 'circle' }, views)).shape).toBe(
      'circle',
    )
    expect(radarOf(optionOf({ ...BASE, shape: '菱形' }, views)).shape).toBe(
      'polygon',
    )
  })

  it('隔行底色一律关掉：两个半透明的形状叠上去谁压着谁就看不出来了', () => {
    const radar = radarOf(optionOf(BASE, viewsOf(BASE, [80, 90, 70, 60])))

    expect(asRecord(radar.splitArea).show).toBe(false)
  })

  it('开了图例时圆心上提，给底部那条图例让位', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60])

    expect(radarOf(optionOf(BASE, views)).center).toEqual(['50%', '46%'])
    expect(
      radarOf(optionOf({ ...BASE, showLegend: false }, views)).center,
    ).toEqual(['50%', '50%'])
  })
})

describe('两组共用一套量程', () => {
  it('对比组的坐标直接是原值，靠 indicator 归一而不是各归一各的', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: 'A', min: 0, max: 100 },
        { name: 'B', min: 0, max: 1000 },
        { name: 'C', min: 0, max: 10 },
      ],
    }
    const views = viewsOf(config, [50, 500, 5], { compare: [25, 250, 2.5] })
    const series = seriesOf(optionOf(config, views))

    expect(firstValue(series[0] ?? {})).toEqual([50, 500, 5])
    expect(firstValue(series[1] ?? {})).toEqual([25, 250, 2.5])
  })

  it('超出量程的读数几何上夹回轮子里，否则顶点会画到最外圈之外', () => {
    const config = { [AXIS_ITEMS_KEY]: FOUR }
    const views = viewsOf(config, [200, 90, -30, 60], {
      compare: [999, 1, 1, 1],
    })
    const series = seriesOf(optionOf(config, views))

    expect(firstValue(series[0] ?? {})).toEqual([100, 90, 0, 60])
    expect(firstValue(series[1] ?? {})).toEqual([100, 1, 1, 1])
  })

  it('夹的是几何不是数：提示框照说原值，「超了多少」这条信息不丢', () => {
    const views = viewsOf(BASE, [200, 90, 70, 60])
    const tooltip = asRecord(optionOf(BASE, views).tooltip)

    expect(call(tooltip.formatter, { seriesIndex: 0 })).toContain('200分')
  })
})

describe('图例是逐轴状态唯一的承载面', () => {
  it('每根画不出来的轴各占一条空 series，名字带上原因', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [...FOUR, { name: '稳定性', min: 0, max: 100 }],
    }
    const views = viewsOf(config, [80, 90, 70, 60, 50], {
      states: ['ok', 'error', 'pending', 'ok', 'ok'],
    })
    const option = optionOf(config, views)

    expect(namesOf(option)).toEqual([
      '本组',
      `达标率（${AXIS_NOTES.error}）`,
      `健康度（${AXIS_NOTES.pending}）`,
    ])
    expect(seriesOf(option)[1]?.data).toEqual([])
  })

  it('图例上每一个名字都有一条同名 series，否则那一条根本不会被创建', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      compare: [70, 88, 76, 61],
      states: ['ok', 'error', 'ok', 'ok'],
    })
    const option = optionOf(BASE, views)
    const names = namesOf(option)

    for (const item of asArray(asRecord(option.legend).data)) {
      expect(names).toContain(asRecord(item).name)
    }
  })

  it('画不出来的那几条图例文字与图元一起置灰', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      states: ['ok', 'error', 'ok', 'ok'],
    })
    const data = asArray(asRecord(optionOf(BASE, views).legend).data).map(
      (item) => asRecord(item),
    )

    expect(data.map((item) => asRecord(item.textStyle).color)).toEqual([
      'tone-text',
      'tone-muted',
    ])
    expect(data.map((item) => asRecord(item.itemStyle).color)).toEqual([
      'tone-a',
      'tone-muted',
    ])
  })

  it('图例不许点：一半条目背后是没有数据的空 series，点了什么都不会发生', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60])

    expect(asRecord(optionOf(BASE, views).legend).selectedMode).toBe(false)
  })

  it('缺省开着：关着的话画不出来的那几根轴在屏上一个字都没有', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60])

    expect(asRecord(optionOf(BASE, views).legend).show).toBeUndefined()
    expect(optionOf({ ...BASE, showLegend: false }, views).legend).toEqual({
      show: false,
    })
  })

  it('主题取不到弱化色时省掉那个键，不写空串——空串会被画成透明', () => {
    const bare: ChartTheme = { ...THEME, textMuted: '' }
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      states: ['ok', 'error', 'ok', 'ok'],
    })
    const legend = asRecord(
      asRecord(buildRadarOption(BASE, views, bare, resolve)).legend,
    )
    const noted = asRecord(asArray(legend.data)[1])

    expect(Object.keys(asRecord(noted.textStyle))).not.toContain('color')
    expect(Object.keys(asRecord(noted.itemStyle))).not.toContain('color')
  })
})

describe('对比组那一条', () => {
  it('一根轴都没绑对比来源时整条不进 option，图例也不列', () => {
    const option = optionOf(BASE, viewsOf(BASE, [80, 90, 70, 60]))

    expect(namesOf(option)).toEqual(['本组'])
  })

  it('画不全时只留一条带原因的空 series，一个顶点都不画', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      compare: [70, 88, 76, 61],
      compareStates: ['error', 'ok', 'ok', 'ok'],
    })
    const option = optionOf(BASE, views)

    expect(namesOf(option)).toEqual([
      '本组',
      `对比组（${COMPARE_NOTES.error}）`,
    ])
    expect(seriesOf(option)[1]?.data).toEqual([])
  })

  it('两组按色板前两位取色，与被剔掉的轴那一档灰分得开', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], { compare: [1, 2, 3, 4] })
    const series = seriesOf(optionOf(BASE, views))

    expect(series.map((item) => asRecord(item.lineStyle).color)).toEqual([
      'tone-a',
      'tone-b',
    ])
  })

  it('自定义色板整片顶掉主题色板', () => {
    const config = { ...BASE, palette: [{ color: 'var(--brand)' }] }
    const views = viewsOf(config, [80, 90, 70, 60])

    expect(
      asRecord(seriesOf(optionOf(config, views))[0]?.itemStyle).color,
    ).toBe('tone-brand')
  })
})

describe('两处相反的转义口径', () => {
  it('提示框的返回值被原样 innerHTML，轴名与单位逐段转义', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '<b>能效', min: 0, max: 100, unit: ' & 备用' },
        { name: '达标率', min: 0, max: 100 },
        { name: '健康度', min: 0, max: 100 },
      ],
      seriesName: '<i>本组',
      precision: 0,
    }
    const views = viewsOf(config, [80, 90, 70])
    const tooltip = asRecord(optionOf(config, views).tooltip)

    expect(call(tooltip.formatter, { seriesIndex: 0 })).toBe(
      '&lt;i&gt;本组<br/>&lt;b&gt;能效 80 &amp; 备用<br/>达标率 90<br/>健康度 70',
    )
  })

  it('没有数据的那几条不出提示框，越界的下标也不出', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      states: ['ok', 'error', 'ok', 'ok'],
    })
    const tooltip = asRecord(optionOf(BASE, views).tooltip)

    expect(call(tooltip.formatter, { seriesIndex: 1 })).toBe('')
    expect(call(tooltip.formatter, {})).toBe('')
  })

  it('关掉提示框就只留一个 show:false，不留半份样式', () => {
    expect(
      optionOf({ ...BASE, showTooltip: false }, viewsOf(BASE, [1, 2, 3]))
        .tooltip,
    ).toEqual({ show: false })
  })

  it('顶点标签走 canvas，原样写读数；按维度下标取，不许串到相邻那根轴上', () => {
    const config = { ...BASE, showValueLabel: true }
    const views = viewsOf(config, [80, 90, 70, 60], {
      states: ['ok', 'error', 'ok', 'ok'],
    })
    const label = asRecord(seriesOf(optionOf(config, views))[0]?.label)

    expect(call(label.formatter, { dimensionIndex: 0 })).toBe('80分')
    expect(call(label.formatter, { dimensionIndex: 1 })).toBe('70分')
    expect(call(label.formatter, { dimensionIndex: 9 })).toBe('')
  })

  it('空 series 那几条问哪一维都给空串，不去读别人的读数', () => {
    const config = { ...BASE, showValueLabel: true }
    const views = viewsOf(config, [80, 90, 70, 60], {
      states: ['ok', 'error', 'ok', 'ok'],
    })
    const label = asRecord(seriesOf(optionOf(config, views))[1]?.label)

    expect(call(label.formatter, { dimensionIndex: 0 })).toBe('')
  })

  it('缺省不画顶点标签：两组 × 六根轴就是十二个数糊在轮子上', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60])

    expect(asRecord(seriesOf(optionOf(BASE, views))[0]?.label).show).toBe(false)
  })
})

describe('描边与填充', () => {
  it('填充档铺一层面，浓度按百分比换算', () => {
    const config = { ...BASE, chartStyle: 'area', areaOpacity: 30 }
    const series = seriesOf(optionOf(config, viewsOf(config, [1, 2, 3])))

    expect(asRecord(series[0]?.areaStyle).opacity).toBe(0.3)
  })

  it('浓度被夹进可配区间：填满会让后画的那一组把先画的整个盖掉', () => {
    const config = { ...BASE, chartStyle: 'area', areaOpacity: 500 }
    const series = seriesOf(optionOf(config, viewsOf(config, [1, 2, 3])))

    expect(asRecord(series[0]?.areaStyle).opacity).toBe(
      RADAR_AREA_OPACITY_MAX / PERCENT_FULL,
    )
  })

  it('描边档不写 areaStyle 这个键', () => {
    const config = { ...BASE, chartStyle: 'line' }
    const series = seriesOf(optionOf(config, viewsOf(config, [1, 2, 3])))

    expect(Object.keys(series[0] ?? {})).not.toContain('areaStyle')
  })

  it('恒画顶点符号：雷达的数据标签挂在图元上，关掉符号标签会整片消失', () => {
    const config = { ...BASE, showValueLabel: true }
    const series = seriesOf(optionOf(config, viewsOf(config, [1, 2, 3])))

    expect(series.map((item) => item.symbol)).toEqual(['circle'])
  })
})

describe('点某一条上抛的值', () => {
  it('上抛这一组配置里写的称呼，不是带原因后缀的图例名', () => {
    const config = { ...BASE, seriesName: '本月', compareName: '去年同期' }
    const views = viewsOf(config, [80, 90, 70, 60], {
      compare: [70, 88, 76, 61],
      compareStates: ['error', 'ok', 'ok', 'ok'],
    })

    expect(pickedGroupValue(config, views, { seriesIndex: 0 })).toBe('本月')
    expect(pickedGroupValue(config, views, { seriesIndex: 1 })).toBe('去年同期')
  })

  it('被剔掉的那几根轴对应的空 series 点了不上抛：它们不是一组数据', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      states: ['ok', 'error', 'ok', 'ok'],
    })

    expect(pickedGroupValue(BASE, views, { seriesIndex: 1 })).toBe('')
    expect(pickedGroupValue(BASE, views, {})).toBe('')
  })

  it('上抛顺序与 option 里的 series 顺序逐位对齐', () => {
    const config = { ...BASE, seriesName: '本月', compareName: '去年同期' }
    const views = viewsOf(config, [80, 90, 70, 60], {
      compare: [70, 88, 76, 61],
      states: ['ok', 'ok', 'ok', 'error'],
    })
    const groups = buildGroups(
      views,
      { series: '本月', compare: '去年同期' },
      THEME.palette,
      THEME,
    )

    expect(
      groups.map((_, index) =>
        pickedGroupValue(config, views, { seriesIndex: index }),
      ),
    ).toEqual(groups.map((group) => group.emitValue))
  })
})

describe('整块的顶层键', () => {
  it('背景透明、动画缺省关着', () => {
    const option = optionOf(BASE, viewsOf(BASE, [80, 90, 70, 60]))

    expect(option.backgroundColor).toBe('transparent')
    expect(option.animation).toBe(false)
  })

  it('开了动画就把时长一起带上', () => {
    const option = optionOf(
      { ...BASE, animation: true, animationDuration: 300 },
      viewsOf(BASE, [80, 90, 70, 60]),
    )

    expect(option.animation).toBe(true)
    expect(option.animationDuration).toBe(300)
  })

  it('网格分隔线按主题色淡化，颜色不是硬编码的', () => {
    const radar = radarOf(optionOf(BASE, viewsOf(BASE, [80, 90, 70, 60])))
    const line = asRecord(asRecord(radar.splitLine).lineStyle)

    expect(String(line.color)).toContain('rgba(32, 64, 96')
    expect(asRecord(asRecord(radar.axisName)).color).toBe('tone-muted')
  })
})
