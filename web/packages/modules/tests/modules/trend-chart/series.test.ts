/**
 * @fileoverview 守趋势曲线的取值层：槽键的拼法、系列配置的归一化、逐条四档状态、
 * 历史序列与实时末值的合并规则（只认严格晚于末点的时刻）、触顶分早晚两头的文案、
 * 时间跨度、值签名，以及「这一页没有历史取数」「窗内确实没有点」「还没接上」
 * 三种空态各说各的话。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 状态按清单声明的子槽逐一去问：设计态的 `slots` 里会多出模块不认识的 `…Points` 键。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  ariaSummaryOf,
  buildSeriesViews,
  drawnViews,
  emptyStateOf,
  historyFieldKey,
  historyUnavailable,
  latestFieldKey,
  readSeriesItems,
  readTrendFormat,
  SERIES_ITEMS_KEY,
  SERIES_NOTES,
  seriesRowCounts,
  seriesRowLabels,
  signatureOf,
  spanOf,
  TREND_NO_HISTORY_TEXT,
  TREND_NO_POINTS_TEXT,
  type SeriesView,
} from '../../../src/modules/trend-chart/series'

type Slots = Record<string, ModuleSlotMeta>

const TWO = [
  { name: '进水', unit: '℃' },
  { name: '回水', unit: '℃' },
]

/** 一条序列的原始点，时刻按分钟递增。 */
function points(...values: number[]): { t: number; v: number }[] {
  return values.map((v, index) => ({ t: 1_000_000 + index * 60_000, v }))
}

function row(
  series: unknown,
  seriesPoints: unknown,
  latest?: unknown,
): Record<string, unknown> {
  return latest === undefined
    ? { series, seriesPoints }
    : { series, seriesPoints, latest }
}

function build(
  config: Record<string, unknown>,
  rows: unknown,
  slots?: Slots,
): SeriesView[] {
  return buildSeriesViews({ config, rows, slots })
}

/** 逐条都 ok 的那份逐槽结论。 */
function allOk(count: number): Slots {
  const slots: Slots = {}
  for (let index = 0; index < count; index += 1) {
    slots[historyFieldKey(index)] = { state: 'ok' }
  }
  return slots
}

describe('槽键与配置归一化', () => {
  it('两个子槽的槽键各按下标拼，行号就是文档序', () => {
    expect(historyFieldKey(0)).toBe('seriesValues[0].series')
    expect(latestFieldKey(2)).toBe('seriesValues[2].latest')
  })

  it('脏行不丢只补默认，名单外的档位回落', () => {
    const items = readSeriesItems([
      { name: '  甲  ', unit: ' ℃', precision: '1', axis: 'right' },
      null,
      { axis: 'middle', lineType: 'wavy' },
    ])

    expect(items[0]).toEqual({
      name: '甲',
      unit: ' ℃',
      precision: 1,
      color: '',
      axis: 'right',
      lineType: 'solid',
    })
    expect(items[1]?.name).toBe('')
    expect(items[2]?.axis).toBe('left')
    expect(items[2]?.lineType).toBe('solid')
  })

  it('整块的数值口径有缺省，脏值不生效', () => {
    expect(readTrendFormat({ unit: 'kW', precision: 3 })).toEqual({
      unit: 'kW',
      precision: 3,
    })
    expect(readTrendFormat({ precision: 'x' })).toEqual({
      unit: '',
      precision: 2,
    })
  })

  it('绑点面板上的行标题与行数都跟着配置里的系列走', () => {
    const config = { [SERIES_ITEMS_KEY]: [{ name: '甲' }, {}, { name: '甲' }] }

    expect(seriesRowLabels(config)).toEqual({
      'seriesValues[0].series': { title: '甲', id: '甲' },
      'seriesValues[1].series': { title: '第 2 条', id: '' },
      'seriesValues[2].series': { title: '甲#1', id: '甲' },
    })
    expect(seriesRowCounts(config)).toEqual({ seriesValues: 3 })
    expect(seriesRowCounts({})).toEqual({ seriesValues: 0 })
  })
})

