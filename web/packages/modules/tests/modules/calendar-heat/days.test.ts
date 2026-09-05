/**
 * @fileoverview 守日历热力的取值层：日界按配置给的时区算（跨零点的样本落在正确的
 * 那一天）、认不出的时区不静默按本地折日、一天之内那批采样按五档算法归并成一个数、
 * 逐张四档与触顶那句「只到 …」、整块共用的日期跨度与色阶量程，以及空态那四句
 * 各说各的原因。
 *
 * ⚠ 时区这一条错了整块只是**错一天**，屏上一个字的异常都没有——只能靠这里逐条钉。
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  aggregateDay,
  ariaSummaryOf,
  buildMetricViews,
  CALENDAR_BLANK_TEXT,
  CALENDAR_EMPTY_TEXT,
  CALENDAR_NO_HISTORY_TEXT,
  dayCellsOf,
  dayFormatterOf,
  dayKeyOf,
  drawnMetrics,
  emptyStateOf,
  historyUnavailable,
  METRIC_ITEMS_KEY,
  METRIC_NOTES,
  metricFieldKey,
  metricRowCounts,
  metricRowLabels,
  monthOf,
  monthsOf,
  readMetricItems,
  readTimezone,
  signatureOf,
  spanOf,
  timezoneFaultText,
  truncatedNote,
  valueRangeOf,
  type MetricView,
} from '../../../src/modules/calendar-heat/days'

/** 2026-03-05 16:30 UTC：东八区已经是 6 号凌晨，纽约还是 5 号上午。 */
const CROSS_MIDNIGHT = Date.UTC(2026, 2, 5, 16, 30)

type Slots = Record<string, ModuleSlotMeta>

function pointsOf(...samples: readonly (readonly [number, number])[]) {
  return samples.map(([at, reading]) => ({ t: at, v: reading }))
}

/** 读数不是数的那种脏点，只有「整点丢掉」那一条用得上。 */
function dirtyPoints(...samples: readonly (readonly [number, unknown])[]) {
  return samples.map(([at, reading]) => ({ t: at, v: reading }))
}

function rowsOf(...rows: readonly unknown[]): unknown[] {
  return [...rows]
}

function viewsOf(
  config: Record<string, unknown>,
  rows: unknown,
  slots?: Slots,
): MetricView[] {
  return buildMetricViews({ config, rows, slots })
}

const ONE = { [METRIC_ITEMS_KEY]: [{ name: '能耗', unit: 'kWh' }] }

/**
 * 应用壳那份同步读取器对序列类来源的拒绝原文。
 * ⚠ 这一句是跨包约定，本处照抄字面量：模块侧的判据钉的就是它，改一个字两边就漂了。
 */
const SYNC_REFUSAL = '序列要异步取数，画布上不展开'

describe('日界跟着配置里的时区走', () => {
  it('东八区的跨零点样本落在第二天', () => {
    const formatter = dayFormatterOf('Asia/Shanghai')

    expect(formatter === null ? '' : dayKeyOf(formatter, CROSS_MIDNIGHT)).toBe(
      '2026-03-06',
    )
  })

  it('同一个时刻在 UTC 与纽约各落在哪一天', () => {
    const utc = dayFormatterOf('UTC')
    const york = dayFormatterOf('America/New_York')

    expect(utc === null ? '' : dayKeyOf(utc, CROSS_MIDNIGHT)).toBe('2026-03-05')
    expect(york === null ? '' : dayKeyOf(york, CROSS_MIDNIGHT)).toBe(
      '2026-03-05',
    )
  })

  it('留空跟着浏览器本地时区走，不是写死的某一档', () => {
    const local = dayFormatterOf('')
    const expected = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(CROSS_MIDNIGHT))

    expect(local === null ? '' : dayKeyOf(local, CROSS_MIDNIGHT)).toBe(expected)
  })

  it('留空与东八区各走各的，整块因此可能差一天', () => {
    const shanghai = { ...ONE, timezone: 'Asia/Shanghai' }
    const row = { series: 12, seriesPoints: pointsOf([CROSS_MIDNIGHT, 12]) }
    const pinned = viewsOf(shanghai, rowsOf(row))
    const local = viewsOf(ONE, rowsOf(row))

    expect(pinned[0]?.cells[0]?.day).toBe('2026-03-06')
    expect(local[0]?.cells[0]?.day).toBe(
      dayKeyOf(dayFormatterOf('') ?? new Intl.DateTimeFormat(), CROSS_MIDNIGHT),
    )
  })

  it('认不出的时区给 null，而不是悄悄回落本地', () => {
    expect(dayFormatterOf('Mars/Olympus')).toBeNull()
  })

  it('时区认不出时整块画不出来，并把那个串原样说出来', () => {
    const config = { ...ONE, timezone: 'Mars/Olympus' }
    const views = viewsOf(config, rowsOf({ seriesPoints: pointsOf([1, 2]) }))

    expect(views).toEqual([])
    expect(emptyStateOf(config, views).text).toBe(
      timezoneFaultText('Mars/Olympus'),
    )
  })

  it('时区串两头的空格不算内容', () => {
    expect(readTimezone({ timezone: '  Asia/Shanghai  ' })).toBe(
      'Asia/Shanghai',
    )
    expect(readTimezone({})).toBe('')
  })
})

