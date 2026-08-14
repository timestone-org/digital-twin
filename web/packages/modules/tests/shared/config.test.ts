/**
 * @fileoverview 守配置读取原语：脏值一律回落而不是上屏，`'true'` 这种字符串不算真，
 * 以及 `configDefaults` 只摊字段自己的 `default` 且引用型缺省逐份复制——
 * 共享同一个对象时，谁就地改一下全部节点跟着变。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  configDefaults,
  readArray,
  readBoolean,
  readEnum,
  readNumber,
  readRecord,
  readText,
  readTrimmedText,
} from '../../src/shared/config'

describe('readText', () => {
  it('字符串原样取回', () => {
    expect(readText('大屏')).toBe('大屏')
  })

  it('非字符串回落', () => {
    expect(readText(42, '兜底')).toBe('兜底')
    expect(readText(undefined)).toBe('')
    expect(readText(null)).toBe('')
  })
})

describe('readBoolean', () => {
  it('只认真正的布尔', () => {
    expect(readBoolean(true)).toBe(true)
    expect(readBoolean(false)).toBe(false)
  })

  it('字符串 true 不算真', () => {
    expect(readBoolean('true')).toBe(false)
  })

  it('缺键走回落', () => {
    expect(readBoolean(undefined)).toBe(false)
    expect(readBoolean(undefined, true)).toBe(true)
  })
})

describe('readNumber', () => {
  it('有限数原样取回', () => {
    expect(readNumber(12.5, 0)).toBe(12.5)
    expect(readNumber(0, 8)).toBe(0)
  })

  it('NaN 与无穷按缺失处理', () => {
    expect(readNumber(Number.NaN, 8)).toBe(8)
    expect(readNumber(Number.POSITIVE_INFINITY, 8)).toBe(8)
  })

  it('数字形状的字符串不算数', () => {
    expect(readNumber('12', 8)).toBe(8)
  })
})

describe('readTrimmedText', () => {
  it('去掉首尾空白', () => {
    expect(readTrimmedText('  大屏 ')).toBe('大屏')
  })

  it('一串空格与空串等价，用来判「配了没有」', () => {
    expect(readTrimmedText('   ')).toBe('')
    expect(readTrimmedText('')).toBe('')
  })

  it('非字符串回落', () => {
    expect(readTrimmedText(42, '兜底')).toBe('兜底')
    expect(readTrimmedText(undefined)).toBe('')
  })
})

describe('readEnum', () => {
  const MODES = ['line', 'bar', 'pie'] as const

  it('名单内的原样取回', () => {
    expect(readEnum('bar', MODES, 'line')).toBe('bar')
  })

  it('名单外的一律回落', () => {
    expect(readEnum('scatter', MODES, 'line')).toBe('line')
    expect(readEnum('', MODES, 'pie')).toBe('pie')
  })

  it('缺键走回落', () => {
    expect(readEnum(undefined, MODES, 'line')).toBe('line')
    expect(readEnum(null, MODES, 'line')).toBe('line')
  })

  it('只认字符串字面量，不把别的类型字符串化', () => {
    expect(readEnum(0, ['0', '1'] as const, '1')).toBe('1')
    expect(readEnum(true, ['true'] as const, 'true')).toBe('true')
  })
})

describe('readArray', () => {
  it('数组原样取回', () => {
    const rows = [{ key: 'a' }, { key: 'b' }]

    expect(readArray(rows)).toBe(rows)
  })

  it('空数组不被当成缺失', () => {
    expect(readArray([])).toEqual([])
  })

  it('非数组一律空数组', () => {
    expect(readArray(undefined)).toEqual([])
    expect(readArray({ 0: 'a', length: 1 })).toEqual([])
    expect(readArray('[]')).toEqual([])
  })
})

describe('readRecord', () => {
  it('对象原样取回', () => {
    expect(readRecord({ pad: 4 })).toEqual({ pad: 4 })
  })

  it('数组与 null 都不算对象', () => {
    expect(readRecord([1, 2])).toEqual({})
    expect(readRecord(null)).toEqual({})
    expect(readRecord('pad')).toEqual({})
  })
})

describe('configDefaults', () => {
  const fields: ConfigField[] = [
    { key: 'title', label: '标题', type: 'string', default: '' },
    { key: 'showTitle', label: '标题条', type: 'boolean', default: false },
    { key: 'note', label: '备注', type: 'string' },
    {
      key: 'box',
      label: '内部布局',
      type: 'object',
      default: { pad: 8 },
      fields: [{ key: 'pad', label: '内边距', type: 'number', default: 4 }],
    },
  ]

  it('只摊声明过 default 的字段', () => {
    expect(configDefaults(fields)).toEqual({
      title: '',
      showTitle: false,
      box: { pad: 8 },
    })
  })

  it('object 字段取整块缺省，不从子字段另拼一份', () => {
    expect(configDefaults(fields).box).toEqual({ pad: 8 })
  })

  it('两次摊出来的引用型缺省互不相干', () => {
    const first = configDefaults(fields)
    const second = configDefaults(fields)

    expect(first.box).not.toBe(second.box)
  })

  it('没有任何字段时是空配置', () => {
    expect(configDefaults([])).toEqual({})
  })
})
