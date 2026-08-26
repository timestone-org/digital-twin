/**
 * @fileoverview 锁住周长几何这一处真源：四段周长的参数化方向（bottom 与 left 是反向
 * 的）、四个角点的精确 45° 法线、反投影取最近边与并列时的定序、`side:'auto'` 的两种
 * 推法，以及 `labelAt` 的弧长取点。这几条错了图上只有两条边或某一条线不对，肉眼发现不了。
 */
import { describe, expect, it } from 'vitest'

import type { Box } from '../src/geometry'
import {
  anchorPoint,
  perimTToSide,
  perimeterPoint,
  pointAlong,
  polylineLength,
  projectToPerimT,
  resolveSide,
  sideNormal,
  wrap01,
} from '../src/geometry'

/** 中心 (50,30)、宽 100 高 60：四边落在 x∈[0,100]、y∈[0,60] 上 */
const BOX: Box = { x: 50, y: 30, w: 100, h: 60 }

describe('wrap01', () => {
  it('非有限值一律收成 0', () => {
    expect(wrap01(Number.NaN)).toBe(0)
    expect(wrap01(Number.POSITIVE_INFINITY)).toBe(0)
    expect(wrap01(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('整圈与负数都折进 [0,1)', () => {
    expect(wrap01(1)).toBe(0)
    expect(wrap01(1.25)).toBeCloseTo(0.25, 10)
    expect(wrap01(-0.25)).toBeCloseTo(0.75, 10)
    expect(wrap01(0.5)).toBe(0.5)
  })
})

describe('anchorPoint', () => {
  it('不给 t 时落在边中点', () => {
    expect(anchorPoint(BOX, 'top')).toEqual({ x: 50, y: 0 })
    expect(anchorPoint(BOX, 'right')).toEqual({ x: 100, y: 30 })
    expect(anchorPoint(BOX, 'bottom')).toEqual({ x: 50, y: 60 })
    expect(anchorPoint(BOX, 'left')).toEqual({ x: 0, y: 30 })
  })

  it('t 沿边线性推进', () => {
    expect(anchorPoint(BOX, 'top', 0.25)).toEqual({ x: 25, y: 0 })
    expect(anchorPoint(BOX, 'left', 1)).toEqual({ x: 0, y: 60 })
  })

  it('越界的 t 夹到两端而不是外推', () => {
    expect(anchorPoint(BOX, 'top', -3)).toEqual({ x: 0, y: 0 })
    expect(anchorPoint(BOX, 'right', 9)).toEqual({ x: 100, y: 60 })
  })

  it('非有限的 t 收成起点而不是产出 NaN 坐标', () => {
    expect(anchorPoint(BOX, 'bottom', Number.NaN)).toEqual({ x: 0, y: 60 })
  })
})

describe('sideNormal', () => {
  it('四档边各朝盒外，y 轴向下所以 top 是 -1', () => {
    expect(sideNormal('top')).toEqual({ x: 0, y: -1 })
    expect(sideNormal('right')).toEqual({ x: 1, y: 0 })
    expect(sideNormal('bottom')).toEqual({ x: 0, y: 1 })
    expect(sideNormal('left')).toEqual({ x: -1, y: 0 })
  })

  it('每次给一份新的，改了返回值不会污染下一次', () => {
    const one = sideNormal('top')
    one.x = 99
    expect(sideNormal('top')).toEqual({ x: 0, y: -1 })
  })
})

describe('perimeterPoint 的四个角点', () => {
  it('t=0 是左上角，法线 (-√½,-√½)', () => {
    const hit = perimeterPoint(BOX, 0)
    expect(hit.point).toEqual({ x: 0, y: 0 })
    expect(hit.normal).toEqual({ x: -Math.SQRT1_2, y: -Math.SQRT1_2 })
  })

  it('t=.25 是右上角，法线 (√½,-√½)', () => {
    const hit = perimeterPoint(BOX, 0.25)
    expect(hit.point).toEqual({ x: 100, y: 0 })
    expect(hit.normal).toEqual({ x: Math.SQRT1_2, y: -Math.SQRT1_2 })
  })

  it('t=.5 是右下角，法线 (√½,√½)', () => {
    const hit = perimeterPoint(BOX, 0.5)
    expect(hit.point).toEqual({ x: 100, y: 60 })
    expect(hit.normal).toEqual({ x: Math.SQRT1_2, y: Math.SQRT1_2 })
  })

  it('t=.75 是左下角，法线 (-√½,√½)', () => {
    const hit = perimeterPoint(BOX, 0.75)
    expect(hit.point).toEqual({ x: 0, y: 60 })
    expect(hit.normal).toEqual({ x: -Math.SQRT1_2, y: Math.SQRT1_2 })
  })
})

describe('perimeterPoint 的四段', () => {
  it('top 段自左向右，法线朝上', () => {
    expect(perimeterPoint(BOX, 0.025).point.x).toBeCloseTo(10, 6)
    expect(perimeterPoint(BOX, 0.125).point.x).toBeCloseTo(50, 6)
    expect(perimeterPoint(BOX, 0.225).point.x).toBeCloseTo(90, 6)
    expect(perimeterPoint(BOX, 0.125).point.y).toBe(0)
    expect(perimeterPoint(BOX, 0.125).normal).toEqual({ x: 0, y: -1 })
  })

  it('right 段自上而下，法线朝右', () => {
    expect(perimeterPoint(BOX, 0.275).point.y).toBeCloseTo(6, 6)
    expect(perimeterPoint(BOX, 0.375).point.y).toBeCloseTo(30, 6)
    expect(perimeterPoint(BOX, 0.475).point.y).toBeCloseTo(54, 6)
    expect(perimeterPoint(BOX, 0.375).point.x).toBe(100)
    expect(perimeterPoint(BOX, 0.375).normal).toEqual({ x: 1, y: 0 })
  })

  it('bottom 段是反向参数化的：t 变大 x 反而变小', () => {
    expect(perimeterPoint(BOX, 0.525).point.x).toBeCloseTo(90, 6)
    expect(perimeterPoint(BOX, 0.625).point.x).toBeCloseTo(50, 6)
    expect(perimeterPoint(BOX, 0.725).point.x).toBeCloseTo(10, 6)
    expect(perimeterPoint(BOX, 0.625).point.y).toBe(60)
    expect(perimeterPoint(BOX, 0.625).normal).toEqual({ x: 0, y: 1 })
  })

  it('left 段是反向参数化的：t 变大 y 反而变小', () => {
    expect(perimeterPoint(BOX, 0.775).point.y).toBeCloseTo(54, 6)
    expect(perimeterPoint(BOX, 0.875).point.y).toBeCloseTo(30, 6)
    expect(perimeterPoint(BOX, 0.975).point.y).toBeCloseTo(6, 6)
    expect(perimeterPoint(BOX, 0.875).point.x).toBe(0)
    expect(perimeterPoint(BOX, 0.875).normal).toEqual({ x: -1, y: 0 })
  })

  it('四段按 top→right→bottom→left 顺时针绕行', () => {
    const corner = (t: number) => {
      const point = perimeterPoint(BOX, t).point
      return { x: Math.round(point.x), y: Math.round(point.y) }
    }
    expect([0.025, 0.275, 0.525, 0.775].map(corner)).toEqual([
      { x: 10, y: 0 },
      { x: 100, y: 6 },
      { x: 90, y: 60 },
      { x: 0, y: 54 },
    ])
  })

  it('超出一圈的 t 折回同一处', () => {
    expect(perimeterPoint(BOX, 1.1)).toEqual(perimeterPoint(BOX, 0.1))
    expect(perimeterPoint(BOX, -0.9).point.x).toBeCloseTo(40, 6)
  })
})

describe('projectToPerimT', () => {
  it('盒外的点投到最近的那条边', () => {
    expect(projectToPerimT(BOX, { x: 60, y: -20 })).toBeCloseTo(0.15, 10)
    expect(projectToPerimT(BOX, { x: 140, y: 45 })).toBeCloseTo(0.4375, 10)
    expect(projectToPerimT(BOX, { x: -10, y: 15 })).toBeCloseTo(0.9375, 10)
  })

  it('是周长参数化的逆：四段各三点往返回同一个 t', () => {
    // 每段取段内三点，避开四个角（角点同属两条边，反投影只能回其中一个 t）
    const perSegment = [0.05, 0.125, 0.2]
    for (const seg of [0, 0.25, 0.5, 0.75]) {
      for (const offset of perSegment) {
        const t = seg + offset
        const back = projectToPerimT(BOX, perimeterPoint(BOX, t).point)
        expect(back).toBeCloseTo(t, 10)
      }
    }
  })

  it('盒心到四边并列时按 top 优先落在上边', () => {
    expect(projectToPerimT(BOX, { x: 50, y: 30 })).toBeCloseTo(0.125, 10)
  })

  it('零宽零高的盒不产生除零', () => {
    const t = projectToPerimT({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0 })
    expect(Number.isNaN(t)).toBe(false)
    expect(t).toBe(0)
  })

  it('非有限坐标收成 0 而不是把 NaN 传下去', () => {
    expect(projectToPerimT(BOX, { x: Number.NaN, y: 10 })).toBe(0)
  })
})

describe('perimTToSide', () => {
  it('四段按顺时针分档，边界归后一段', () => {
    expect(perimTToSide(0.1)).toBe('top')
    expect(perimTToSide(0.25)).toBe('right')
    expect(perimTToSide(0.3)).toBe('right')
    expect(perimTToSide(0.5)).toBe('bottom')
    expect(perimTToSide(0.75)).toBe('left')
    expect(perimTToSide(0.9)).toBe('left')
  })

  it('超出一圈的 t 先折回再分档', () => {
    expect(perimTToSide(1.1)).toBe('top')
  })
})

describe("resolveSide 把 side:'auto' 解析成四档", () => {
  /** 正方盒：四边等距的并列都在它上面锁 */
  const SQUARE: Box = { x: 0, y: 0, w: 80, h: 80 }

  it('已经是四档之一就原样返回，不看落点', () => {
    expect(resolveSide(BOX, 'left', { kind: 'perim', t: 0.1 })).toBe('left')
    expect(resolveSide(BOX, 'bottom', { kind: 'xy', x: 0, y: 0 })).toBe(
      'bottom',
    )
  })

  it('perim 端口按 t 落在哪条边推', () => {
    expect(resolveSide(BOX, 'auto', { kind: 'perim', t: 0.1 })).toBe('top')
    expect(resolveSide(BOX, 'auto', { kind: 'perim', t: 0.3 })).toBe('right')
    expect(resolveSide(BOX, 'auto', { kind: 'perim', t: 0.6 })).toBe('bottom')
    expect(resolveSide(BOX, 'auto', { kind: 'perim', t: 0.9 })).toBe('left')
  })

  it('xy 端口按到四边的最近边推', () => {
    expect(resolveSide(BOX, 'auto', { kind: 'xy', x: 0.5, y: 0.1 })).toBe('top')
    expect(resolveSide(BOX, 'auto', { kind: 'xy', x: 0.9, y: 0.5 })).toBe(
      'right',
    )
    expect(resolveSide(BOX, 'auto', { kind: 'xy', x: 0.5, y: 0.9 })).toBe(
      'bottom',
    )
    expect(resolveSide(BOX, 'auto', { kind: 'xy', x: 0.1, y: 0.5 })).toBe(
      'left',
    )
  })

  it('xy 的距离按像素算，不按归一值', () => {
    const flat: Box = { x: 0, y: 0, w: 200, h: 50 }
    // 归一距离会判成 left（0.1 < 0.3），像素距离下上边 15px、左边 20px
    expect(resolveSide(flat, 'auto', { kind: 'xy', x: 0.1, y: 0.3 })).toBe(
      'top',
    )
  })

  it('xy 端口在正中心四边等距时按 top 优先', () => {
    expect(resolveSide(SQUARE, 'auto', { kind: 'xy', x: 0.5, y: 0.5 })).toBe(
      'top',
    )
  })

  it('xy 端口在左上角并列时同样按 top 优先', () => {
    expect(resolveSide(SQUARE, 'auto', { kind: 'xy', x: 0.2, y: 0.2 })).toBe(
      'top',
    )
  })

  it('xy 越界先夹进 0..1，非有限收成中心', () => {
    expect(resolveSide(BOX, 'auto', { kind: 'xy', x: 5, y: 0.5 })).toBe('right')
    expect(resolveSide(BOX, 'auto', { kind: 'xy', x: -5, y: 0.5 })).toBe('left')
    expect(
      resolveSide(SQUARE, 'auto', { kind: 'xy', x: Number.NaN, y: 0.5 }),
    ).toBe('top')
  })
})

describe('polylineLength', () => {
  it('点不足两个时没有长度', () => {
    expect(polylineLength([])).toBe(0)
    expect(polylineLength([{ x: 3, y: 4 }])).toBe(0)
  })

  it('逐段累加', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBe(5)
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(20)
  })
})

describe('pointAlong', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ]
  const bend = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]

  it('空表回原点、单点表回那个点', () => {
    expect(pointAlong([], 0.5)).toEqual({ x: 0, y: 0 })
    expect(pointAlong([{ x: 7, y: 8 }], 0.5)).toEqual({ x: 7, y: 8 })
  })

  it('按弧长比例在段内线性插值', () => {
    expect(pointAlong(line, 0)).toEqual({ x: 0, y: 0 })
    expect(pointAlong(line, 0.5)).toEqual({ x: 5, y: 0 })
    expect(pointAlong(line, 1)).toEqual({ x: 10, y: 0 })
  })

  it('跨段时按累计弧长落到后一段上', () => {
    expect(pointAlong(bend, 0.25)).toEqual({ x: 5, y: 0 })
    expect(pointAlong(bend, 0.75)).toEqual({ x: 10, y: 5 })
  })

  it('比例越界夹到两端', () => {
    expect(pointAlong(bend, -1)).toEqual({ x: 0, y: 0 })
    expect(pointAlong(bend, 2)).toEqual({ x: 10, y: 10 })
  })

  it('非有限比例收成起点', () => {
    expect(pointAlong(bend, Number.NaN)).toEqual({ x: 0, y: 0 })
  })

  it('零长折线不做除零', () => {
    const same = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]
    expect(pointAlong(same, 0.5)).toEqual({ x: 5, y: 5 })
  })
})
