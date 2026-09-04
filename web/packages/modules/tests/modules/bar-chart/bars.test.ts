/**
 * @fileoverview 守对比柱图的取值层：行列表的归一化、逐行四档状态、两档各自的类目轴
 * （实时档是行名、历史档是时刻并集）、百分比档两档不同的分母、被忽略的那一路的后缀、
 * 「取到了但窗内没数」与「取不到」两句不同的话，以及空态、读屏摘要与绑点面板那两份派生。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 状态按清单声明的子槽逐一去问，不按 `slots` 的键遍历：设计态那条路会多出
 * 模块自己不认识的 `…Points` 键。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  ariaSummaryOf,
  BAR_EMPTY_TEXT,
  BAR_HISTORY_EMPTY_TEXT,
  BAR_ITEMS_KEY,
  BAR_NOTES,
  BAR_SERIES_FIELD,
  BAR_SLOT_KEY,
  BAR_VALUE_FIELD,
  barFieldKey,
  barRowCounts,
  barRowLabels,
  buildBarViews,
  cellText,
  emptyStateOf,
  readBarFormat,
  readBarItems,
  readValueSource,
  shareText,
  signatureOf,
  type BarChartView,
} from '../../../src/modules/bar-chart/bars'

const HOUR = 3_600_000
const BASE = new Date(2026, 2, 4, 9, 0, 0).getTime()

type Slots = Record<string, ModuleSlotMeta>

const THREE = [
  { name: '1# 线', unit: 't' },
  { name: '2# 线', unit: 't' },
  { name: '3# 线', unit: 't' },
]

/** 逐行都绑上某个子槽的 slots 表。 */
function slotsFor(
  field: string,
  states: readonly ('ok' | 'pending' | 'error')[],
  extra: Slots = {},
): Slots {
  const slots: Slots = { ...extra }
  states.forEach((state, index) => {
    slots[barFieldKey(index, field)] = { state }
  })
  return slots
}

function liveView(
  config: Record<string, unknown>,
  numbers: readonly unknown[],
  states: readonly ('ok' | 'pending' | 'error')[] = [],
  extra: Slots = {},
): BarChartView {
  return buildBarViews({
    config,
    rows: numbers.map((value) => ({ [BAR_VALUE_FIELD]: value })),
    slots: slotsFor(
      BAR_VALUE_FIELD,
      numbers.map((_, index) => states[index] ?? 'ok'),
      extra,
    ),
  })
}

function historyView(
  config: Record<string, unknown>,
  rows: readonly (readonly { t: number; v: unknown }[] | undefined)[],
  states: readonly ('ok' | 'pending' | 'error')[] = [],
): BarChartView {
  return buildBarViews({
    config: { ...config, valueSource: 'history' },
    rows: rows.map((points) => ({ [`${BAR_SERIES_FIELD}Points`]: points })),
    slots: slotsFor(
      BAR_SERIES_FIELD,
      rows.map((_, index) => states[index] ?? 'ok'),
    ),
  })
}

const BASE_CONFIG = { [BAR_ITEMS_KEY]: THREE }

describe('行列表的归一化', () => {
  it('缺什么补什么，脏行不丢：丢一行会让其后每条绑定改喂另一行', () => {
    expect(readBarItems([{ name: ' 甲 ' }, 7, null])).toEqual([
      {
        name: '甲',
        unit: '',
        precision: null,
        color: '',
        stack: '',
        plot: 'bar',
        axis: 'left',
      },
      {
        name: '',
        unit: '',
        precision: null,
        color: '',
        stack: '',
        plot: 'bar',
        axis: 'left',
      },
      {
        name: '',
        unit: '',
        precision: null,
        color: '',
        stack: '',
        plot: 'bar',
        axis: 'left',
      },
    ])
  })

  it('单位不去首尾空格，名字与颜色去：「° C」是显式的排版意图', () => {
    const [item] = readBarItems([{ unit: ' ° C', color: ' var(--x) ' }])

    expect(item?.unit).toBe(' ° C')
    expect(item?.color).toBe('var(--x)')
  })

  it('画法与挂轴不在名单里的一律回落，不让脏数据挑走一档语义', () => {
    const [item] = readBarItems([{ plot: 'area', axis: 'top' }])

    expect(item?.plot).toBe('bar')
    expect(item?.axis).toBe('left')
  })

  it('取数来源与数值口径各有缺省', () => {
    expect(readValueSource({})).toBe('live')
    expect(readValueSource({ valueSource: 'history' })).toBe('history')
    expect(readValueSource({ valueSource: 'guess' })).toBe('live')
    expect(readBarFormat({})).toEqual({ unit: '', precision: 2 })
    expect(readBarFormat({ unit: 'kW', precision: 0 })).toEqual({
      unit: 'kW',
      precision: 0,
    })
  })
})