describe('逐条四档', () => {
  it('没配来源的那几条整条不进输出，图例也不会列它们', () => {
    const views = build({ [SERIES_ITEMS_KEY]: TWO }, [], {
      [historyFieldKey(0)]: { state: 'ok' },
    })

    expect(views.map((view) => view.legendName)).toEqual(['进水（窗内无数据）'])
  })

  it('等首帧与取不到各说各的，且都不画线', () => {
    const views = build(
      { [SERIES_ITEMS_KEY]: TWO },
      [row(1, points(1, 2)), row(2, points(3, 4))],
      {
        [historyFieldKey(0)]: { state: 'pending' },
        [historyFieldKey(1)]: { state: 'error', message: '表被删了' },
      },
    )

    expect(views.map((view) => view.note)).toEqual([
      SERIES_NOTES.pending,
      SERIES_NOTES.error,
    ])
    expect(views.map((view) => view.points.length)).toEqual([0, 0])
    expect(views[1]?.message).toBe('表被删了')
    expect(views[1]?.legendName).toBe('回水（取不到）')
  })

  it('取到了但窗内没有点，与取不到分得开', () => {
    const views = build({ [SERIES_ITEMS_KEY]: TWO }, [row(null, [])], allOk(1))

    expect(views[0]?.state).toBe('ok')
    expect(views[0]?.note).toBe(SERIES_NOTES.empty)
  })

  it('触顶按砍掉的那一头说话，两个读侧方向相反', () => {
    const rows = [row(1, points(1, 2)), row(2, points(3, 4)), row(3, points(5))]
    const views = build({ [SERIES_ITEMS_KEY]: [{}, {}, {}] }, rows, {
      [historyFieldKey(0)]: {
        state: 'ok',
        isTruncated: true,
        truncatedSide: 'early',
      },
      [historyFieldKey(1)]: {
        state: 'ok',
        isTruncated: true,
        truncatedSide: 'late',
      },
      [historyFieldKey(2)]: { state: 'ok', isTruncated: true },
    })

    expect(views.map((view) => view.note)).toEqual([
      SERIES_NOTES.early,
      SERIES_NOTES.late,
      SERIES_NOTES.capped,
    ])
  })

  it('没下发逐槽结论时按有没有序列判，设计态与独立挂载走这条', () => {
    const views = build({ [SERIES_ITEMS_KEY]: TWO }, [
      row(1, points(1, 2)),
      row(undefined, undefined),
    ])

    expect(views.map((view) => view.state)).toEqual(['ok'])
    expect(views[0]?.points).toHaveLength(2)
  })
})

describe('序列与实时末值', () => {
  it('时刻或值不是有限数的点整点丢掉', () => {
    const raw = [
      { t: 1, v: 2 },
      { t: 'x', v: 3 },
      { t: 4, v: null },
      { t: 5, v: Number.NaN },
      { t: 6, v: 7 },
    ]
    const views = build({ [SERIES_ITEMS_KEY]: [{}] }, [row(7, raw)], allOk(1))

    expect(views[0]?.points).toEqual([
      { t: 1, v: 2 },
      { t: 6, v: 7 },
    ])
  })

  it('末值的时刻严格晚于末点才接上去', () => {
    const config = { [SERIES_ITEMS_KEY]: [{}] }
    const later = build(config, [row(1, points(1, 2), 9)], {
      ...allOk(1),
      [latestFieldKey(0)]: { state: 'ok', timestampMs: 1_120_000 },
    })

    expect(later[0]?.points.at(-1)).toEqual({ t: 1_120_000, v: 9 })
    expect(later[0]?.lastValue).toBe(9)
  })

  it('时刻不晚于末点、或压根没有时刻，一律不接', () => {
    const config = { [SERIES_ITEMS_KEY]: [{}, {}] }
    const views = build(
      config,
      [row(1, points(1, 2), 9), row(1, points(1, 2), 9)],
      {
        ...allOk(2),
        [latestFieldKey(0)]: { state: 'ok', timestampMs: 1_000_000 },
        [latestFieldKey(1)]: { state: 'ok' },
      },
    )

    expect(views.map((view) => view.points.length)).toEqual([2, 2])
  })

  it('末值本身不是有限数时不接', () => {
    const views = build(
      { [SERIES_ITEMS_KEY]: [{}] },
      [row(1, points(1), null)],
      {
        ...allOk(1),
        [latestFieldKey(0)]: { state: 'ok', timestampMs: 9_000_000 },
      },
    )

    expect(views[0]?.points).toHaveLength(1)
  })

  it('一个历史点都没有时，末值自己就是那条线的唯一一个点', () => {
    const views = build({ [SERIES_ITEMS_KEY]: [{}] }, [row(null, [], 5)], {
      ...allOk(1),
      [latestFieldKey(0)]: { state: 'ok', timestampMs: 9_000_000 },
    })

    expect(views[0]?.points).toEqual([{ t: 9_000_000, v: 5 }])
    expect(views[0]?.note).toBe('')
  })
})