describe('一天之内那批采样怎么并成一个数', () => {
  const READINGS = [4, 9, 2, 7]

  it('五档各算各的', () => {
    expect(aggregateDay(READINGS, 'sum')).toBe(22)
    expect(aggregateDay(READINGS, 'avg')).toBe(5.5)
    expect(aggregateDay(READINGS, 'max')).toBe(9)
    expect(aggregateDay(READINGS, 'min')).toBe(2)
    expect(aggregateDay(READINGS, 'last')).toBe(7)
  })

  it('一个读数都没有时给 null，而不是 0', () => {
    expect(aggregateDay([], 'sum')).toBeNull()
  })

  it('同一天的几个采样并成一格，跨天的分开', () => {
    const formatter = dayFormatterOf('UTC')
    const cells = dayCellsOf(
      pointsOf(
        [Date.UTC(2026, 2, 5, 1), 3],
        [Date.UTC(2026, 2, 5, 20), 5],
        [Date.UTC(2026, 2, 7, 2), 8],
      ),
      formatter ?? new Intl.DateTimeFormat(),
      'sum',
    )

    expect(cells).toEqual([
      { day: '2026-03-05', value: 8 },
      { day: '2026-03-07', value: 8 },
    ])
  })

  it('折出来的日子按升序排，不靠取回的顺序', () => {
    const formatter = dayFormatterOf('UTC')
    const cells = dayCellsOf(
      pointsOf([Date.UTC(2026, 2, 9), 1], [Date.UTC(2026, 2, 2), 2]),
      formatter ?? new Intl.DateTimeFormat(),
      'last',
    )

    expect(cells.map((cell) => cell.day)).toEqual(['2026-03-02', '2026-03-09'])
  })

  it('非数值的读数整点丢掉，不当成 0', () => {
    const views = viewsOf(
      { ...ONE, timezone: 'UTC' },
      rowsOf({
        series: 4,
        seriesPoints: dirtyPoints(
          [Date.UTC(2026, 2, 5), 'x'],
          [Date.UTC(2026, 2, 6), 4],
        ),
      }),
    )

    expect(views[0]?.cells).toEqual([{ day: '2026-03-06', value: 4 }])
  })

  it('逐日归并档位跟着这一行的配置走', () => {
    const config = {
      timezone: 'UTC',
      [METRIC_ITEMS_KEY]: [{ name: '温度', dayAggregate: 'avg' }],
    }
    const views = viewsOf(
      config,
      rowsOf({
        series: 20,
        seriesPoints: pointsOf(
          [Date.UTC(2026, 2, 5, 1), 10],
          [Date.UTC(2026, 2, 5, 2), 20],
        ),
      }),
    )

    expect(views[0]?.cells).toEqual([{ day: '2026-03-05', value: 15 }])
  })

  it('认不出的归并档回落求和，不静默画空', () => {
    expect(readMetricItems([{ dayAggregate: 'median' }])[0]?.dayAggregate).toBe(
      'sum',
    )
  })
})

