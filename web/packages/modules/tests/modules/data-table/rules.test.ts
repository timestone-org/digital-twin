/**
 * @fileoverview 守 data-table 的值规则多出来的那一件事——每条规则挑一列。
 * 判据与颜色的口径整份复用 `shared/valueRules.ts`，这里只钉「挑列」这一层，
 * 外加一条最容易写错的：脏行被丢掉时，它挑的那一列必须跟着一起丢。
 */
import { describe, expect, it } from 'vitest'

import {
  evaluateTableRules,
  normalizeTableRules,
  TABLE_RULES_KEY,
  tableRulesField,
  withColumnPicker,
} from '../../../src/modules/data-table/rules'

const LOW = { op: 'lt', value: 90, level: 'danger', label: '偏低' }
const HIGH = { op: 'gt', value: 120, level: 'warning', label: '偏高' }

describe('规则的归一化', () => {
  it('挑了列就记下列键，没挑的记成空串（管全部列）', () => {
    const rules = normalizeTableRules([{ ...LOW, column: 'c3' }, { ...HIGH }])

    expect(rules.map((entry) => entry.column)).toEqual(['c3', ''])
  })

  it('列键认不出的回落成「全部列」，不静默挑走一列', () => {
    expect(normalizeTableRules([{ ...LOW, column: 'zzz' }])[0]?.column).toBe('')
  })

  it('判不出运算符或阈值的那一行整条丢掉', () => {
    expect(
      normalizeTableRules([
        { ...LOW, op: '???' },
        { ...LOW, value: 'x' },
        { ...LOW, column: 'c2' },
      ]).map((entry) => entry.column),
    ).toEqual(['c2'])
  })

  // ⚠ 这条是本文件存在的理由：先整表规整再配对列号会让脏行之后的每条规则
  //   都改判前一条挑的列，而两边都不报错
  it('脏行被丢掉时它挑的列一起丢，其后的规则不改判别人的列', () => {
    const rules = normalizeTableRules([
      { ...LOW, column: 'c1', op: '???' },
      { ...LOW, column: 'c2' },
      { ...HIGH, column: 'c3' },
    ])

    expect(rules.map((entry) => entry.column)).toEqual(['c2', 'c3'])
  })

  it('认不出的整表原值给空表，不抛', () => {
    expect(normalizeTableRules(undefined)).toEqual([])
    expect(normalizeTableRules('不是数组')).toEqual([])
  })
})

describe('求值', () => {
  const RULES = normalizeTableRules([
    { ...LOW, column: 'c1' },
    { ...HIGH, column: '' },
  ])

  it('挑了列的规则只判那一列', () => {
    expect(evaluateTableRules(80, 'c1', RULES)?.label).toBe('偏低')
    expect(evaluateTableRules(80, 'c2', RULES)).toBeNull()
  })

  it('挑「全部列」的规则每一列都判', () => {
    expect(evaluateTableRules(130, 'c5', RULES)?.label).toBe('偏高')
  })

  it('按声明序取首个命中', () => {
    const ordered = normalizeTableRules([
      { ...HIGH, column: '', value: 10 },
      { ...LOW, column: '', op: 'gt', value: 20 },
    ])

    expect(evaluateTableRules(50, 'c1', ordered)?.label).toBe('偏高')
  })

  it('缺值与非数一律不命中', () => {
    expect(evaluateTableRules(null, 'c1', RULES)).toBeNull()
    expect(evaluateTableRules('80', 'c1', RULES)).toBeNull()
  })

  it('规则自己的颜色压过严重度语义色', () => {
    const painted = normalizeTableRules([
      { ...LOW, column: '', color: 'var(--accent-secondary)' },
    ])

    expect(evaluateTableRules(1, 'c1', painted)?.color).toBe(
      'var(--accent-secondary)',
    )
  })
})

describe('配置字段', () => {
  it('用的是共用那一份的键，不另起一个', () => {
    expect(tableRulesField().key).toBe(TABLE_RULES_KEY)
  })

  it('「管哪一列」插在最前面，后面仍是共用那一份的判据字段', () => {
    const keys = (tableRulesField().itemSchema ?? []).map((field) => field.key)

    expect(keys[0]).toBe('column')
    expect(keys).toContain('op')
    expect(keys).toContain('value')
    expect(keys).toContain('color')
  })

  it('底子里一格子字段都没有时，插出来的就只有「管哪一列」这一格', () => {
    const bare = withColumnPicker({ key: 'x', label: '空底子', type: 'array' })

    expect((bare.itemSchema ?? []).map((item) => item.key)).toEqual(['column'])
  })

  it('列的下拉里第一项是「全部列」，其余是八个列键', () => {
    const [column] = tableRulesField().itemSchema ?? []
    const values = (column?.options ?? []).map((option) => option.value)

    expect(values).toEqual(['', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'])
  })
})
