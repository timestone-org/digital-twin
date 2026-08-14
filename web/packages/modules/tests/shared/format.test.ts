/**
 * @fileoverview 守展示层格式化的诚实口径：缺值一律「—」、真实 0 照显 0、
 * 配置来的小数位越界不许抛，以及 -0 不许显成「-0」。
 */
import { describe, expect, it } from 'vitest'

import {
  NO_DATA,
  fmtFixed,
  fmtKwh,
  fmtNumber,
  fmtTrim,
  isPresent,
  toNumOrNull,
} from '../../src/shared/format'

describe('isPresent', () => {
  it('有限数算有值，真实 0 也算', () => {
    expect(isPresent(12.5)).toBe(true)
    expect(isPresent(0)).toBe(true)
    expect(isPresent(-3)).toBe(true)
  })

  it('缺值与非有限数都不算', () => {
    expect(isPresent(null)).toBe(false)
    expect(isPresent(undefined)).toBe(false)
    expect(isPresent(Number.NaN)).toBe(false)
    expect(isPresent(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('数字形状的字符串不算数', () => {
    expect(isPresent('12')).toBe(false)
  })
})

describe('toNumOrNull', () => {
  it('有值取回数值', () => {
    expect(toNumOrNull(0)).toBe(0)
  })

  it('缺值给 null', () => {
    expect(toNumOrNull(Number.NaN)).toBeNull()
    expect(toNumOrNull(undefined)).toBeNull()
  })
})

describe('fmtFixed', () => {
  it('按位数定点', () => {
    expect(fmtFixed(1.2345, 2)).toBe('1.23')
    expect(fmtFixed(1.5)).toBe('2')
  })

  it('缺值给占位符', () => {
    expect(fmtFixed(null)).toBe(NO_DATA)
    expect(fmtFixed(Number.NaN, 2)).toBe(NO_DATA)
  })

  it('负位数钳到 0，非有限位数回落 0', () => {
    expect(fmtFixed(1.234, -3)).toBe('1')
    expect(fmtFixed(1.234, Number.NaN)).toBe('1')
  })

  it('位数超上界钳住而不是抛错', () => {
    expect(() => fmtFixed(1.5, 500)).not.toThrow()
  })
})

describe('fmtNumber', () => {
  it('带千分位', () => {
    expect(fmtNumber(1234567.891, 2)).toBe('1,234,567.89')
  })

  it('精度 ≤0 时先四舍五入到整数', () => {
    expect(fmtNumber(1234.6, 0)).toBe('1,235')
    expect(fmtNumber(1234.6, -2)).toBe('1,235')
  })

  it('缺值给占位符，真实 0 照显', () => {
    expect(fmtNumber(undefined)).toBe(NO_DATA)
    expect(fmtNumber(0)).toBe('0')
  })

  it('-0 归一成 0', () => {
    expect(fmtNumber(-0)).toBe('0')
  })

  it('非有限精度回落两位', () => {
    expect(fmtNumber(1.23456, Number.POSITIVE_INFINITY)).toBe('1.23')
  })

  it('精度超上界钳住而不是抛错', () => {
    expect(fmtNumber(1.5, 500)).toBe('1.5')
  })
})

describe('fmtTrim', () => {
  it('去尾随零且不带千分位', () => {
    expect(fmtTrim(1.5)).toBe('1.5')
    expect(fmtTrim(1234.567)).toBe('1234.57')
    expect(fmtTrim(2)).toBe('2')
  })

  it('缺值给占位符，-0 归一成 0', () => {
    expect(fmtTrim(Number.NaN)).toBe(NO_DATA)
    expect(fmtTrim(-0)).toBe('0')
  })

  it('非有限位数回落两位', () => {
    expect(fmtTrim(1.23456, Number.NaN)).toBe('1.23')
  })
})

describe('fmtKwh', () => {
  it('缺值给占位符', () => {
    expect(fmtKwh(null)).toBe(NO_DATA)
  })

  it('不足千的显整数', () => {
    expect(fmtKwh(999.4)).toBe('999')
    expect(fmtKwh(0)).toBe('0')
  })

  it('取整后满千的压成 k', () => {
    expect(fmtKwh(1234)).toBe('1.23k')
    expect(fmtKwh(12000)).toBe('12k')
  })

  it('分档看的是取整后的绝对值，999.6 与 1000 同档', () => {
    expect(fmtKwh(999.6)).toBe('1k')
    expect(fmtKwh(1000)).toBe('1k')
  })

  it('负值取绝对值再补回负号', () => {
    expect(fmtKwh(-1234)).toBe('-1.23k')
    expect(fmtKwh(-12)).toBe('-12')
  })

  it('压缩档的小数位可调', () => {
    expect(fmtKwh(1234, 1)).toBe('1.2k')
  })
})