describe('逐张四档', () => {
  const THREE = {
    timezone: 'UTC',
    [METRIC_ITEMS_KEY]: [
      { name: '能耗', unit: 'kWh' },
      { name: '达标率', unit: '%' },
      { name: '产量' },
    ],
  }

  it('没配来源的那几张整张不进输出', () => {
    const views = viewsOf(THREE, rowsOf({ seriesPoints: pointsOf([1, 2]) }), {
      [metricFieldKey(0)]: { state: 'ok' },
    })

    expect(views.map((view) => view.name)).toEqual(['能耗'])
  })

  it('等首帧与取不到各说各的原因，一格都不画', () => {
    const views = viewsOf(THREE, rowsOf(), {
      [metricFieldKey(0)]: { state: 'pending' },
      [metricFieldKey(1)]: { state: 'error', message: '表被删了' },
    })

    expect(views.map((view) => view.note)).toEqual([
      METRIC_NOTES.pending,
      METRIC_NOTES.error,
    ])
    expect(views.every((view) => view.cells.length === 0)).toBe(true)
  })

  it('取到了但窗内一天都没有，是第三句话', () => {
    const views = viewsOf(THREE, rowsOf({ seriesPoints: [] }), {
      [metricFieldKey(0)]: { state: 'ok' },
    })

    expect(views[0]?.note).toBe(METRIC_NOTES.empty)
  })

  it('触顶时说清取回的是哪一段，不是一句通用的「被截断」', () => {
    const views = viewsOf(
      THREE,
      rowsOf({
        seriesPoints: pointsOf(
          [Date.UTC(2026, 2, 5), 1],
          [Date.UTC(2026, 2, 7), 2],
        ),
      }),
      { [metricFieldKey(0)]: { state: 'ok', isTruncated: true } },
    )

    expect(views[0]?.note).toBe(truncatedNote('2026-03-05', '2026-03-07'))
    expect(views[0]?.cells).toHaveLength(2)
  })

  it('没下发逐槽结论时按「有没有值」退回判断', () => {
    const views = viewsOf(
      THREE,
      rowsOf({
        series: 12,
        seriesPoints: pointsOf([Date.UTC(2026, 2, 5), 12]),
      }),
    )

    expect(views.map((view) => view.state)).toEqual(['ok'])
  })

  it('没起名的按「第 N 张」称呼，重名的加后缀去重', () => {
    const config = {
      [METRIC_ITEMS_KEY]: [{ name: '能耗' }, { name: '能耗' }, {}],
    }
    const views = viewsOf(
      config,
      rowsOf({ series: 1 }, { series: 2 }, { series: 3 }),
    )

    expect(views.map((view) => view.name)).toEqual([
      '能耗',
      '能耗#1',
      '第 3 张',
    ])
    expect(views.map((view) => view.emitValue)).toEqual(['能耗', '能耗', ''])
  })

  it('逐张小数位留空时跟着缺省那一档，填了就压过它', () => {
    const config = {
      [METRIC_ITEMS_KEY]: [{ name: 'a' }, { name: 'b', precision: 0 }],
    }
    const views = viewsOf(config, rowsOf({ series: 1 }, { series: 2 }))

    expect(views.map((view) => view.precision)).toEqual([2, 0])
  })
})

