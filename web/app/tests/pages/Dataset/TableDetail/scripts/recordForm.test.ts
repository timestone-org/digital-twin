/**
 * @fileoverview 锁住录入表单的提交口径：点位汇总列只提交动过的那几格
 * （原样回传会给整行凭空打上人工修正角标），人工录入列反过来必须整份提交
 * （后端的必填校验看的是提交后的整行）。
 */
import { describe, expect, it } from 'vitest'
import type { DatasetColumn, DatasetRecord } from '@dt/contracts'

import {
  formulaColumns,
  recordFormOf,
  toRecordInput,
  writableColumns,
  writeHint,
} from '@/pages/Dataset/TableDetail/scripts/recordForm'

const STAMP = '2026-01-01T00:00:00.000Z'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'inflow',
    name: '进水量',
    unit: null,
    decimals: null,
    data_type: 'number',
    source: 'manual',
    agg: 'avg',
    node_key: null,
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

const POINT_COLUMN = column({
  id: 'c2',
  key: 'kwh',
  name: '用电量',
  source: 'point',
})

const COLUMNS = [
  column({ id: 'c1', key: 'inflow', name: '进水量' }),
  POINT_COLUMN,
  column({ id: 'c3', key: 'on', name: '在运', data_type: 'bool' }),
  column({
    id: 'c4',
    key: 'ratio',
    name: '单耗',
    source: 'formula',
    formula: '{kwh}/{inflow}',
  }),
]

function record(over: Partial<DatasetRecord> = {}): DatasetRecord {
  return {
    row_id: 'r1',
    ts: '2026-02-02T03:04:00.000Z',
    values: { inflow: 12, kwh: 34, on: true },
    overrides: null,
    samples: null,
    computed: { ratio: 2.8 },
    compute_error: null,
    source: 'collect',
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

describe('哪几列能填', () => {
  it('公式列只读展示，不进可填区', () => {
    expect(writableColumns(COLUMNS).map((one) => one.key)).toEqual([
      'inflow',
      'kwh',
      'on',
    ])
    expect(formulaColumns(COLUMNS).map((one) => one.key)).toEqual(['ratio'])
  })
})

describe('打开表单时的初值', () => {
  it('编辑时按这一行的生效值回填，数据时间也用这一行的', () => {
    const form = recordFormOf(record(), COLUMNS)
    expect(form.ts).toBe('2026-02-02T03:04:00.000Z')
    expect(form.texts.inflow).toBe('12')
    expect(form.flags.on).toBe(true)
  })

  it('新建时数据时间默认此刻，人工录入列吃默认值', () => {
    const at = new Date('2026-05-05T06:00:00.000Z')
    const form = recordFormOf(
      null,
      [column({ default_value: 5 }), POINT_COLUMN],
      at,
    )
    expect(form.ts).toBe('2026-05-05T06:00:00.000Z')
    expect(form.texts.inflow).toBe('5')
  })

  it('⚠ 新建时点位汇总列一律留空：填上什么，保存时就等于替它建了一格修正', () => {
    const form = recordFormOf(
      null,
      [column({ key: 'kwh', source: 'point', default_value: 99 })],
      new Date(STAMP),
    )
    expect(form.texts.kwh).toBe('')
  })
})

describe('提交载荷', () => {
  it('⚠ 没动过的点位汇总列不提交：原样回传会给它凭空打上修正角标', () => {
    const opened = recordFormOf(record(), COLUMNS)
    const form = recordFormOf(record(), COLUMNS)
    form.texts.inflow = '20'
    const input = toRecordInput(form, opened, COLUMNS)
    expect(input.values).toHaveProperty('inflow', '20')
    expect(input.values).not.toHaveProperty('kwh')
  })

  it('动过的点位汇总列才提交，那一格才会被记成人工修正', () => {
    const opened = recordFormOf(record(), COLUMNS)
    const form = recordFormOf(record(), COLUMNS)
    form.texts.kwh = '77'
    expect(toRecordInput(form, opened, COLUMNS).values.kwh).toBe('77')
  })

  it('清空点位汇总列提交的是空值——那是「撤销这一格的修正」', () => {
    const opened = recordFormOf(record(), COLUMNS)
    const form = recordFormOf(record(), COLUMNS)
    form.texts.kwh = ''
    const input = toRecordInput(form, opened, COLUMNS)
    expect(Object.hasOwn(input.values, 'kwh')).toBe(true)
    expect(input.values.kwh).toBeNull()
  })

  it('⚠ 人工录入列一格没动也照样整份提交：后端的必填校验看的是提交后的整行', () => {
    const opened = recordFormOf(record(), COLUMNS)
    const form = recordFormOf(record(), COLUMNS)
    const input = toRecordInput(form, opened, COLUMNS)
    expect(Object.keys(input.values).sort()).toEqual(['inflow', 'on'])
  })

  it('公式列一个都不提交：它由后端算，手填的会被拒', () => {
    const opened = recordFormOf(record(), COLUMNS)
    expect(toRecordInput(opened, opened, COLUMNS).values).not.toHaveProperty(
      'ratio',
    )
  })

  it('布尔列被拨动才算动过', () => {
    const opened = recordFormOf(record(), COLUMNS)
    const form = recordFormOf(record(), COLUMNS)
    form.flags.on = false
    expect(toRecordInput(form, opened, COLUMNS).values.on).toBe(false)
  })
})

describe('填写提示', () => {
  it('⚠ 点位汇总列必须先说清「填了会记为人工修正」', () => {
    expect(writeHint(column({ source: 'point' }), null)).toContain('人工修正')
  })

  it('已经有修正的那一格改说「清空即撤销」', () => {
    const row = record({
      overrides: {
        kwh: { value: 1, by: 'u1', by_name: '张工', at: STAMP, reason: null },
      },
    })
    expect(writeHint(column({ key: 'kwh', source: 'point' }), row)).toContain(
      '撤销修正',
    )
  })

  it('必填的人工录入列说一句必填，其余不啰嗦', () => {
    expect(writeHint(column({ is_required: true }), null)).toBe('必填')
    expect(writeHint(column(), null)).toBe('')
  })
})
