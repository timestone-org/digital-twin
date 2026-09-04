/**
 * @fileoverview 守日历热力的 option 形状：几块上下均分且各带一条标题（逐张状态唯一的
 * 承载面）、取不到的那几张坐标照建而格子给空、色阶端点两个都留空时按数据自动定、
 * 一个色都派生不出时不写 `inRange`、日历与矩阵两条铺法各出各的坐标、提示框逐段转义
 * 而扇形以外的文字不转义，以及点一格上抛的是那张日历配置里的名称。
 *
 * ⚠ 顶层 option 键拼错 typecheck 全绿、运行时静默无效，只能靠这里断言形状。
 * ⚠ 标题上那几张「取不到」在真 echarts 里画不画得出来，靠 ssr.spec.ts 那条钉。
 */
import { describe, expect, it } from 'vitest'

import {
  buildMetricViews,
  METRIC_ITEMS_KEY,
  metricFieldKey,
  type MetricView,
} from '../../../src/modules/calendar-heat/days'
import {
  blocksOf,
  buildCalendarOption,
  pickedMetricValue,
  scaleOf,
  titleTextOf,
} from '../../../src/modules/calendar-heat/option'
import { CELL_GAP_MAX } from '../../../src/modules/calendar-heat/options'
import type { ChartTheme } from '../../../src/shared/chart/theme'

const THEME: ChartTheme = {
  palette: ['tone-a', 'tone-b', 'tone-c', 'tone-d', 'tone-e', 'tone-f'],
  text: 'tone-text',
  textMuted: 'tone-muted',
  axisLine: 'tone-axis',
  splitLine: 'tone-split',
  accent: 'tone-accent',
  idle: 'tone-idle',
  tooltipBg: 'tone-bg',
  tooltipBorder: 'tone-border',
}

