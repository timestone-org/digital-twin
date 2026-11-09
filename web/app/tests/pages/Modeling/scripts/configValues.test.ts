/** @fileoverview 算子初值、严格边界、小数步长与列表约束。 */
import { describe, expect, it } from 'vitest'

import { parseArrayConfig } from '@/pages/Modeling/Canvas/scripts/arrayConfig'
import {
  configError,
  fieldValue,
  numberRange,
} from '@/pages/Modeling/Canvas/scripts/configValues'
import { fieldsOf } from '@/pages/Modeling/Canvas/scripts/schemaForm'

function field(property: Record<string, unknown>) {
  const value = fieldsOf({ properties: { value: property } })[0]
  if (value === undefined) throw new Error('字段不存在')
  return value
}

describe('有效默认值', () => {
  it('只对缺省字段应用默认值，保留明确空值', () => {
    const property = field({ type: 'number', default: 3 })
    expect(fieldValue(property, {})).toBe(3)
    expect(fieldValue(property, { value: null })).toBeNull()
    expect(fieldValue(property, { value: 0 })).toBe(0)
  })
})

describe('步长与精度', () => {
  it('整数参数始终按整数步进', () => {
    expect(
      numberRange(field({ type: 'integer', default: 10, minimum: 1 })).step,
    ).toBe(1)
  })

  it('显式multipleOf优先于从默认值推导', () => {
    const range = numberRange(
      field({ type: 'number', default: 1, multipleOf: 0.005 }),
    )
    expect(range.step).toBe(0.005)
    expect(range.precision).toBeUndefined()
  })

  it.each([
    [{ type: 'number', default: 0.99, minimum: 0.95, maximum: 0.9999 }, 0.0001],
    [{ type: 'number', default: 0.05, minimum: 0.001, maximum: 1 }, 0.001],
    [{ type: 'number', default: 0.01, minimum: 1e-9, maximum: 1e6 }, 1e-9],
  ])('依据真实默认值与边界的小数位数确定步长', (property, expected) => {
    expect(numberRange(field(property)).step).toBe(expected)
  })

  it('用户明确输入的小数也决定后续步长', () => {
    expect(numberRange(field({ type: 'number', default: 1 }), 0.125).step).toBe(
      0.001,
    )
  })

  it('严格边界不夹成另一个边界值，保留数值后显示错误', () => {
    const property = field({
      type: 'number',
      exclusiveMinimum: 0,
      exclusiveMaximum: 1,
    })
    const range = numberRange(property)
    expect(range.min).toBeUndefined()
    expect(range.max).toBeUndefined()
    expect(configError(property, 0)).toBe('必须大于 0')
    expect(configError(property, 1)).toBe('必须小于 1')
    expect(configError(property, 0.5)).toBe('')
  })
})

describe('配置边界', () => {
  it.each([
    [{ type: 'integer' }, 0.5, '必须填写整数'],
    [{ type: 'number' }, Infinity, '必须填写有限数值'],
    [{ type: 'number', minimum: 1 }, 0, '必须不小于 1'],
    [{ type: 'number', maximum: 5 }, 6, '必须不大于 5'],
    [{ type: 'string', minLength: 2 }, '', '至少填写 2 个字符'],
    [{ type: 'string', maxLength: 2 }, 'abc', '最多填写 2 个字符'],
    [{ type: 'string', enum: ['time_order'] }, 'other', '请选择有效选项'],
  ])('不合法参数给出实际边界说明', (property, value, error) => {
    expect(configError(field(property), value)).toBe(error)
  })

  it('缺少必填项和没有限制的值保持明确语义', () => {
    const required = fieldsOf({
      properties: { value: { type: 'string' } },
      required: ['value'],
    })[0]
    if (required === undefined) throw new Error('字段不存在')
    expect(configError(required, '')).toContain('必须')
    expect(configError(field({ type: 'boolean' }), false)).toBe('')
    expect(configError(field({ type: 'string' }), '内容')).toBe('')
  })
})

describe('列表参数', () => {
  const property = field({
    type: 'array',
    items: { type: 'integer', minimum: 1, maximum: 100 },
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
  })

  it('中英文逗号均生成可保存的整数列表', () => {
    expect(parseArrayConfig('1, 12，24', property)).toEqual({
      value: [1, 12, 24],
      error: '',
    })
  })

  it.each([
    ['', '至少选择 1 项'],
    ['1,2,3,4', '最多选择 3 项'],
    ['1,', '每项都必须填写完整'],
    ['1,NaN', '每项必须是有限数值'],
    ['1,1.5', '每项必须是整数'],
    ['0', '每项必须不小于 1'],
    ['101', '每项必须不大于 100'],
    ['1,1', '列表中不能有重复项'],
  ])('无效列表 %s 不会覆盖上一份配置', (input, error) => {
    expect(parseArrayConfig(input, property)).toEqual({ value: null, error })
  })

  it('数值列表保留小数，文本列表保留文字', () => {
    expect(
      parseArrayConfig(
        '1.25,2.5',
        field({ type: 'array', items: { type: 'number' } }),
      ).value,
    ).toEqual([1.25, 2.5])
    expect(
      parseArrayConfig(
        '温度,压力',
        field({ type: 'array', items: { type: 'string' } }),
      ).value,
    ).toEqual(['温度', '压力'])
    expect(configError(property, [1, 2])).toBe('')
  })
})

it('纯UI步长优先于推导，但不会成为multipleOf验证约束', () => {
  const configured = field({
    type: 'number',
    default: 1,
    exclusiveMinimum: 0,
    maximum: 1,
    'x-dt-step': 0.05,
  })
  expect(numberRange(configured).step).toBe(0.05)
  expect(configured.multipleOf).toBeNull()
  expect(configError(configured, 0.95)).toBe('')
  expect(configError(configured, 0.97)).toBe('')
})
it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  '无效UI步长%s沿用既有推导',
  (step) => {
    expect(
      numberRange(field({ type: 'number', default: 1, 'x-dt-step': step }))
        .step,
    ).toBe(1)
  },
)
it('整数参数拒绝分数UI步长，支持正整数步长', () => {
  expect(
    numberRange(field({ type: 'integer', default: 10, 'x-dt-step': 0.05 }))
      .step,
  ).toBe(1)
  expect(
    numberRange(field({ type: 'integer', default: 10, 'x-dt-step': 2 })).step,
  ).toBe(2)
})

describe('时刻字段', () => {
  const moment = () => field({ type: 'string', 'x-dt-widget': 'moment' })

  // ⚠ 输入框当场标红，表单状态却是干净的话，保存键照样亮着
  it('写错的相对写法挡住保存', () => {
    expect(configError(moment(), '-90x')).not.toBe('')
    expect(configError(moment(), '最近三天')).not.toBe('')
  })

  it('合法的相对、绝对写法与留空都放行', () => {
    expect(configError(moment(), '-90d')).toBe('')
    expect(configError(moment(), '2026-01-01T00:00:00Z')).toBe('')
    expect(configError(moment(), '')).toBe('')
  })
})
