/**
 * @fileoverview 锁住清洗原语的口径：非有限数一律收成「无值」、颜色只认 hex 与 token 两种形状。
 * 这两条是整包的地基——漏一处，NaN 就会一路走到锚点标签上被逐字打印出来。
 */
import { describe, expect, it } from 'vitest'

import {
  clamp,
  finiteOr,
  finiteValue,
  isRecord,
  normalizeColorSpec,
  normalizeHexColor,
  stringList,
  toArray,
  toFiniteNumber,
  trimmedString,
} from '../src/sanitize'

describe('isRecord', () => {
  it('普通对象为真', () => {
    expect(isRecord({ a: 1 })).toBe(true)
  })

  it('数组与 null 都不是普通对象', () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })
})

describe('toArray', () => {
  it('数组原样返回', () => {
    const input = [1, 2]
    expect(toArray(input)).toBe(input)
  })

  it('非数组返回同一个空数组引用', () => {
    expect(toArray(undefined)).toEqual([])
    expect(toArray(undefined)).toBe(toArray('not-an-array'))
  })
})

describe('finiteValue', () => {
  it('NaN 与正负无穷都收成无值', () => {
    expect(finiteValue(Number.NaN)).toBeUndefined()
    expect(finiteValue(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(finiteValue(Number.NEGATIVE_INFINITY)).toBeUndefined()
  })

  it('合法 0 与 null 原样保留', () => {
    expect(finiteValue(0)).toBe(0)
    expect(finiteValue(null)).toBeNull()
  })

  it('字符串不参与数值判断', () => {
    expect(finiteValue('NaN')).toBe('NaN')
  })
})

describe('toFiniteNumber', () => {
  it('有限数原样', () => {
    expect(toFiniteNumber(12.5)).toBe(12.5)
    expect(toFiniteNumber(0)).toBe(0)
  })

  it('非有限数为 null', () => {
    expect(toFiniteNumber(Number.NaN)).toBeNull()
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('数字字符串按去空白后解析', () => {
    expect(toFiniteNumber('  12.5 ')).toBe(12.5)
  })

  it('空串与非数字串为 null', () => {
    expect(toFiniteNumber('   ')).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })

  it('布尔与对象为 null', () => {
    expect(toFiniteNumber(true)).toBeNull()
    expect(toFiniteNumber({})).toBeNull()
  })
})

describe('finiteOr', () => {
  it('取不到有限数时用缺省顶上', () => {
    expect(finiteOr(Number.NaN, 7)).toBe(7)
    expect(finiteOr(3, 7)).toBe(3)
  })
})

describe('clamp', () => {
  it('两端都夹', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(5, 0, 10)).toBe(5)
  })
})

describe('trimmedString', () => {
  it('非字符串一律空串', () => {
    expect(trimmedString('  a ')).toBe('a')
    expect(trimmedString(42)).toBe('')
  })
})

describe('stringList', () => {
  it('去空白、丢空串、按首次出现去重', () => {
    expect(stringList([' a ', 'b', 'a', '', 3, null])).toEqual(['a', 'b'])
  })

  it('非数组为空数组', () => {
    expect(stringList('a')).toEqual([])
  })
})

describe('normalizeHexColor', () => {
  it('缩写展开成六位小写', () => {
    expect(normalizeHexColor('#AbC')).toBe('#aabbcc')
  })

  it('六位统一小写并去空白', () => {
    expect(normalizeHexColor(' #A1B2C3 ')).toBe('#a1b2c3')
  })

  it('位数不对或非字符串为 null', () => {
    expect(normalizeHexColor('#12')).toBeNull()
    expect(normalizeHexColor('aabbcc')).toBeNull()
    expect(normalizeHexColor(42)).toBeNull()
  })
})

describe('normalizeColorSpec', () => {
  it('hex 走 hex 归一', () => {
    expect(normalizeColorSpec('#FFF')).toBe('#ffffff')
  })

  it('var 包装剥成裸 token', () => {
    expect(normalizeColorSpec('var( --Accent-Primary )')).toBe(
      '--accent-primary',
    )
  })

  it('裸 token 直接收下', () => {
    expect(normalizeColorSpec('--flow-water')).toBe('--flow-water')
  })

  it('颜色名与空串都不认', () => {
    expect(normalizeColorSpec('red')).toBeNull()
    expect(normalizeColorSpec('')).toBeNull()
  })
})
