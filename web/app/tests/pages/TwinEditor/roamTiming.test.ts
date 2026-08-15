/**
 * @fileoverview 契约：漫游时长在秒与毫秒之间来回换算不掉精度、也不掉「没配」这一档。
 *
 * ⚠ 乘 0.1 会把 700ms 变成 0.7000000000000001 秒，这一串会原样出现在输入框里。
 * ⚠ 清空输入是「不覆盖」，不是「覆盖成 0」——后者是「这一段瞬移过去」。
 */
import { describe, expect, it } from 'vitest'

import {
  roamMs,
  roamMsOrNull,
  roamSeconds,
  roamSecondsOrUndefined,
} from '@/pages/TwinEditor/roamTiming'

describe('毫秒 → 秒', () => {
  it('整秒与半秒都按人读得懂的形状给', () => {
    expect(roamSeconds(3000)).toBe(3)
    expect(roamSeconds(2500)).toBe(2.5)
    expect(roamSeconds(1800)).toBe(1.8)
  })

  // ⚠ 这条守的就是浮点尾巴
  it('700 毫秒是 0.7 秒，不是 0.7000000000000001', () => {
    expect(roamSeconds(700)).toBe(0.7)
  })

  it('比 0.1 秒还细的部分四舍五入掉', () => {
    expect(roamSeconds(1249)).toBe(1.2)
    expect(roamSeconds(1250)).toBe(1.3)
  })
})

describe('秒 → 毫秒', () => {
  it('按秒填的值落成毫秒', () => {
    expect(roamMs(3, 999)).toBe(3000)
    expect(roamMs(0.5, 999)).toBe(500)
  })

  it('清空时退回给定的缺省，而不是 0', () => {
    expect(roamMs(undefined, 1800)).toBe(1800)
  })
})

describe('可以「没配」的那一档', () => {
  it('清空即不覆盖', () => {
    expect(roamMsOrNull(undefined)).toBeNull()
    expect(roamSecondsOrUndefined(null)).toBeUndefined()
  })

  it('显式填 0 是「覆盖成 0」，与没配区分得开', () => {
    expect(roamMsOrNull(0)).toBe(0)
    expect(roamSecondsOrUndefined(0)).toBe(0)
  })
})
