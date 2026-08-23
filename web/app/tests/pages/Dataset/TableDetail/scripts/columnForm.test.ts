/**
 * @fileoverview 列表单的纯逻辑：标识建议保留中文、校验逐条对上后端约束、
 * 切来源时另外两档的字段一并清空、补丁里没有 key。
 */
import { describe, expect, it } from 'vitest'
import type { DatasetColumn } from '@dt/contracts'

import {
  emptyColumnForm,
  formStateOf,
  hasNoError,
  parseDefaultValue,
  suggestKey,
  toCreateInput,
  toPatchInput,
  validateColumnForm,
  type ColumnFormState,
} from '@/pages/Dataset/TableDetail/scripts/columnForm'

const STAMP = '2026-01-01T00:00:00.000Z'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: '进水量',
    name: '进水量',
    unit: 'm³',
    decimals: 2,
    data_type: 'number',
    source: 'point',
    agg: 'delta',
    node_key: 'src1:meter.kwh',
    formula: null,
    formula_deps: null,
    order_index: 3,
    is_required: true,
    default_value: 12,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function form(over: Partial<ColumnFormState> = {}): ColumnFormState {
  return { ...emptyColumnForm(), key: 'k', name: '名称', ...over }
}

describe('标识建议', () => {
  it('⚠ 中文原样留着：公式里写 {进水量} 比 {inflow} 直观，后端也放行', () => {
    expect(suggestKey('进水量')).toBe('进水量')
  })

  it('只把会让公式歧义的字符换掉', () => {
    expect(suggestKey('进水量 (m³)')).toBe('进水量_m³')
    expect(suggestKey('a.b:c')).toBe('a_b_c')
  })

  it('首尾不留下划线', () => {
    expect(suggestKey('  进水量  ')).toBe('进水量')
  })
})

describe('铺回表单', () => {
  it('打开编辑时每一格都是库里的现值', () => {
    const state = formStateOf(column())
    expect(state.key).toBe('进水量')
    expect(state.agg).toBe('delta')
    expect(state.nodeKey).toBe('src1:meter.kwh')
    expect(state.decimals).toBe(2)
    expect(state.isRequired).toBe(true)
  })

  it('⚠ 默认值不走 String()：对象会变成 [object Object]，再也存不回去', () => {
    expect(formStateOf(column({ default_value: { a: 1 } })).defaultValue).toBe(
      '{"a":1}',
    )
    expect(formStateOf(column({ default_value: null })).defaultValue).toBe('')
    expect(formStateOf(column({ default_value: false })).defaultValue).toBe(
      'false',
    )
  })

  it('新增时是一份空表单', () => {
    expect(formStateOf(null).key).toBe('')
    expect(formStateOf(null).source).toBe('manual')
  })
})

describe('校验', () => {
  it('名称与标识都不许空——保存键在 form 之外，原生 required 永远不触发', () => {
    const found = validateColumnForm(form({ key: '', name: ' ' }), false)
    expect(found.key).not.toBe('')
    expect(found.name).not.toBe('')
    expect(hasNoError(found)).toBe(false)
  })

  it('标识的字符集与后端 pattern 同集合', () => {
    expect(validateColumnForm(form({ key: 'a b' }), false).key).not.toBe('')
    expect(validateColumnForm(form({ key: 'a{b}' }), false).key).not.toBe('')
    expect(validateColumnForm(form({ key: '进水量_1' }), false).key).toBe('')
  })

  it('编辑态不再校验标识：那一格是禁用的，报错指不到任何能改的地方', () => {
    expect(validateColumnForm(form({ key: 'a b' }), true).key).toBe('')
  })

  it('点位列必须给点位标识，且短于后端下界就报错', () => {
    expect(
      validateColumnForm(form({ source: 'point', nodeKey: '' }), false).nodeKey,
    ).not.toBe('')
    expect(
      validateColumnForm(form({ source: 'point', nodeKey: 'a:b' }), false)
        .nodeKey,
    ).toBe('')
  })

  it('公式列必须写公式', () => {
    expect(
      validateColumnForm(form({ source: 'formula', formula: '  ' }), false)
        .formula,
    ).not.toBe('')
  })

  it('人工录入列不因为空的点位标识或空公式被拦住', () => {
    expect(hasNoError(validateColumnForm(form(), false))).toBe(true)
  })
})

describe('默认值解析', () => {
  it('按列的数据类型存原值保类型', () => {
    expect(
      parseDefaultValue(form({ dataType: 'number', defaultValue: '3.5' })),
    ).toBe(3.5)
    expect(
      parseDefaultValue(form({ dataType: 'bool', defaultValue: '是' })),
    ).toBe(true)
    expect(
      parseDefaultValue(form({ dataType: 'bool', defaultValue: 'no' })),
    ).toBe(false)
    expect(
      parseDefaultValue(form({ dataType: 'string', defaultValue: ' x ' })),
    ).toBe('x')
  })

  it('⚠ 数值填不成数值时落 null 而不是 NaN：空的默认值只是「不预填」', () => {
    expect(
      parseDefaultValue(form({ dataType: 'number', defaultValue: '是' })),
    ).toBeNull()
    expect(parseDefaultValue(form({ defaultValue: '' }))).toBeNull()
  })
})

describe('出参组装', () => {
  it('⚠ 切成人工录入后点位与公式一并清空：不清的话下次改回来会拿到旧绑定', () => {
    const input = toCreateInput(
      form({ source: 'manual', nodeKey: 'src1:x', formula: '{a}+1' }),
    )
    expect(input.node_key).toBeNull()
    expect(input.formula).toBeNull()
  })

  it('非点位列也给一个合法的 agg——后端那一列 NOT NULL', () => {
    expect(toCreateInput(form({ source: 'manual' })).agg).toBe('avg')
    expect(toCreateInput(form({ source: 'point', agg: 'sum' })).agg).toBe('sum')
  })

  it('必填与默认值只对人工录入列有意义', () => {
    const input = toCreateInput(
      form({ source: 'point', isRequired: true, defaultValue: '7' }),
    )
    expect(input.is_required).toBe(false)
    expect(input.default_value).toBeNull()
  })

  it('空单位落 null 而不是空串——后端 minLength 是 1', () => {
    expect(toCreateInput(form({ unit: '  ' })).unit).toBeNull()
    expect(toCreateInput(form({ unit: 'kWh' })).unit).toBe('kWh')
  })

  it('留空的小数位落 null = 不限', () => {
    expect(toCreateInput(form({ decimals: undefined })).decimals).toBeNull()
  })

  it('⚠ 补丁里没有 key：改一次等于让这一列的历史值集体失联', () => {
    expect(Object.keys(toPatchInput(form()))).not.toContain('key')
    expect(toCreateInput(form({ key: ' 进水量 ' })).key).toBe('进水量')
  })
})