describe('整块共用的跨度与量程', () => {
  const TWO = {
    timezone: 'UTC',
    [METRIC_ITEMS_KEY]: [{ name: '能耗' }, { name: '产量' }],
  }

  function twoViews(): MetricView[] {
    return viewsOf(
      TWO,
      rowsOf(
        {
          seriesPoints: pointsOf(
            [Date.UTC(2026, 0, 20), 5],
            [Date.UTC(2026, 1, 3), 9],
          ),
        },
        {
          seriesPoints: pointsOf(
            [Date.UTC(2026, 2, 11), 2],
            [Date.UTC(2026, 2, 12), 30],
          ),
        },
      ),
      {
        [metricFieldKey(0)]: { state: 'ok' },
        [metricFieldKey(1)]: { state: 'ok' },
      },
    )
  }

  it('跨度是各张取回的日子的并集，不是某一张的窗口', () => {
    expect(spanOf(twoViews())).toEqual({
      from: '2026-01-20',
      to: '2026-03-12',
    })
  })

  it('一张都画不出来时没有跨度', () => {
    expect(spanOf([])).toBeNull()
  })

  it('后一张整段都更早时，跨度往前扩而不是被它顶掉', () => {
    const views = viewsOf(
      TWO,
      rowsOf(
        { series: 1, seriesPoints: pointsOf([Date.UTC(2026, 5, 1), 1]) },
        { series: 2, seriesPoints: pointsOf([Date.UTC(2026, 0, 9), 2]) },
      ),
      {
        [metricFieldKey(0)]: { state: 'ok' },
        [metricFieldKey(1)]: { state: 'ok' },
      },
    )

    expect(spanOf(views)).toEqual({ from: '2026-01-09', to: '2026-06-01' })
  })

  it('量程横跨全部画得出来的那几张', () => {
    expect(valueRangeOf(twoViews())).toEqual({ min: 2, max: 30 })
  })

  it('一格都没有时量程给 null，交给上面决定不画色标', () => {
    expect(valueRangeOf([])).toBeNull()
  })

  it('画得出来的那几张 = ok 且至少有一天', () => {
    const views = viewsOf(TWO, rowsOf({ seriesPoints: [] }, {}), {
      [metricFieldKey(0)]: { state: 'ok' },
      [metricFieldKey(1)]: { state: 'error' },
    })

    expect(drawnMetrics(views)).toEqual([])
  })

  it('年月串按升序逐月推，跨年那一步也不落空', () => {
    expect(monthsOf({ from: '2025-11-30', to: '2026-02-01' })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
    expect(monthOf('2026-02-17')).toBe('2026-02')
  })

  it('推不到头时按上限收手，不会把浏览器挂死', () => {
    expect(monthsOf({ from: '2026-01-01', to: '9999-12-31' })).toHaveLength(400)
  })

  it('跨度首尾颠倒时只给起点那一个月，不倒着推', () => {
    expect(monthsOf({ from: '2026-05-01', to: '2026-01-01' })).toEqual([
      '2026-05',
    ])
  })

  it('跨度里的年月读不出来时给空表，而不是造一串假月份', () => {
    expect(monthsOf({ from: 'not-a-day', to: '2026-01-01' })).toEqual([])
  })
})

describe('空态那四句各说各的', () => {
  it('一张都没配来源时用配置里那一句，清空了回落一句现成的', () => {
    expect(emptyStateOf({ emptyText: '未接台账' }, []).text).toBe('未接台账')
    expect(emptyStateOf({ emptyText: '   ' }, []).text).toBe(
      CALENDAR_EMPTY_TEXT,
    )
  })

  it('配了却一天都没取到时逐张说明原因', () => {
    const config = {
      timezone: 'UTC',
      [METRIC_ITEMS_KEY]: [{ name: '能耗' }, { name: '产量' }],
    }
    const views = viewsOf(config, rowsOf(), {
      [metricFieldKey(0)]: { state: 'error' },
      [metricFieldKey(1)]: { state: 'pending' },
    })

    expect(emptyStateOf(config, views).text).toBe(
      `${CALENDAR_BLANK_TEXT}：能耗（取不到）、产量（等首帧）`,
    )
  })

  it('每一张都被同步读取器退回来时，说清这一页不提供历史', () => {
    const config = {
      timezone: 'UTC',
      [METRIC_ITEMS_KEY]: [{ name: '能耗' }, { name: '产量' }],
    }
    const views = viewsOf(config, rowsOf(), {
      [metricFieldKey(0)]: { state: 'error', message: SYNC_REFUSAL },
      [metricFieldKey(1)]: { state: 'error', message: SYNC_REFUSAL },
    })

    expect(historyUnavailable(views)).toBe(true)
    expect(emptyStateOf(config, views).text).toBe(CALENDAR_NO_HISTORY_TEXT)
  })

  it('只有一张是那句拒绝时不算没装历史，仍逐张说明原因', () => {
    const config = {
      timezone: 'UTC',
      [METRIC_ITEMS_KEY]: [{ name: '能耗' }, { name: '产量' }],
    }
    const views = viewsOf(config, rowsOf(), {
      [metricFieldKey(0)]: { state: 'error', message: SYNC_REFUSAL },
      [metricFieldKey(1)]: { state: 'error', message: '表被删了' },
    })

    expect(historyUnavailable(views)).toBe(false)
    expect(emptyStateOf(config, views).text).toBe(
      `${CALENDAR_BLANK_TEXT}：能耗（取不到）、产量（取不到）`,
    )
  })

  it('一张都没配来源时不算没装历史', () => {
    expect(historyUnavailable([])).toBe(false)
  })

  it('只要有一张画得出格子就不算空', () => {
    const config = {
      timezone: 'UTC',
      [METRIC_ITEMS_KEY]: [{ name: '能耗' }, { name: '产量' }],
    }
    const views = viewsOf(
      config,
      rowsOf({ seriesPoints: pointsOf([Date.UTC(2026, 2, 5), 1]) }),
      {
        [metricFieldKey(0)]: { state: 'ok' },
        [metricFieldKey(1)]: { state: 'error' },
      },
    )

    expect(emptyStateOf(config, views).isEmpty).toBe(false)
  })
})

describe('读屏摘要与值签名', () => {
  const config = {
    timezone: 'UTC',
    [METRIC_ITEMS_KEY]: [{ name: '能耗', unit: 'kWh' }, { name: '产量' }],
  }

  function mixed(): MetricView[] {
    return viewsOf(
      config,
      rowsOf({
        series: 2,
        seriesPoints: pointsOf(
          [Date.UTC(2026, 2, 5), 4],
          [Date.UTC(2026, 2, 6), 9],
          [Date.UTC(2026, 2, 7), 2],
        ),
      }),
      {
        [metricFieldKey(0)]: { state: 'ok' },
        [metricFieldKey(1)]: { state: 'error' },
      },
    )
  }

  it('摘要报得出画了几张、多少天、区间与没读数的那几张', () => {
    const summary = ariaSummaryOf(mixed())

    expect(summary).toContain('共 1 张')
    expect(summary).toContain('能耗 3 天，2kWh 至 9kWh')
    expect(summary).toContain('另有 1 张没有读数：产量（取不到）')
  })

  it('一张都没配来源时摘要给空串，免得读屏念一个没名字的图形', () => {
    expect(ariaSummaryOf([])).toBe('')
  })

  it('一张都画不出来时摘要也说得出这件事', () => {
    const views = viewsOf(config, rowsOf(), {
      [metricFieldKey(0)]: { state: 'pending' },
    })

    expect(ariaSummaryOf(views)).toContain('一天的读数都没取到')
  })

  it('天数与首尾都不变、只有最后一格在长时签名也跟着变', () => {
    const day = Date.UTC(2026, 2, 5)
    const before = viewsOf(
      config,
      rowsOf({ series: 4, seriesPoints: pointsOf([day, 4]) }),
    )
    const after = viewsOf(
      config,
      rowsOf({ series: 5, seriesPoints: pointsOf([day, 5]) }),
    )

    expect(signatureOf(before)).not.toBe(signatureOf(after))
  })

  it('同一批读数算出来的签名逐字相同', () => {
    const rows = rowsOf({
      series: 4,
      seriesPoints: pointsOf([Date.UTC(2026, 2, 5), 4]),
    })

    expect(signatureOf(viewsOf(config, rows))).toBe(
      signatureOf(viewsOf(config, rows)),
    )
  })
})

describe('绑点面板要的那两份', () => {
  it('行数与行标题都跟着配置里的指标走', () => {
    const config = { [METRIC_ITEMS_KEY]: [{ name: '能耗' }, {}] }

    expect(metricRowCounts(config)).toEqual({ dayValues: 2 })
    expect(metricRowLabels(config)[metricFieldKey(0)]).toEqual({
      title: '能耗',
      id: '能耗',
    })
    expect(metricRowLabels(config)[metricFieldKey(1)]?.title).toBe('第 2 张')
  })

  it('一张都没有时行数也给 0，不许把键漏掉', () => {
    expect(metricRowCounts({})).toEqual({ dayValues: 0 })
  })
})
