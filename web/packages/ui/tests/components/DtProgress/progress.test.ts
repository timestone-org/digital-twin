/**
 * @fileoverview 进度取值归一与环形几何的边界契约。
 * ⚠ 非法上限放过去会产出 `aria-valuemax="NaN"` 与 `width: NaN%`，
 * 两者都不报错，只是进度条整条不画。
 */
import { describe, expect, it } from 'vitest'

import {
  clampProgress,
  progressFraction,
  ringGeometry,
  safeMax,
} from '../../../src/components/DtProgress/progress'

describe('safeMax', () => {
  it('正常上限原样返回', () => {
    expect(safeMax(50)).toBe(50)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '%j 回退 100',
    (max) => {
      expect(safeMax(max)).toBe(100)
    },
  )
})

describe('clampProgress', () => {
  it('区间内原样返回', () => {
    expect(clampProgress(30, 100)).toBe(30)
  })

  it('负值抬到 0', () => {
    expect(clampProgress(-5, 100)).toBe(0)
  })

  it('超出上限压到上限', () => {
    expect(clampProgress(150, 100)).toBe(100)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    '%j 当 0',
    (value) => {
      expect(clampProgress(value, 100)).toBe(0)
    },
  )
})

describe('progressFraction', () => {
  it.each([
    [0, 100, 0],
    [25, 100, 0.25],
    [100, 100, 1],
    [5, 20, 0.25],
  ])('value=%j max=%j 得 %j', (value, max, expected) => {
    expect(progressFraction(value, max)).toBe(expected)
  })

  it('超出上限封顶在 1', () => {
    expect(progressFraction(999, 100)).toBe(1)
  })

  it('上限非法时按回退的 100 算', () => {
    expect(progressFraction(25, 0)).toBe(0.25)
  })
})

describe('ringGeometry', () => {
  it.each(['sm', 'md', 'lg'] as const)('%s 档给出正的半径与周长', (size) => {
    const ring = ringGeometry(size)
    expect(ring.radius).toBeGreaterThan(0)
    expect(ring.circumference).toBeCloseTo(2 * Math.PI * ring.radius, 6)
  })

  it('⚠ 半径扣掉半个线宽，否则描边会被视框裁掉一圈', () => {
    const ring = ringGeometry('md')
    expect(ring.radius * 2 + ring.stroke).toBe(ring.diameter)
  })

  it('档位越大环越大', () => {
    expect(ringGeometry('sm').diameter).toBeLessThan(
      ringGeometry('md').diameter,
    )
    expect(ringGeometry('md').diameter).toBeLessThan(
      ringGeometry('lg').diameter,
    )
  })
})