describe('实时档', () => {
  it('类目是各行的名字，一行只在自己那一格上有读数', () => {
    const view = liveView(BASE_CONFIG, [30, 10, 20])

    expect(view.source).toBe('live')
    expect(view.categories).toEqual(['1# 线', '2# 线', '3# 线'])
    expect(view.series.map((series) => series.data)).toEqual([
      [30, null, null],
      [null, 10, null],
      [null, null, 20],
    ])
  })

  it('没配来源的那几行整行不进输出，图例也就不列它们', () => {
    const view = buildBarViews({
      config: BASE_CONFIG,
      rows: [{ value: 30 }],
      slots: { [barFieldKey(0, BAR_VALUE_FIELD)]: { state: 'ok' } },
    })

    expect(view.series.map((series) => series.legendName)).toEqual(['1# 线'])
    expect(view.categories).toEqual(['1# 线'])
  })

  it('非 ok 的那几行 series 照常留着、data 给空数组，名字带上原因', () => {
    const view = liveView(BASE_CONFIG, [30, 10, 20], ['ok', 'pending', 'error'])

    expect(view.series.map((series) => series.legendName)).toEqual([
      '1# 线',
      `2# 线（${BAR_NOTES.pending}）`,
      `3# 线（${BAR_NOTES.error}）`,
    ])
    expect(view.series.map((series) => series.data)).toEqual([
      [30, null, null],
      [],
      [],
    ])
  })

  it('负值照实带下去，不取绝对值', () => {
    const view = liveView(BASE_CONFIG, [-40, 60])

    expect(view.series[0]?.data[0]).toBe(-40)
  })

  it('百分比的分母是全部行的合计：按列归一会让每根柱都恒等于 100%', () => {
    const view = liveView(BASE_CONFIG, [30, 10, 60])

    expect(view.series.map((series) => series.shares[series.index])).toEqual([
      30, 10, 60,
    ])
  })

  it('合计不大于 0 时一格占比都算不出来，而不是画成 0%', () => {
    const view = liveView(BASE_CONFIG, [0, 0])

    expect(view.series.flatMap((series) => series.shares)).toEqual([
      null,
      null,
      null,
      null,
    ])
  })

  it('没起名的那几行按「第 N 行」称呼，重名的按出现序去重', () => {
    const config = {
      [BAR_ITEMS_KEY]: [{ name: '甲' }, { name: '甲' }, {}],
    }
    const view = liveView(config, [1, 2, 3])

    expect(view.series.map((series) => series.legendName)).toEqual([
      '甲',
      '甲#1',
      '第 3 行',
    ])
    expect(view.series.map((series) => series.emitValue)).toEqual([
      '甲',
      '甲',
      '',
    ])
  })
})

