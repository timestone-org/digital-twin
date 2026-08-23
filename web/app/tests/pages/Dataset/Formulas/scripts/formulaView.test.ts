/**
 * @fileoverview 公式库列表的纯展示逻辑：分类文案、本地搜索、分组排序，
 * 以及「改完这一条影响了谁」那句回执。
 *
 * ⚠ 回执那几条是产品判断而不是文案：只有口径变了才提重算——改个名字也劝人
 * 跑一遍全表重算，是让人白付一次代价。
 */
import { describe, expect, it } from 'vitest'
import type { DatasetFormulaDef, DatasetFormulaUsage } from '@dt/contracts'

import {
  affectedCounts,
  categoryLabel,
  categoryOptions,
  groupFormulas,
  matchesKeyword,
  savedMessage,
  usageRows,
} from '@/pages/Dataset/Formulas/scripts/formulaView'

const STAMP = '2026-01-01T00:00:00.000Z'

function def(over: Partial<DatasetFormulaDef> = {}): DatasetFormulaDef {
  return {
    id: 'f1',
    code: '同比增长率',
    name: '同比增长率',
    category: 'trend',
    expression:
      '({本期} - PREV({本期}, {周期数})) / PREV({本期}, {周期数}) * 100',
    params: [],
    description: '与上一周期同期相比',
    is_builtin: true,
    is_enabled: true,
    signature: '@同比增长率(本期, 周期数)',
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function usage(over: Partial<DatasetFormulaUsage> = {}): DatasetFormulaUsage {
  return {
    table_id: 't1',
    table_code: 'energy',
    table_name: '能耗台账',
    column_id: 'c1',
    column_key: '同比',
    column_name: '同比增长',
    formula: '@同比增长率({电耗}, 12)',
    is_direct: true,
    ...over,
  }
}

describe('分类文案', () => {
  it('表里有的给中文名', () => {
    expect(categoryLabel('energy')).toBe('能源')
  })

  it('⚠ 表里没有的照原样显示，绝不藏起来——它在台账列里照样能被调用', () => {
    expect(categoryLabel('从未见过')).toBe('从未见过')
  })

  it('下拉里把当前那个表外分类补进去，免得一存就被改成别的分类', () => {
    const values = categoryOptions('从未见过').map((one) => one.value)
    expect(values).toContain('从未见过')
  })

  it('当前分类是表内的就不多补一项', () => {
    expect(categoryOptions('trend')).toHaveLength(5)
  })
})

describe('本地搜索', () => {
  it('标识、名称、说明、公式体四处都算命中', () => {
    const formula = def({ code: 'abc', name: '甲', description: '乙' })
    expect(matchesKeyword(formula, 'abc')).toBe(true)
    expect(matchesKeyword(formula, '甲')).toBe(true)
    expect(matchesKeyword(formula, '乙')).toBe(true)
    expect(matchesKeyword(formula, 'PREV')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(matchesKeyword(def({ code: 'ABC' }), 'abc')).toBe(true)
  })

  it('空关键词一律命中', () => {
    expect(matchesKeyword(def(), '   ')).toBe(true)
  })
})

describe('按分类分组', () => {
  it('同一分类聚在一起，组内按名称排', () => {
    const groups = groupFormulas(
      [
        def({ id: '1', name: '乙', category: 'basic' }),
        def({ id: '2', name: '甲', category: 'basic' }),
      ],
      '',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.items.map((one) => one.name)).toEqual(['甲', '乙'])
  })

  it('分组顺序按分类显示名排', () => {
    const groups = groupFormulas(
      [
        def({ id: '1', category: 'trend' }),
        def({ id: '2', category: 'basic' }),
      ],
      '',
    )
    expect(groups.map((one) => one.label)).toEqual(['基础', '趋势'])
  })

  it('筛掉之后空了的分组不出现', () => {
    const groups = groupFormulas(
      [
        def({ id: '1', code: '甲', name: '甲', category: 'trend' }),
        def({ id: '2', code: '乙', name: '乙', category: 'basic' }),
      ],
      '甲',
    )
    expect(groups.map((one) => one.key)).toEqual(['trend'])
  })
})

describe('引用面', () => {
  it('给每一行补上 DtDataView 要的 id——后端给的是 column_id', () => {
    expect(usageRows([usage({ column_id: 'c9' })])[0]?.id).toBe('c9')
  })

  it('⚠ 列数与台账数分开数：同一张表里三列调它，是 3 个列 1 张表', () => {
    const counts = affectedCounts([
      usage({ column_id: 'c1' }),
      usage({ column_id: 'c2' }),
      usage({ column_id: 'c3' }),
    ])
    expect(counts).toEqual({ columns: 3, tables: 1 })
  })
})

describe('保存回执', () => {
  it('没人引用时说清「还没人用它」，不摆一个吓人的数字', () => {
    expect(savedMessage([], true)).toContain('还没有台账列在用它')
  })

  it('改了口径就报出跟着走的列数与要重算这件事', () => {
    const message = savedMessage([usage(), usage({ column_id: 'c2' })], true)
    expect(message).toContain('2 个台账列')
    expect(message).toContain('1 张台账')
    expect(message).toContain('重算')
  })

  it('⚠ 只改名称时不提重算：那时说要重算是一句假话，且要白跑一遍全表', () => {
    const message = savedMessage([usage()], false)
    expect(message).toContain('1 个台账列')
    expect(message).not.toContain('重算')
  })
})
