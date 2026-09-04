/**
 * @fileoverview 画幅数学：上下界、投影、刻度。退化输入是这里的主要内容——
 * 跨度为 0 的那一条一旦回退，整张图会静默变成空白（坐标全是 NaN）。
 */
import { describe, expect, it } from 'vitest'

import {
  bounds,
  niceTicks,
  project,
} from '@/pages/Modeling/Canvas/scripts/svgScale'

describe('上下界', () => {
  it('一个值都没有时给 0–1 的兜底轴，不给 ±Infinity', () => {
    expect(bounds([])).toEqual({ low: 0, high: 1 })
  })

  it('只有一个值时向两侧各撑开半个自身量级', () => {
    expect(bounds([7])).toEqual({ low: 3.5, high: 10.5 })
  })

  it('全等值时撑开跨度，免得后面除到 0', () => {
    const at = bounds([2.5, 2.5, 2.5])

    expect(at.high - at.low).toBeGreaterThan(0)
  })

  // ⚠ 0 的「半个自身量级」还是 0，必须另有一条兜底
  it('全是 0 时也撑得开', () => {
    expect(bounds([0, 0])).toEqual({ low: -1, high: 1 })
  })

  it('全负数照实给上下界，不夹到 0', () => {
    expect(bounds([-9, -3, -5])).toEqual({ low: -9, high: -3 })
  })

  it('跨零时两端都留住', () => {
    expect(bounds([-3, 4, 0])).toEqual({ low: -3, high: 4 })
  })

  it('极大极小混在一起时不丢精度', () => {
    expect(bounds([1e-9, 1e9])).toEqual({ low: 1e-9, high: 1e9 })
  })

  it('NaN 与无穷不参与，剩下的有限值说了算', () => {
    const at = bounds([Number.NaN, 2, Number.POSITIVE_INFINITY, 5])

    expect(at).toEqual({ low: 2, high: 5 })
  })

  it('一个有限值都没有时退回兜底轴', () => {
    expect(bounds([Number.NaN, Number.NEGATIVE_INFINITY])).toEqual({
      low: 0,
      high: 1,
    })
  })
})

describe('投影', () => {
  const AT = { low: 0, high: 10 }

  it('两端各落在留白上', () => {
    expect(project(0, AT, 100, 10)).toBe(10)
    expect(project(10, AT, 100, 10)).toBe(90)
  })

  it('中点落在画幅正中', () => {
    expect(project(5, AT, 100, 10)).toBe(50)
  })

  it('负值方向不翻转', () => {
    expect(project(-4, { low: -8, high: 0 }, 100, 10)).toBe(50)
  })

  // ⚠ 手搓的上下界可能跨度为 0（`bounds` 不会，但调用方可以自己拼）
  it('跨度为 0 时落在正中，不给 NaN', () => {
    expect(project(5, { low: 5, high: 5 }, 100, 10)).toBe(50)
  })

  it('上下颠倒的界也不给 NaN', () => {
    expect(project(1, { low: 9, high: 2 }, 100, 10)).toBe(50)
  })
})

describe('刻度', () => {
  it('整十跨度落在 2 的倍数上', () => {
    expect(niceTicks({ low: 0, high: 10 }, 5)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('小数跨度不出 0.30000000000000004 这种数', () => {
    expect(niceTicks({ low: 0, high: 1 }, 4)).toEqual([0, 0.5, 1])
  })

  it('负区间也从界内起排', () => {
    const ticks = niceTicks({ low: -10, high: -2 }, 4)

    expect(ticks[0]).toBeGreaterThanOrEqual(-10)
    expect(ticks.at(-1)).toBeLessThanOrEqual(-2)
  })

  it('-0 归成 0，不显示成「-0」', () => {
    expect(Object.is(niceTicks({ low: -1, high: 1 }, 2)[1], 0)).toBe(true)
  })

  // ⚠ 步长比跨度还大时界内一根都排不下，给空数组会让轴上一个数字都没有
  it('界内排不下刻度时给两端本身', () => {
    expect(niceTicks({ low: 0.06, high: 0.09 }, 1)).toEqual([0.06, 0.09])
  })

  it('跨度为 0 时只给下界', () => {
    expect(niceTicks({ low: 5, high: 5 }, 3)).toEqual([5])
  })

  it('要 0 根刻度时不空转', () => {
    expect(niceTicks({ low: 0, high: 10 }, 0)).toEqual([0])
  })

  it('刻度根数有上限，步长算歪也不会挂住', () => {
    expect(niceTicks({ low: 0, high: 1e6 }, 1e6).length).toBeLessThanOrEqual(64)
  })
})
