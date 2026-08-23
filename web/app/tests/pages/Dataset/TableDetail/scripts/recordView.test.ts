/**
 * @fileoverview 锁住数据表格一格的取值与标记口径：三层取值绝不叠第二次修正、
 * 「一条没采到」与「值是空的」是两句话、角标分得清人改的与迁移带进来的、
 * 撤销确认里不许出现一个具体的数。
 */
import { describe, expect, it } from 'vitest'
import type {
  DatasetColumn,
  DatasetOverride,
  DatasetRecord,
} from '@dt/contracts'

import {
  cellValue,
  computeErrorOf,
  formatCell,
  isRangeInverted,
  medianOf,
  overrideBadge,
  overrideStats,
  pageRange,
  recomputeReceipt,
  revokeCellMessage,
  sampleLevel,
  sampleMedians,
  sampleTip,
  toRecordRows,
  type RecordRow,
} from '@/pages/Dataset/TableDetail/scripts/recordView'

const STAMP = '2026-01-01T00:00:00.000Z'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'kwh',
    name: '用电量',
    unit: 'kWh',
    decimals: null,
    data_type: 'number',
    source: 'point',
    agg: 'avg',
    node_key: 'src1:meter.kwh',
    formula: null,
    formula_deps: null,
    order_index: 0,
    is_required: false,
    default_value: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function record(over: Partial<DatasetRecord> = {}): DatasetRecord {
  return {
    row_id: 'r1',
    ts: STAMP,
    values: {},
    overrides: null,
    samples: null,
    computed: {},
    compute_error: null,
    source: 'collect',
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

/** 一行 → 表格行。取不到就当场喊出来，别把 `undefined` 喂进被测函数。 */
function oneRow(row: DatasetRecord): RecordRow {
  const made = toRecordRows([row])[0]
  if (made === undefined) throw new Error('这一行没能转成表格行')
  return made
}

function override(over: Partial<DatasetOverride> = {}): DatasetOverride {
  return {
    value: 42,
    by: 'u1',
    by_name: '张工',
    at: STAMP,
    reason: null,
    ...over,
  }
}

describe('三层取值', () => {
  it('求值失败的那一格先于取值：错误一旦被值盖住就再没人看得见', () => {
    const row = record({
      computed: { ratio: 1 },
      compute_error: { ratio: '除数为零' },
    })
    expect(computeErrorOf(row, 'ratio')).toBe('除数为零')
  })

  it('公式列读 computed，其余读 values', () => {
    const row = record({ values: { kwh: 10 }, computed: { kwh: 999 } })
    expect(cellValue(column(), row)).toBe(10)
    expect(cellValue(column({ source: 'formula' }), row)).toBe(999)
  })

  it('⚠ values 已经是修正后的生效值，取值绝不再叠一次 overrides', () => {
    const row = record({
      values: { kwh: 7 },
      overrides: { kwh: override({ value: 999 }) },
    })
    expect(cellValue(column(), row)).toBe(7)
  })
})

describe('一格的展示串', () => {
  it('空值给破折号，但 0 是个真实读数', () => {
    expect(formatCell(null, column())).toBe('—')
    expect(formatCell(0, column())).toBe('0')
  })

  it('配了小数位就按小数位显示，没配也不摊成一屏浮点误差', () => {
    expect(formatCell(1.5, column({ decimals: 3 }))).toBe('1.500')
    expect(formatCell(0.1 + 0.2, column())).toBe('0.3')
  })

  it('布尔说是与否，对象原样序列化而不是显示成空', () => {
    expect(formatCell(true, column({ data_type: 'bool' }))).toBe('是')
    expect(formatCell({ a: 1 }, column())).toBe('{"a":1}')
  })
})

describe('样本数标记', () => {
  it('⚠ 一条都没采到与「值是空的」是两句话', () => {
    const level = sampleLevel(0, { agg: 'avg', median: 100 })
    expect(level).toBe('empty')
    expect(sampleTip(0, level)).toContain('一条样本都没采到')
    expect(sampleTip(0, level)).toContain('不是「值是空的」')
  })

  it('样本太少说清是几条，而不是只说「少」', () => {
    const level = sampleLevel(2, { agg: 'avg', median: 100 })
    expect(level).toBe('low')
    expect(sampleTip(2, level)).toContain('2 个样本')
  })

  it('不足本页中位数两成也算少：仪表半路断连就是这样露出来的', () => {
    expect(sampleLevel(5, { agg: 'avg', median: 100 })).toBe('low')
    expect(sampleLevel(50, { agg: 'avg', median: 100 })).toBe('ok')
  })

  it('中位数本身太小就不做相对判断——3 条对 10 条说明不了什么', () => {
    expect(sampleLevel(1, { agg: 'avg', median: 9 })).toBe('low')
    expect(sampleLevel(4, { agg: 'avg', median: 9 })).toBe('ok')
  })

  it('末值与样本数这两种口径一条样本就够，不该被标成「样本少」', () => {
    expect(sampleLevel(1, { agg: 'last', median: 100 })).toBe('ok')
    expect(sampleLevel(1, { agg: 'count', median: 100 })).toBe('ok')
  })

  it('这一列压根不谈样本时不挂任何标记', () => {
    const level = sampleLevel(undefined, { agg: 'avg', median: null })
    expect(level).toBe('unknown')
    expect(sampleTip(undefined, level)).toBe('')
  })

  it('中位数取中间那个，空集合给 null 表示没有基准', () => {
    expect(medianOf([1, 100, 3])).toBe(3)
    expect(medianOf([2, 4])).toBe(3)
    expect(medianOf([])).toBeNull()
  })

  it('⚠ 0 条的桶不进中位数：进了会把整列门槛拉到 0，再没一格会被标出来', () => {
    const rows = toRecordRows([
      record({ row_id: 'a', samples: { kwh: 0 } }),
      record({ row_id: 'b', samples: { kwh: 100 } }),
      record({ row_id: 'c', samples: { kwh: 120 } }),
    ])
    expect(sampleMedians([column()], rows).kwh).toBe(110)
  })
})

describe('人工修正角标', () => {
  it('人改的用铅笔与主题色，说得出谁改的、什么时候、为什么', () => {
    const badge = overrideBadge(override({ reason: '仪表故障，按抄表值填' }))
    expect(badge.icon).toBe('pencil')
    expect(badge.toneClass).toContain('accent')
    expect(badge.tip).toContain('张工')
    expect(badge.tip).toContain('仪表故障')
  })

  it('⚠ 迁移带进来的换图标换措辞：那不是本期有人动过手', () => {
    const badge = overrideBadge(override({ by: null, by_name: null }))
    expect(badge.icon).toBe('database')
    expect(badge.toneClass).not.toContain('accent')
    expect(badge.tip).toContain('数据迁移')
    expect(badge.tip).toContain('不是本期有人改动')
  })

  it('改的人被删了账号也答得出「谁改的」这一问，不显示成空', () => {
    expect(overrideBadge(override({ by_name: null })).tip).toContain('未知用户')
  })
})

describe('撤销单格的确认文案', () => {
  const row = oneRow(record({ overrides: { kwh: override({ value: 42 }) } }))

  it('⚠ 不许承诺撤销后是哪个数——自动值不在任何一个响应里', () => {
    const message = revokeCellMessage({
      row,
      columnKey: 'kwh',
      columnName: '用电量',
    })
    expect(message).toContain('可能与现在不同')
    expect(message).toContain('会变成空')
    expect(message).not.toContain('42')
  })

  it('迁移带进来的那一格，措辞跟着换', () => {
    const migrated = oneRow(
      record({ overrides: { kwh: override({ by: null }) } }),
    )
    const message = revokeCellMessage({
      row: migrated,
      columnKey: 'kwh',
      columnName: '用电量',
    })
    expect(message).toContain('数据迁移')
  })
})

describe('本页的修正总览', () => {
  const rows = toRecordRows([
    record({ row_id: 'a', overrides: { kwh: override() } }),
    record({
      row_id: 'b',
      overrides: { kwh: override({ by: null }), gone: override() },
    }),
  ])

  it('迁移那一批单独数出来，免得看见一片角标以为有人在动数据', () => {
    const stats = overrideStats([column()], rows)
    expect(stats.total).toBe(2)
    expect(stats.migration).toBe(1)
  })

  it('⚠ 已删列的残留修正不计入：用户会去找一个根本看不见的角标', () => {
    expect(overrideStats([column()], rows).keys).toEqual(['kwh'])
  })
})

describe('批量撤销的默认范围', () => {
  it('取当前这一页的最早与最晚时刻，而不是「不限」', () => {
    const rows = toRecordRows([
      record({ row_id: 'a', ts: '2026-03-01T00:00:00.000Z' }),
      record({ row_id: 'b', ts: '2026-01-01T00:00:00.000Z' }),
      record({ row_id: 'c', ts: '2026-02-01T00:00:00.000Z' }),
    ])
    expect(pageRange(rows)).toEqual({
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-03-01T00:00:00.000Z',
    })
  })

  it('一行都没有时两端都空，那时「不限」是唯一说得出口的范围', () => {
    expect(pageRange([])).toEqual({ since: '', until: '' })
  })

  it('⚠ 两端小数位不一样也不该在同一秒里判反', () => {
    expect(
      isRangeInverted('2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z'),
    ).toBe(false)
    expect(
      isRangeInverted('2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ).toBe(true)
  })

  it('任一端留空即不限，那时无所谓先后', () => {
    expect(isRangeInverted('', '2026-01-01T00:00:00.000Z')).toBe(false)
  })
})

describe('重算回执', () => {
  it('触顶必须说出来：它和算完了长得一模一样', () => {
    const receipt = recomputeReceipt({
      recomputed: 5000,
      failed: 0,
      is_truncated: true,
      limit: 5000,
    })
    expect(receipt.isPartial).toBe(true)
    expect(receipt.text).toContain('触顶')
    expect(receipt.text).toContain('5000')
  })

  it('有行求值出错时点名条数，而不是笼统说成功', () => {
    const receipt = recomputeReceipt({
      recomputed: 10,
      failed: 3,
      is_truncated: false,
      limit: 5000,
    })
    expect(receipt.isPartial).toBe(true)
    expect(receipt.text).toContain('3 行求值出错')
  })

  it('全算完且一行没错才是干净的成功', () => {
    const receipt = recomputeReceipt({
      recomputed: 10,
      failed: 0,
      is_truncated: false,
      limit: 5000,
    })
    expect(receipt).toEqual({ text: '已重算 10 行', isPartial: false })
  })
})