const BARE_THEME: ChartTheme = {
  palette: [],
  text: '',
  textMuted: '',
  axisLine: '',
  splitLine: '',
  accent: '',
  idle: '',
  tooltipBg: '',
  tooltipBorder: '',
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

const TWO = {
  timezone: 'UTC',
  [METRIC_ITEMS_KEY]: [
    { name: '能耗', unit: 'kWh' },
    { name: '达标率', unit: '%' },
  ],
}

function pointsOf(...samples: readonly (readonly [number, number])[]) {
  return samples.map(([at, reading]) => ({ t: at, v: reading }))
}

/** 取第 index 张；取不到当场炸，免得断言在 undefined 上空转。 */
function viewAt(views: readonly MetricView[], index: number): MetricView {
  const view = views[index]
  if (view === undefined) throw new Error(`没有第 ${String(index)} 张`)
  return view
}

const MARCH_5 = Date.UTC(2026, 2, 5)
const MARCH_7 = Date.UTC(2026, 2, 7)
const APRIL_2 = Date.UTC(2026, 3, 2)

/** 第一张有两天读数，第二张按传进来的档走。 */
function viewsOf(
  config: Record<string, unknown> = TWO,
  second: 'ok' | 'pending' | 'error' = 'error',
): MetricView[] {
  return buildMetricViews({
    config,
    rows: [
      {
        series: 40,
        seriesPoints: pointsOf([MARCH_5, 10], [MARCH_7, 40]),
      },
      { series: 60, seriesPoints: pointsOf([APRIL_2, 60]) },
    ],
    slots: {
      [metricFieldKey(0)]: { state: 'ok' },
      [metricFieldKey(1)]: { state: second },
    },
  })
}

function optionOf(
  config: Record<string, unknown>,
  views: readonly MetricView[],
  theme: ChartTheme = THEME,
): Record<string, unknown> {
  return asRecord(buildCalendarOption(config, views, theme))
}

describe('几块的排版与标题', () => {
  it('几块上下均分，底下有色标时给色标留出位置', () => {
    const bare = blocksOf(2, false)
    const scaled = blocksOf(2, true)

    expect(bare).toHaveLength(2)
    expect(bare[0]?.top).toBe('9%')
    expect(scaled[1]?.top).not.toBe(bare[1]?.top)
  })

  it('挤到算出负高度时按下限收住，不让整块不画', () => {
    expect(blocksOf(9, true)[0]?.height).toBe('8%')
  })

  it('一块也没有时不除以 0', () => {
    expect(blocksOf(0, false)).toEqual([])
  })

  it('标题写名字与单位；取不到的那几张把原因缀在后面', () => {
    const views = viewsOf()

    expect(titleTextOf(viewAt(views, 0))).toBe('能耗 · kWh')
    expect(titleTextOf(viewAt(views, 1))).toContain('取不到')
  })

  it('没单位的那张标题上不挂一个空的分隔点', () => {
    const config = { timezone: 'UTC', [METRIC_ITEMS_KEY]: [{ name: '产量' }] }
    const views = buildMetricViews({
      config,
      rows: [{ series: 1, seriesPoints: pointsOf([MARCH_5, 1]) }],
      slots: { [metricFieldKey(0)]: { state: 'ok' } },
    })

    expect(titleTextOf(viewAt(views, 0))).toBe('产量')
  })

  it('逐张标题按块排下去，取不到的那条置灰', () => {
    const titles = asArray(optionOf(TWO, viewsOf()).title)

    expect(titles.map((item) => asRecord(item).text)).toEqual([
      '能耗 · kWh',
      '达标率 · %（取不到）',
    ])
    expect(
      titles.map((item) => asRecord(asRecord(item).textStyle).color),
    ).toEqual([THEME.text, THEME.textMuted])
  })
})

describe('色阶端点', () => {
  it('两个都留空时按取回的数据自动定', () => {
    expect(scaleOf({}, viewsOf())).toEqual({ min: 10, max: 40 })
  })

  it('两个都填了就照填的来，跟数据无关', () => {
    expect(scaleOf({ minValue: 0, maxValue: 100 }, viewsOf())).toEqual({
      min: 0,
      max: 100,
    })
  })

  it('填反了按小的那个当下限，不报错也不留空', () => {
    expect(scaleOf({ minValue: 100, maxValue: 0 }, [])).toEqual({
      min: 0,
      max: 100,
    })
  })

  it('只填一头时另一头按数据补', () => {
    expect(scaleOf({ minValue: 0 }, viewsOf())).toEqual({ min: 0, max: 40 })
    expect(scaleOf({ maxValue: 5 }, viewsOf())).toEqual({ min: 5, max: 10 })
  })

  it('一格都没有且没填死时给 null，交给上面决定不画色标', () => {
    expect(scaleOf({}, [])).toBeNull()
  })

  it('填了 0 与留空分得开', () => {
    expect(scaleOf({ minValue: 0, maxValue: 0 }, [])).toEqual({
      min: 0,
      max: 0,
    })
  })
})

describe('日历铺法', () => {
  it('每一张都有自己的日历坐标，跨度是各张的并集', () => {
    const option = optionOf(TWO, viewsOf(TWO, 'ok'))
    const calendars = asArray(option.calendar)

    expect(calendars).toHaveLength(2)
    expect(asRecord(calendars[0]).range).toEqual(['2026-03-05', '2026-04-02'])
    expect(asRecord(calendars[1]).range).toEqual(['2026-03-05', '2026-04-02'])
  })

  it('取不到的那张坐标照建、格子给空数组，屏上因此看得出位置', () => {
    const option = optionOf(TWO, viewsOf())
    const series = asArray(option.series)

    expect(asArray(option.calendar)).toHaveLength(2)
    expect(asArray(asRecord(series[0]).data)).toHaveLength(2)
    expect(asArray(asRecord(series[1]).data)).toEqual([])
  })

  it('格子挂在自己那块日历上，序号一一对应', () => {
    const series = asArray(optionOf(TWO, viewsOf()).series)

    expect(series.map((item) => asRecord(item).calendarIndex)).toEqual([0, 1])
    expect(series.map((item) => asRecord(item).coordinateSystem)).toEqual([
      'calendar',
      'calendar',
    ])
  })

  it('一格就是一对「日期 + 读数」', () => {
    const series = asArray(optionOf(TWO, viewsOf()).series)

    expect(asArray(asRecord(series[0]).data)).toEqual([
      ['2026-03-05', 10],
      ['2026-03-07', 40],
    ])
  })

  it('月名与星期名写死成数组，不交给 echarts 按 locale 挑', () => {
    const calendar = asRecord(asArray(optionOf(TWO, viewsOf()).calendar)[0])

    expect(asArray(asRecord(calendar.monthLabel).nameMap)).toHaveLength(12)
    expect(asArray(asRecord(calendar.dayLabel).nameMap)[0]).toBe('日')
    expect(asRecord(calendar.yearLabel).show).toBe(false)
  })

  it('格缝夹到可配区间里，手编的配置绕不过去', () => {
    const wide = optionOf({ ...TWO, cellGap: 99 }, viewsOf())
    const negative = optionOf({ ...TWO, cellGap: -5 }, viewsOf())

    expect(
      asRecord(asRecord(asArray(wide.series)[0]).itemStyle).borderWidth,
    ).toBe(CELL_GAP_MAX)
    expect(
      asRecord(asRecord(asArray(negative.series)[0]).itemStyle).borderWidth,
    ).toBe(0)
  })

  it('取不到分隔线色时连描边色一起省掉，不写空串', () => {
    const style = asRecord(
      asRecord(asArray(optionOf(TWO, viewsOf(), BARE_THEME).series)[0])
        .itemStyle,
    )

    expect('borderColor' in style).toBe(false)
  })
})

describe('矩阵铺法', () => {
  const MATRIX = { ...TWO, chartStyle: 'matrix' }

  it('一块一套直角坐标，横轴几号、纵轴年月', () => {
    const option = optionOf(MATRIX, viewsOf(MATRIX, 'ok'))

    expect(asArray(option.grid)).toHaveLength(2)
    expect(asArray(asRecord(asArray(option.xAxis)[0]).data)).toHaveLength(31)
    expect(asArray(asRecord(asArray(option.yAxis)[0]).data)).toEqual([
      '2026-03',
      '2026-04',
    ])
    expect(option.calendar).toBeUndefined()
  })

  it('一格是「几号、第几个年月、读数」，年月按升序排', () => {
    const series = asArray(optionOf(MATRIX, viewsOf(MATRIX, 'ok')).series)

    expect(asArray(asRecord(series[0]).data)).toEqual([
      [4, 0, 10],
      [6, 0, 40],
    ])
    expect(asArray(asRecord(series[1]).data)).toEqual([[1, 1, 60]])
  })

  it('格子挂在自己那套坐标上，序号一一对应', () => {
    const series = asArray(optionOf(MATRIX, viewsOf(MATRIX, 'ok')).series)

    expect(series.map((item) => asRecord(item).xAxisIndex)).toEqual([0, 1])
    expect(series.map((item) => asRecord(item).yAxisIndex)).toEqual([0, 1])
  })
})

describe('色标', () => {
  it('有数就画一条连续色标，档位跟着色阶那个下拉走', () => {
    const sequential = asRecord(optionOf(TWO, viewsOf()).visualMap)
    const diverging = asRecord(
      optionOf({ ...TWO, colorScale: 'diverging' }, viewsOf()).visualMap,
    )

    expect(sequential.type).toBe('continuous')
    expect(sequential.min).toBe(10)
    expect(asRecord(sequential.inRange).color).not.toEqual(
      asRecord(diverging.inRange).color,
    )
  })

  it('一个色都派生不出时不写 inRange，不自己补一套默认色', () => {
    const option = optionOf(TWO, viewsOf(), BARE_THEME)

    expect(asRecord(option.visualMap).inRange).toBeUndefined()
  })
})

describe('一天都没取到的那一帧', () => {
  it('连坐标都不建：日历的横轴是真实日期，没有日期就没有轴', () => {
    const option = optionOf(TWO, [])

    expect(option.calendar).toBeUndefined()
    expect(option.series).toBeUndefined()
    expect(option.title).toBeUndefined()
    expect(option.visualMap).toBeUndefined()
  })

  it('背景仍然是透明的，卡片框那层底不被盖住', () => {
    expect(optionOf(TWO, []).backgroundColor).toBe('transparent')
  })
})

describe('提示框与点击', () => {
  it('日历铺法上报得出日期、名字与带单位的读数', () => {
    const tooltip = asRecord(optionOf(TWO, viewsOf()).tooltip)
    const text = call(tooltip.formatter, {
      seriesIndex: 0,
      value: ['2026-03-07', 40],
    })

    expect(text).toContain('2026-03-07')
    expect(text).toContain('能耗')
    expect(text).toContain('40kWh')
  })

  it('矩阵铺法上把「几号 + 年月」拼回一个日期', () => {
    const config = { ...TWO, chartStyle: 'matrix' }
    const tooltip = asRecord(optionOf(config, viewsOf(config, 'ok')).tooltip)

    expect(
      call(tooltip.formatter, { seriesIndex: 1, value: [1, 1, 60] }),
    ).toContain('2026-04-02')
  })

  it('拼进去的自由输入逐段转义，只读访客悬停才不中招', () => {
    const config = {
      timezone: 'UTC',
      [METRIC_ITEMS_KEY]: [{ name: '<img>', unit: '&' }],
    }
    const views = buildMetricViews({
      config,
      rows: [{ series: 1, seriesPoints: pointsOf([MARCH_5, 1]) }],
      slots: { [metricFieldKey(0)]: { state: 'ok' } },
    })
    const tooltip = asRecord(optionOf(config, views).tooltip)
    const text = call(tooltip.formatter, {
      seriesIndex: 0,
      value: ['2026-03-05', 1],
    })

    expect(text).toContain('&lt;img&gt;')
    expect(text).not.toContain('<img>')
  })

  it('认不出的那一格提示框给空串，不画一行「undefined」', () => {
    const tooltip = asRecord(optionOf(TWO, viewsOf()).tooltip)

    expect(call(tooltip.formatter, { seriesIndex: 9 })).toBe('')
  })

  it('关掉提示框那一档只留一个 show:false，不留一份死的 formatter', () => {
    const tooltip = asRecord(
      optionOf({ ...TWO, showTooltip: false }, viewsOf()).tooltip,
    )

    expect(tooltip).toEqual({ show: false })
  })

  it('点某一格上抛那张日历配置里的名称，不是带后缀的标题', () => {
    const views = viewsOf()

    expect(pickedMetricValue(views, { seriesIndex: 1 })).toBe('达标率')
    expect(pickedMetricValue(views, { seriesIndex: 9 })).toBe('')
    expect(pickedMetricValue(views, null)).toBe('')
  })
})