describe('名字与数值口径', () => {
  it('没起名的按第 N 条称呼，重名的按出现序加后缀，上抛的仍是原名', () => {
    const config = { [SERIES_ITEMS_KEY]: [{ name: '甲' }, { name: '甲' }, {}] }
    const views = build(
      config,
      [row(1, points(1)), row(2, points(2)), row(3, points(3))],
      allOk(3),
    )

    expect(views.map((view) => view.legendName)).toEqual([
      '甲',
      '甲#1',
      '第 3 条',
    ])
    expect(views.map((view) => view.emitValue)).toEqual(['甲', '甲', ''])
  })

  it('逐条的单位与小数位优先，缺了才用整块那一份', () => {
    const config = {
      unit: 'kW',
      precision: 0,
      [SERIES_ITEMS_KEY]: [{ unit: '℃', precision: 2 }, {}],
    }
    const views = build(
      config,
      [row(1, points(1.234)), row(2, points(5.678))],
      allOk(2),
    )

    expect(views[0]?.lastText).toBe('1.23℃')
    expect(views[1]?.lastText).toBe('6kW')
  })
})

describe('跨度、签名与读屏摘要', () => {
  it('跨度按取回来的点算，两条窗口不同的系列一起铺', () => {
    const views = build(
      { [SERIES_ITEMS_KEY]: TWO },
      [
        row(1, [{ t: 10, v: 1 }]),
        row(2, [
          { t: 100, v: 2 },
          { t: 400, v: 3 },
        ]),
      ],
      allOk(2),
    )

    expect(spanOf(views)).toBe(390)
    expect(spanOf([])).toBe(0)
  })

  it('签名只含行数、点数、末点与状态这几样廉价指纹', () => {
    const config = { [SERIES_ITEMS_KEY]: [{}] }
    const before = build(config, [row(1, points(1, 2))], allOk(1))
    const after = build(config, [row(1, points(1, 3))], allOk(1))

    expect(signatureOf(before)).not.toBe(signatureOf(after))
    expect(signatureOf(before)).toBe(
      signatureOf(build(config, [row(1, points(1, 2))], allOk(1))),
    )
    expect(signatureOf([])).toBe('')
  })

  it('读屏摘要连没画出来的那几条一起报，图例关得掉它关不掉', () => {
    const views = build(
      { [SERIES_ITEMS_KEY]: TWO },
      [row(1, points(1, 2)), row(2, [])],
      allOk(2),
    )

    expect(ariaSummaryOf(views)).toContain('共 1 条')
    expect(ariaSummaryOf(views)).toContain('另有 1 条')
    expect(ariaSummaryOf([])).toBe('')
    expect(
      ariaSummaryOf(build({ [SERIES_ITEMS_KEY]: TWO }, [row(1, [])], allOk(1))),
    ).toContain('一条都画不出来')
  })

  it('画得出线的判据是 ok 且至少有一个点', () => {
    const views = build(
      { [SERIES_ITEMS_KEY]: TWO },
      [row(1, points(1)), row(2, points(2))],
      {
        [historyFieldKey(0)]: { state: 'ok' },
        [historyFieldKey(1)]: { state: 'error' },
      },
    )

    expect(drawnViews(views)).toHaveLength(1)
  })
})

describe('三种空态各说各的话', () => {
  const config = { [SERIES_ITEMS_KEY]: TWO, emptyText: '还没接上' }

  it('画得出线就不是空态', () => {
    const views = build(config, [row(1, points(1))], allOk(1))

    expect(emptyStateOf(config, views)).toEqual({ isEmpty: false, text: '' })
  })

  it('每一条都被同步读取器退回来时，说清这一页没有历史取数', () => {
    const refusal = '序列要异步取数，画布上不展开'
    const views = build(config, [row(1, []), row(2, [])], {
      [historyFieldKey(0)]: { state: 'error', message: refusal },
      [historyFieldKey(1)]: { state: 'error', message: refusal },
    })

    expect(historyUnavailable(views)).toBe(true)
    expect(emptyStateOf(config, views).text).toBe(TREND_NO_HISTORY_TEXT)
  })

  it('取到了但窗内没有点，与还没接上分得开', () => {
    const empty = build(config, [row(null, [])], allOk(1))

    expect(emptyStateOf(config, empty).text).toBe(TREND_NO_POINTS_TEXT)

    const pending = build(config, [row(null, [])], {
      [historyFieldKey(0)]: { state: 'pending' },
    })

    expect(emptyStateOf(config, pending).text).toBe('还没接上')
  })

  it('空态文案被清空时回落一句现成的话，不留一条空白', () => {
    const views = build({ [SERIES_ITEMS_KEY]: TWO }, [], {})

    expect(historyUnavailable(views)).toBe(false)
    expect(emptyStateOf({ emptyText: '   ' }, views).text).toBe('暂无数据')
  })
})
