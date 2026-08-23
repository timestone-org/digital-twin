/**
 * @fileoverview 锁住趋势图的取值规则：只有数值列画得出、勾选到上限就停、
 * **没取过数的列一律不进图**，以及截断那句话必须说清砍掉的是哪一头。
 *
 * ⚠ 「画一条空曲线」与「这一列真的没数据」在图上长得一模一样，故那一条不是
 * 长相问题而是会让人去查采集的误导。
 */
import { describe, expect, it } from 'vitest'

import type { DatasetColumn } from '@dt/contracts'

import {
  MAX_TREND_SERIES,
  columnTrendItems,
  countTrendPoints,
  datasetChartSeries,
  isSelectionDirty,
  numericTrendColumns,
  pointChartSeries,
  seedTrendSelection,
  toggleTrendKey,
  truncationHint,
  type TrendItem,
} from '@/features/trend/trendSeries'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'power',
    name: '有功功率',
    unit: 'kW',
    decimals: 2,
    data_type: 'number',
    source: 'point',
    agg: 'avg',
    node_key: 's1:p1',
    formula: null,
    formula_deps: null,
    order_index: 0,
    is_required: false,
    default_value: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function item(key: string, unit = 'kW'): TrendItem {
  return { key, label: key, unit }
}

describe('哪些列画得出', () => {
  it('只有数值列进清单：文本与真假列画不成曲线', () => {
    const columns = [
      column({ key: 'a', data_type: 'number' }),
      column({ key: 'b', data_type: 'string' }),
      column({ key: 'c', data_type: 'bool' }),
    ]
    expect(numericTrendColumns(columns).map((one) => one.key)).toEqual(['a'])
  })

  it('量纲进标签，也当 Y 轴分组键——同量纲共用一条轴', () => {
    const [first] = columnTrendItems([column({ unit: 'kW' })])
    expect(first?.label).toBe('有功功率（kW）')
    expect(first?.unit).toBe('kW')
  })

  it('没有量纲的列不硬编一个括号出来', () => {
    const [first] = columnTrendItems([column({ unit: null })])
    expect(first?.label).toBe('有功功率')
  })
})

describe('勾选', () => {
  it('进来先勾上前几条，免得面板是一张空图', () => {
    const items = ['a', 'b', 'c', 'd'].map((key) => item(key))
    expect(seedTrendSelection(items)).toEqual(['a', 'b', 'c'])
  })

  it('再勾一条就取消：同一个入口既加又减', () => {
    expect(toggleTrendKey(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('到上限就不再加——再多既分不清颜色也读不出交叉', () => {
    const full = Array.from({ length: MAX_TREND_SERIES }, (_, at) => `k${at}`)
    expect(toggleTrendKey(full, 'extra')).toEqual(full)
  })
})

describe('摊成折线系列', () => {
  const items = [item('a'), item('b')]

  it('⚠ 勾了但这一次没取过数的列不进图，绝不画成一条空曲线', () => {
    const series = datasetChartSeries(
      { a: [{ ts: '2026-08-24T00:00:00.000Z', value: 1 }] },
      items,
      ['a', 'b'],
    )
    expect(series.map((one) => one.key)).toEqual(['a'])
  })

  it('取过数但确实没有点的列画得出来——那是「这段时间没有数据」', () => {
    const series = datasetChartSeries({ a: [] }, items, ['a'])
    expect(series).toHaveLength(1)
    expect(series[0]?.points).toEqual([])
  })

  it('精确小数按 string 回来时照样画得出', () => {
    const series = datasetChartSeries(
      { a: [{ ts: '2026-08-24T00:00:00.000Z', value: '1.25' }] },
      items,
      ['a'],
    )
    expect(series[0]?.points).toEqual([['2026-08-24T00:00:00.000Z', 1.25]])
  })

  it('认不出来的取值画成断档（null）而不是被跳过', () => {
    const series = datasetChartSeries(
      { a: [{ ts: '2026-08-24T00:00:00.000Z', value: '停机' }] },
      items,
      ['a'],
    )
    expect(series[0]?.points).toEqual([['2026-08-24T00:00:00.000Z', null]])
  })

  it('点位历史的毫秒时刻换成 RFC3339 再交给图', () => {
    const series = pointChartSeries(
      { a: [{ t: Date.parse('2026-08-24T00:00:00.000Z'), v: 3 }] },
      items,
      ['a'],
    )
    expect(series[0]?.points).toEqual([['2026-08-24T00:00:00.000Z', 3]])
  })

  it('数得出图上一共多少个点', () => {
    expect(
      countTrendPoints([
        { key: 'a', name: 'a', unit: '', axis: '', points: [['x', 1]] },
        { key: 'b', name: 'b', unit: '', axis: '', points: [] },
      ]),
    ).toBe(1)
  })
})

describe('勾选变脏', () => {
  it('还没查过时不算脏——那时图上本来就什么都没有', () => {
    expect(isSelectionDirty(false, ['a'], {})).toBe(false)
  })

  it('勾了一条这次没取过的列就算脏，得提示重查', () => {
    expect(isSelectionDirty(true, ['a', 'b'], { a: [] })).toBe(true)
  })

  it('勾选全在上一次结果里时不算脏', () => {
    expect(isSelectionDirty(true, ['a'], { a: [], b: [] })).toBe(false)
  })
})

describe('截断提示', () => {
  it('⚠ 台账序列砍掉的是更早那一段，必须说出来', () => {
    const text = truncationHint('earlier', 5000)
    expect(text).toContain('5000')
    expect(text).toContain('更早')
    expect(text).toContain('缩小')
  })

  it('⚠ 点位历史砍掉的是更晚那一段，两句话不许混用', () => {
    expect(truncationHint('later', 2000)).toContain('更晚')
  })
})
