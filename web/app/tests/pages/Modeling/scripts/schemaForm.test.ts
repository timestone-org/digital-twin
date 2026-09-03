/**
 * @fileoverview 算子 schema 摊成字段表的口径：`$ref` 解引用、三种自定义控件、
 * 枚举选项文案的成对写法，以及初值。
 */
import { describe, expect, it } from 'vitest'

import {
  defaultsOf,
  fieldsOf,
} from '@/pages/Modeling/Canvas/scripts/schemaForm'

const LEDGER_SCHEMA = {
  $defs: {
    RowSource: { enum: ['collect', 'manual', 'all'], type: 'string' },
  },
  properties: {
    table_code: {
      title: '数据台账',
      type: 'string',
      'x-dt-widget': 'table',
    },
    columns: {
      title: '取哪些列',
      type: 'array',
      items: { type: 'string' },
      'x-dt-widget': 'column',
    },
    since: { title: '起始时刻', type: 'string', 'x-dt-widget': 'moment' },
    row_source: {
      $ref: '#/$defs/RowSource',
      default: 'collect',
      description: 'collect=按周期聚合；manual=人工录入；all=全要',
      title: '行来源',
    },
    row_limit: {
      default: 50_000,
      maximum: 200_000,
      minimum: 1,
      title: '行数上限',
      type: 'integer',
    },
    keep_first: { default: true, title: '只留第一条', type: 'boolean' },
    target_column: {
      title: '目标列',
      type: 'string',
      'x-dt-widget': 'column',
    },
  },
  required: ['table_code'],
  type: 'object',
}

describe('把算子 schema 摊成字段表', () => {
  it('三个自定义标记各自映射到自己的控件', () => {
    const byKey = new Map(fieldsOf(LEDGER_SCHEMA).map((f) => [f.key, f]))

    expect(byKey.get('table_code')?.widget).toBe('table')
    expect(byKey.get('columns')?.widget).toBe('columns')
    expect(byKey.get('since')?.widget).toBe('moment')
  })

  // ⚠ 同一个标记挂在单值字段（切分的「目标列」）与数组字段上，一律当多选渲染
  // 的话，单值字段会被存成数组——typecheck 与 lint 都不拦，要到后端才报
  it('列引用按 schema 的类型分成单选与多选两种控件', () => {
    const byKey = new Map(fieldsOf(LEDGER_SCHEMA).map((f) => [f.key, f]))

    expect(byKey.get('target_column')?.widget).toBe('column')
  })

  it('单值列引用的初值是空串而不是空数组', () => {
    const config = defaultsOf(fieldsOf(LEDGER_SCHEMA))

    expect(config['target_column']).toBe('')
  })

  it('没有标记时按 JSON Schema 的类型选控件', () => {
    const byKey = new Map(fieldsOf(LEDGER_SCHEMA).map((f) => [f.key, f]))

    expect(byKey.get('row_limit')?.widget).toBe('integer')
    expect(byKey.get('keep_first')?.widget).toBe('switch')
  })

  it('枚举跟着 $ref 跳进 $defs，不会退化成自由文本框', () => {
    const field = fieldsOf(LEDGER_SCHEMA).find((f) => f.key === 'row_source')

    expect(field?.widget).toBe('select')
    expect(field?.options.map((o) => o.value)).toEqual([
      'collect',
      'manual',
      'all',
    ])
  })

  it('描述里的「值=说明」成对写法当作选项文案', () => {
    const field = fieldsOf(LEDGER_SCHEMA).find((f) => f.key === 'row_source')

    expect(field?.options.map((o) => o.label)).toEqual([
      '按周期聚合',
      '人工录入',
      '全要',
    ])
  })

  it('成对写法只覆盖了一部分枚举值时，一个都不用', () => {
    const partial = {
      $defs: { Mode: { enum: ['a', 'b'], type: 'string' } },
      properties: {
        mode: { $ref: '#/$defs/Mode', description: 'a=甲' },
      },
    }

    const field = fieldsOf(partial)[0]

    expect(field?.options.map((o) => o.label)).toEqual(['a', 'b'])
  })

  it('上下限与必填原样带出来', () => {
    const byKey = new Map(fieldsOf(LEDGER_SCHEMA).map((f) => [f.key, f]))

    expect(byKey.get('row_limit')?.min).toBe(1)
    expect(byKey.get('row_limit')?.max).toBe(200_000)
    expect(byKey.get('table_code')?.isRequired).toBe(true)
    expect(byKey.get('since')?.isRequired).toBe(false)
  })

  it('认不出的属性形状不会让整份 schema 崩掉', () => {
    const junk = { properties: { odd: 42 }, required: 'not-a-list' }

    const field = fieldsOf(junk)[0]

    expect(field?.key).toBe('odd')
    expect(field?.widget).toBe('text')
    expect(field?.isRequired).toBe(false)
  })
})

describe('一份参数的初值', () => {
  it('schema 写了默认就用它', () => {
    const config = defaultsOf(fieldsOf(LEDGER_SCHEMA))

    expect(config['row_source']).toBe('collect')
    expect(config['row_limit']).toBe(50_000)
    expect(config['keep_first']).toBe(true)
  })

  it('没写默认的按控件给空值，不留 undefined', () => {
    const config = defaultsOf(fieldsOf(LEDGER_SCHEMA))

    expect(config['table_code']).toBe('')
    expect(config['columns']).toEqual([])
    expect(Object.values(config).some((v) => v === undefined)).toBe(false)
  })
})
