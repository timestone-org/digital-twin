/**
 * @fileoverview 契约：分段格子那一档点亮几格。
 *
 * ⚠ 一格代表 1/N，所以取整方式是有观感后果的：向下取整会让「刚过半」的读数少亮
 * 一格，一排卡片放在一起时看着像数据不对。
 */
import { describe, expect, it } from 'vitest'

import { litSegments } from '../../src/shared/meter'

describe('点亮几格', () => {
  it('按比例四舍五入', () => {
    // 37.5% × 16 = 6；向下取整也是 6，这一条不区分两种取整
    expect(litSegments(37.5, 16).lit).toBe(6)
    // 18.5% × 16 = 2.96 —— 向下取整会给 2
    expect(litSegments(18.5, 16).lit).toBe(3)
    // 44% × 16 = 7.04
    expect(litSegments(44, 16).lit).toBe(7)
  })

  it('总格数原样带出来，画法据此摆几个格子', () => {
    expect(litSegments(50, 20)).toEqual({ total: 20, lit: 10 })
  })

  it('两端夹住：超量程点满，负数一格不点', () => {
    expect(litSegments(150, 16).lit).toBe(16)
    expect(litSegments(-20, 16).lit).toBe(0)
  })

  it('0% 一格都不点', () => {
    expect(litSegments(0, 16).lit).toBe(0)
  })

  // ⚠ 除零算出来是 NaN，画出来是一片空轨道，而配置里明明写了格数
  it('非正的格数返回零格，不算除零', () => {
    expect(litSegments(50, 0)).toEqual({ total: 0, lit: 0 })
    expect(litSegments(50, -3)).toEqual({ total: 0, lit: 0 })
  })
})