describe('历史档', () => {
  it('类目是几行时刻的并集，逐行按时刻对齐、缺格留 null', () => {
    const view = historyView(BASE_CONFIG, [
      [
        { t: BASE, v: 1 },
        { t: BASE + HOUR, v: 2 },
      ],
      [{ t: BASE + HOUR, v: 3 }],
    ])

    expect(view.source).toBe('history')
    expect(view.categories).toEqual(['09:00', '10:00'])
    expect(view.series.map((series) => series.data)).toEqual([
      [1, 2],
      [null, 3],
    ])
  })

  it('取到了但窗内一格都没有，与「取不到」是两句不同的话', () => {
    const view = historyView(
      BASE_CONFIG,
      [[{ t: BASE, v: 1 }], []],
      ['ok', 'ok'],
    )

    expect(view.series[1]?.legendName).toBe(`2# 线（${BAR_NOTES.empty}）`)
    expect(view.series[1]?.state).toBe('ok')
  })

  it('百分比按列归一，一整列全缺时整列留空而不是画成 0%', () => {
    const view = historyView(BASE_CONFIG, [
      [
        { t: BASE, v: 30 },
        { t: BASE + HOUR, v: null },
      ],
      [
        { t: BASE, v: 10 },
        { t: BASE + HOUR, v: null },
      ],
    ])

    expect(view.series.map((series) => series.shares)).toEqual([
      [75, null],
      [25, null],
    ])
  })

  it('一整列加起来不大于 0 时也整列留空：占比对零和没有几何意义', () => {
    const view = historyView(BASE_CONFIG, [
      [{ t: BASE, v: 10 }],
      [{ t: BASE, v: -10 }],
    ])

    expect(view.series.map((series) => series.shares)).toEqual([[null], [null]])
  })

  it('注入袋里不是一串点时按「这一行没有序列」处理', () => {
    const view = buildBarViews({
      config: { ...BASE_CONFIG, valueSource: 'history' },
      rows: [{ seriesPoints: 'nope' }],
      slots: { [barFieldKey(0, BAR_SERIES_FIELD)]: { state: 'ok' } },
    })

    expect(view.categories).toEqual([])
    expect(view.series[0]?.legendName).toBe(`1# 线（${BAR_NOTES.empty}）`)
  })
})

describe('两路都绑了的时候', () => {
  it('实时档标出历史那一路被忽略了', () => {
    const view = liveView(BASE_CONFIG, [30], ['ok'], {
      [barFieldKey(0, BAR_SERIES_FIELD)]: { state: 'ok' },
    })

    expect(view.series[0]?.legendName).toBe(
      `1# 线（${BAR_NOTES.ignoredHistory}）`,
    )
  })

  it('历史档标出实时那一路被忽略了，且与状态后缀并存', () => {
    const view = buildBarViews({
      config: { ...BASE_CONFIG, valueSource: 'history' },
      rows: [{}],
      slots: {
        [barFieldKey(0, BAR_SERIES_FIELD)]: { state: 'error' },
        [barFieldKey(0, BAR_VALUE_FIELD)]: { state: 'ok' },
      },
    })

    expect(view.series[0]?.legendName).toBe(
      `1# 线（${BAR_NOTES.error} · ${BAR_NOTES.ignoredLive}）`,
    )
  })
})

describe('陈旧与触顶', () => {
  it('陈旧与「窗内还有更多点」各挂各的后缀，两条能同时出现', () => {
    const view = buildBarViews({
      config: { ...BASE_CONFIG, valueSource: 'history' },
      rows: [{ seriesPoints: [{ t: BASE, v: 1 }] }],
      slots: {
        [barFieldKey(0, BAR_SERIES_FIELD)]: {
          state: 'ok',
          isStale: true,
          isTruncated: true,
        },
      },
    })

    expect(view.series[0]?.note).toBe(
      `${BAR_NOTES.stale} · ${BAR_NOTES.truncated}`,
    )
  })
})

describe('设计态与独立挂载', () => {
  it('没下发逐槽结论时按「有没有值」判档，有值就照画', () => {
    const view = buildBarViews({
      config: BASE_CONFIG,
      rows: [{ value: 30 }, {}],
      slots: undefined,
    })

    expect(view.series.map((series) => series.legendName)).toEqual(['1# 线'])
    expect(view.series[0]?.data).toEqual([30])
  })
})

describe('数值文案', () => {
  it('逐行的单位与小数位优先，缺了才用整块那一份', () => {
    const format = { unit: 'kW', precision: 2 }
    const row = {
      name: '',
      unit: 't',
      precision: 0,
      color: '',
      stack: '',
      plot: 'bar' as const,
      axis: 'left' as const,
    }

    expect(cellText(12.345, row, format)).toBe('12t')
    expect(
      cellText(12.345, { ...row, unit: '', precision: null }, format),
    ).toBe('12.35kW')
    expect(cellText(null, row, format)).toBe('')
  })

  it('占比固定一位小数，算不出给空串', () => {
    expect(shareText(42.55)).toBe('42.6%')
    expect(shareText(null)).toBe('')
  })
})

