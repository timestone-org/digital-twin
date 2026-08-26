/**
 * @fileoverview 锁住清洗原语的口径：非有限数一律收成「无值」、尺寸 0 与负数必须回缺省、
 * 数字 id 走 String() 化、空键与重复键一律丢弃、长度只认四种形状。
 * 这几条是整包归一化的地基——漏一处，0 宽的盒与错位一格的绑定都不会报任何错。
 */
import { describe, expect, it } from 'vitest'

import {
  boolOr,
  clamp,
  finiteOr,
  idOf,
  intIn,
  isRecord,
  isTwin2dLen,
  lenOr,
  oneOf,
  posDim,
  stringList,
  toArray,
  toFiniteNumber,
  trimmedString,
  uniqueBy,
} from '../src/sanitize'

describe('isRecord', () => {
  it('普通对象为真', () => {
    expect(isRecord({ a: 1 })).toBe(true)
  })

  it('数组、null 与标量都不是普通对象', () => {
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

describe('toFiniteNumber', () => {
  it('有限数原样返回，含显式 0', () => {
    expect(toFiniteNumber(0)).toBe(0)
    expect(toFiniteNumber(-3.5)).toBe(-3.5)
  })

  it('NaN 与正负无穷都收成无值', () => {
    expect(toFiniteNumber(Number.NaN)).toBeNull()
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull()
    expect(toFiniteNumber(Number.NEGATIVE_INFINITY)).toBeNull()
  })

  it('数字字符串宽松收下，前后空白不算数', () => {
    expect(toFiniteNumber(' 12 ')).toBe(12)
  })

  it('空串、非数字串与非标量都取不到数', () => {
    expect(toFiniteNumber('   ')).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
    expect(toFiniteNumber({})).toBeNull()
  })
})

describe('finiteOr', () => {
  it('取到数就用数', () => {
    expect(finiteOr('7', 1)).toBe(7)
  })

  it('取不到数才用缺省', () => {
    expect(finiteOr(Number.NaN, 1)).toBe(1)
  })
})

describe('clamp', () => {
  it('低于下界抬到下界', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
  })

  it('高于上界压到上界', () => {
    expect(clamp(50, 0, 10)).toBe(10)
  })

  it('区间内原样', () => {
    expect(clamp(4, 0, 10)).toBe(4)
  })
})

describe('trimmedString', () => {
  it('字符串去掉前后空白', () => {
    expect(trimmedString('  a  ')).toBe('a')
  })

  it('非字符串一律空串', () => {
    expect(trimmedString(42)).toBe('')
  })
})

describe('stringList', () => {
  it('去空白、丢空串、按首次出现去重', () => {
    expect(stringList([' a ', 'a', '', 'b', 3])).toEqual(['a', 'b'])
  })

  it('非数组给空表', () => {
    expect(stringList('a')).toEqual([])
  })
})

describe('posDim', () => {
  it('正数原样', () => {
    expect(posDim(24, 8)).toBe(24)
  })

  // ⚠ 0 会让整块塌掉且不报错，所以它与负数一样必须回缺省
  it('0 与负数一律回缺省', () => {
    expect(posDim(0, 8)).toBe(8)
    expect(posDim(-1, 8)).toBe(8)
  })

  it('取不到数回缺省', () => {
    expect(posDim('auto', 8)).toBe(8)
  })

  it('正数字符串照收', () => {
    expect(posDim('12', 8)).toBe(12)
  })
})

describe('intIn', () => {
  it('四舍五入后落在区间内', () => {
    expect(intIn(4.6, 2, 200, 20)).toBe(5)
  })

  it('低于下界抬到下界，高于上界压到上界', () => {
    expect(intIn(1, 2, 200, 20)).toBe(2)
    expect(intIn(999, 2, 200, 20)).toBe(200)
  })

  it('取不到数时用缺省，缺省本身不再夹取', () => {
    expect(intIn('x', 2, 200, 999)).toBe(999)
  })
})

describe('boolOr', () => {
  it('真正的布尔原样', () => {
    expect(boolOr(false, true)).toBe(false)
  })

  it('`0` 与 `"true"` 这类一律回缺省', () => {
    expect(boolOr(0, true)).toBe(true)
    expect(boolOr('true', false)).toBe(false)
  })
})

describe('oneOf', () => {
  const KINDS = ['box', 'vec'] as const

  it('命中白名单原样返回', () => {
    expect(oneOf('vec', KINDS, 'box')).toBe('vec')
  })

  it('未命中回缺省', () => {
    expect(oneOf('tank', KINDS, 'box')).toBe('box')
    expect(oneOf(undefined, KINDS, 'box')).toBe('box')
  })

  it('数字取值域同样管用', () => {
    expect(oneOf(90, [0, 90, 180, 270] as const, 0)).toBe(90)
    expect(oneOf('90', [0, 90, 180, 270] as const, 0)).toBe(0)
  })
})

describe('idOf', () => {
  it('非空字符串取 trim 后的值', () => {
    expect(idOf('  n1 ')).toBe('n1')
  })

  // ⚠ 数字 id 是现场很常见的写法，不转串会让它与字符串 id 永远比不相等
  it('有限数字走 String() 化', () => {
    expect(idOf(3)).toBe('3')
    expect(idOf(0)).toBe('0')
  })

  it('非有限数、空串与其余类型都给空串', () => {
    expect(idOf(Number.NaN)).toBe('')
    expect(idOf('   ')).toBe('')
    expect(idOf(null)).toBe('')
    expect(idOf(true)).toBe('')
  })
})

describe('uniqueBy', () => {
  const keyOf = (item: { id: string }): string => item.id

  it('同一个键只留第一条，后来者丢弃', () => {
    expect(uniqueBy([{ id: 'a' }, { id: 'b' }, { id: 'a' }], keyOf)).toEqual([
      { id: 'a' },
      { id: 'b' },
    ])
  })

  it('空键的条目整条丢弃', () => {
    expect(uniqueBy([{ id: '' }, { id: 'a' }], keyOf)).toEqual([{ id: 'a' }])
  })

  it('空表进空表出', () => {
    expect(uniqueBy([], keyOf)).toEqual([])
  })
})

describe('isTwin2dLen', () => {
  it('有限数、百分比、em 与 auto 四种形状为真', () => {
    expect(isTwin2dLen(12)).toBe(true)
    expect(isTwin2dLen('50%')).toBe(true)
    expect(isTwin2dLen('-1.5em')).toBe(true)
    expect(isTwin2dLen('auto')).toBe(true)
  })

  it('非有限数、带单位 px 的串与非标量都为假', () => {
    expect(isTwin2dLen(Number.NaN)).toBe(false)
    expect(isTwin2dLen('12px')).toBe(false)
    expect(isTwin2dLen(null)).toBe(false)
  })
})

describe('lenOr', () => {
  it('有限数原样，非有限数回缺省', () => {
    expect(lenOr(12, 'auto')).toBe(12)
    expect(lenOr(Number.POSITIVE_INFINITY, 'auto')).toBe('auto')
  })

  it('三种串形照收，前后空白不算数', () => {
    expect(lenOr(' 50% ', 0)).toBe('50%')
    expect(lenOr('0.78em', 0)).toBe('0.78em')
    expect(lenOr(' auto ', 0)).toBe('auto')
  })

  it('裸数字串按设计像素收下', () => {
    expect(lenOr('12', 'auto')).toBe(12)
  })

  it('不合口径的串与非标量回缺省', () => {
    expect(lenOr('12px', 'auto')).toBe('auto')
    expect(lenOr('', 'auto')).toBe('auto')
    expect(lenOr({}, 'auto')).toBe('auto')
  })
})
