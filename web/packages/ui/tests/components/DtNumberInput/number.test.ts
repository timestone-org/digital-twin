/**
 * @fileoverview DtNumberInput 取值换算的边界契约。
 * ⚠ 'Infinity' 能被 Number() 解析出来，放进 toFixed 会抛 RangeError；
 * 而不做十进制收敛的步进会把 0.3 显示成 0.30000000000000004。
 */
import { describe, expect, it } from 'vitest'

import {
  applyPrecision,
  clamp,
  formatValue,
  normalize,
  parseInput,
  stepFrom,
} from '../../../src/components/DtNumberInput/number'

describe('parseInput', () => {
  it.each([
    ['12', 12],
    ['1.5', 1.5],
    ['-3', -3],
    ['  7  ', 7],
    ['1e3', 1000],
    ['0', 0],
  ])('把 %j 读成 %j', (text, expected) => {
    expect(parseInput(text)).toBe(expected)
  })

  it.each(['', '   ', 'abc', '1.2.3', 'Infinity', '-Infinity', 'NaN'])(
    '%j 读不出数字',
    (text) => {
      expect(parseInput(text)).toBeUndefined()
    },
  )
})

describe('clamp', () => {
  it('低于下限抬到下限', () => {
    expect(clamp(-5, { min: 0 })).toBe(0)
  })

  it('高于上限压到上限', () => {
    expect(clamp(120, { max: 100 })).toBe(100)
  })

  it('区间内原样返回', () => {
    expect(clamp(50, { min: 0, max: 100 })).toBe(50)
  })

  it('恰好落在边界上不动', () => {
    expect(clamp(0, { min: 0, max: 100 })).toBe(0)
    expect(clamp(100, { min: 0, max: 100 })).toBe(100)
  })

  it('没给上下限就不夹', () => {
    expect(clamp(-999, {})).toBe(-999)
  })

  it('下限为 0 时仍然生效，不被当成缺省', () => {
    expect(clamp(-1, { min: 0 })).toBe(0)
  })
})

describe('applyPrecision', () => {
  it('按小数位四舍五入', () => {
    expect(applyPrecision(1.2345, { precision: 2 })).toBe(1.23)
  })

  it('precision=0 收成整数', () => {
    expect(applyPrecision(1.6, { precision: 0 })).toBe(2)
  })

  it('没给 precision 时原样返回', () => {
    expect(applyPrecision(1.23456789, {})).toBe(1.23456789)
  })
})

describe('normalize', () => {
  it('先舍入再夹取：舍入后越界的值仍被拉回边界', () => {
    expect(normalize(9.99, { max: 9.9, precision: 1 })).toBe(9.9)
  })

  it('两者都不给就是恒等', () => {
    expect(normalize(3.14, {})).toBe(3.14)
  })
})

describe('formatValue', () => {
  it('按 precision 补足小数位', () => {
    expect(formatValue(1.5, { precision: 3 })).toBe('1.500')
  })

  it('没给 precision 时用最短表示', () => {
    expect(formatValue(1.5, {})).toBe('1.5')
  })

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    '%j 渲染成空串而不是文字 NaN',
    (value) => {
      expect(formatValue(value, {})).toBe('')
    },
  )

  it('0 渲染成 "0"，不被当成空', () => {
    expect(formatValue(0, {})).toBe('0')
  })
})

describe('stepFrom', () => {
  it('缺省步长是 1', () => {
    expect(stepFrom(3, 1, {})).toBe(4)
  })

  it('按 step 增减', () => {
    expect(stepFrom(10, -1, { step: 4 })).toBe(6)
  })

  it('小数步进不留浮点尾巴', () => {
    expect(stepFrom(0.2, 1, { step: 0.1 })).toBe(0.3)
  })

  it('科学计数法的步长也按十进制收敛', () => {
    expect(stepFrom(0, 1, { step: 1e-7 })).toBe(1e-7)
  })

  it('步到上限外时停在上限', () => {
    expect(stepFrom(99, 1, { max: 99.5 })).toBe(99.5)
  })

  it('步到下限外时停在下限', () => {
    expect(stepFrom(1, -1, { min: 0.5 })).toBe(0.5)
  })

  it('给了 precision 就按它定点', () => {
    expect(stepFrom(1, 1, { step: 0.333, precision: 2 })).toBe(1.33)
  })
})