describe('值签名', () => {
  it('两档的签名不会互相撞车，读数一变它就变', () => {
    const one = signatureOf(liveView(BASE_CONFIG, [30, 10]))
    const two = signatureOf(liveView(BASE_CONFIG, [30, 11]))

    expect(one).not.toBe(two)
    expect(signatureOf(liveView(BASE_CONFIG, [30, 10]))).toBe(one)
  })

  it('状态变了签名也变：从等首帧到有数是两帧不同的画面', () => {
    const pending = signatureOf(liveView(BASE_CONFIG, [30], ['pending']))
    const ready = signatureOf(liveView(BASE_CONFIG, [30], ['ok']))

    expect(pending).not.toBe(ready)
  })
})

describe('空态', () => {
  it('一格都画不出来才算空，接了一部分不算', () => {
    expect(emptyStateOf({}, liveView(BASE_CONFIG, [30, 10]))).toEqual({
      isEmpty: false,
      text: '',
    })
    expect(
      emptyStateOf({}, liveView(BASE_CONFIG, [30], ['pending'])).isEmpty,
    ).toBe(true)
  })

  it('自定义文案压过两句缺省，一串空格不算配了', () => {
    const view = liveView(BASE_CONFIG, [30], ['error'])

    expect(emptyStateOf({ emptyText: '未接点位' }, view).text).toBe('未接点位')
    expect(emptyStateOf({ emptyText: '   ' }, view).text).toBe(BAR_EMPTY_TEXT)
  })

  it('历史档整块取不到时另说一句：那不是现场没数据', () => {
    const view = historyView(
      BASE_CONFIG,
      [undefined, undefined],
      ['error', 'error'],
    )

    expect(emptyStateOf({}, view).text).toBe(BAR_HISTORY_EMPTY_TEXT)
  })

  it('历史档只是窗内没数时仍说通用那一句，不赖到公开屏上', () => {
    const view = historyView(BASE_CONFIG, [[], []], ['ok', 'ok'])

    expect(emptyStateOf({}, view).text).toBe(BAR_EMPTY_TEXT)
  })
})

describe('读屏摘要', () => {
  it('报出末值与类目数，没读数的那几组也点名', () => {
    const view = liveView(BASE_CONFIG, [30, 10, 20], ['ok', 'ok', 'error'])
    const text = ariaSummaryOf({ precision: 0 }, view)

    expect(text).toContain('共 2 组、3 个类目')
    expect(text).toContain('1# 线 末值 30t')
    expect(text).toContain(`另有 1 组没有读数：3# 线（${BAR_NOTES.error}）`)
  })

  it('一行都没配来源时给空串，免得图区被读成一个没名字的图形', () => {
    const bare = buildBarViews({ config: BASE_CONFIG, rows: [], slots: {} })

    expect(ariaSummaryOf({}, bare)).toBe('')
  })

  it('一格都画不出来时说清「一根柱都画不出来」', () => {
    const view = liveView(BASE_CONFIG, [30], ['error'])

    expect(ariaSummaryOf({}, view)).toContain('一根柱都画不出来')
  })
})

describe('绑点面板那两份派生', () => {
  it('每一行的两个子槽共用同一个标题，联动值给的是原名', () => {
    expect(barRowLabels({ [BAR_ITEMS_KEY]: [{ name: '甲' }, {}] })).toEqual({
      [barFieldKey(0, BAR_VALUE_FIELD)]: { title: '甲', id: '甲' },
      [barFieldKey(0, BAR_SERIES_FIELD)]: { title: '甲', id: '甲' },
      [barFieldKey(1, BAR_VALUE_FIELD)]: { title: '第 2 行', id: '' },
      [barFieldKey(1, BAR_SERIES_FIELD)]: { title: '第 2 行', id: '' },
    })
  })

  it('一行都没有时也要给 0，别把槽键漏掉', () => {
    expect(barRowCounts({})).toEqual({ [BAR_SLOT_KEY]: 0 })
    expect(barRowCounts(BASE_CONFIG)).toEqual({ [BAR_SLOT_KEY]: 3 })
  })
})
