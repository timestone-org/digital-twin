/**
 * @fileoverview 锁住连线路径这一处真源：圆角折线的两条退化保护（半径不够、近共线）、
 * 四档走线各自的点序列、贝塞尔那个「多一个末控制点」的箭头相切技巧，以及反向渲染必须
 * 端点互换 + side 互换 + 拐点整体反序三件同时做。
 */
import { describe, expect, it } from 'vitest'

import type { EdgePathInput } from '../src/edgePath'
import { edgePath, orthogonalRoute, roundCorners } from '../src/edgePath'

/** 正向、无拐点、走正交的一条基准边 */
const BASE: EdgePathInput = {
  start: { x: 0, y: 0 },
  end: { x: 100, y: 50 },
  startSide: 'right',
  endSide: 'left',
  waypoints: [],
  route: 'orthogonal',
  radius: 8,
  labelAt: 0.5,
  reversed: false,
}

describe('roundCorners', () => {
  it('点不足两个时给空串而不是半截 path', () => {
    expect(roundCorners([], 8)).toBe('')
    expect(roundCorners([{ x: 1, y: 2 }], 8)).toBe('')
  })

  it('两点直接连一条直线', () => {
    expect(
      roundCorners(
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        8,
      ),
    ).toBe('M0,0 L10,10')
  })

  it('直角拐点切出一段圆弧，转向决定 sweep', () => {
    const down = roundCorners(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      8,
    )
    expect(down).toBe('M0,0 L92,0 A8,8 0 0 1 100,8 L100,100')
    const up = roundCorners(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: -100 },
      ],
      8,
    )
    expect(up).toBe('M0,0 L92,0 A8,8 0 0 0 100,-8 L100,-100')
  })

  it('半径被两侧段长各自的一半压住', () => {
    expect(
      roundCorners(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        8,
      ),
    ).toBe('M0,0 L5,0 A5,5 0 0 1 10,5 L10,10')
  })

  it('半径不足 0.5 的拐点退回直角', () => {
    expect(
      roundCorners(
        [
          { x: 0, y: 0 },
          { x: 0.6, y: 0 },
          { x: 0.6, y: 10 },
        ],
        8,
      ),
    ).toBe('M0,0 L0.6,0 L0.6,10')
  })

  it('近共线的拐点退回直角，不让弧退化成半圆凸包', () => {
    expect(
      roundCorners(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 200, y: 1 },
        ],
        8,
      ),
    ).toBe('M0,0 L100,0 L200,1')
  })

  it('偏转还没到共线阈值时照常上圆角', () => {
    expect(
      roundCorners(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 200, y: 10 },
        ],
        8,
      ),
    ).toBe('M0,0 L92,0 A8,8 0 0 1 108,0.8 L200,10')
  })

  it('非有限坐标收成 0，不让 NaN 把整条 path 作废', () => {
    expect(
      roundCorners(
        [
          { x: Number.NaN, y: 0 },
          { x: 10, y: 0 },
        ],
        8,
      ),
    ).toBe('M0,0 L10,0')
  })
})

describe('orthogonalRoute', () => {
  const s = { x: 0, y: 0 }
  const e = { x: 100, y: 50 }

  it('两端几乎对齐时直连，不插多余拐点', () => {
    expect(orthogonalRoute(s, { x: 0.2, y: 100 }, 'top', 'bottom')).toEqual([
      s,
      { x: 0.2, y: 100 },
    ])
    expect(orthogonalRoute(s, { x: 100, y: 0.2 }, 'left', 'right')).toEqual([
      s,
      { x: 100, y: 0.2 },
    ])
  })

  it('两端都是横向面时走竖中线四点', () => {
    expect(orthogonalRoute(s, e, 'right', 'left')).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ])
  })

  it('两端都是纵向面时走横中线四点', () => {
    expect(orthogonalRoute(s, e, 'bottom', 'top')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 25 },
      { x: 100, y: 25 },
      { x: 100, y: 50 },
    ])
  })

  it('一横一纵时走单拐点 L，横向那端先横走', () => {
    expect(orthogonalRoute(s, e, 'right', 'top')).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ])
    expect(orthogonalRoute(s, e, 'top', 'right')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ])
  })
})

describe('edgePath 的四档走线', () => {
  it('straight 直连两端，标签落在弦上', () => {
    const got = edgePath({ ...BASE, route: 'straight' })
    expect(got.path).toBe('M0,0 L100,50')
    expect(got.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ])
    expect(got.label).toEqual({ x: 50, y: 25 })
  })

  it('orthogonal 走圆角折线，标签按弧长落在折线上', () => {
    const got = edgePath(BASE)
    expect(got.path).toBe(
      'M0,0 L42,0 A8,8 0 0 1 50,8 L50,42 A8,8 0 0 0 58,50 L100,50',
    )
    expect(got.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ])
    expect(got.label).toEqual({ x: 50, y: 25 })
  })

  it('step 与 orthogonal 是同一条路由', () => {
    expect(edgePath({ ...BASE, route: 'step' })).toEqual(edgePath(BASE))
  })

  it('bezier 的控制点按两端出线方向外推', () => {
    const got = edgePath({
      ...BASE,
      route: 'bezier',
      end: { x: 100, y: 0 },
    })
    expect(got.path).toBe('M0,0 C40,0 60,0 100,0')
    expect(got.label).toEqual({ x: 50, y: 0 })
  })

  it('bezier 的外推量有 40 的下限', () => {
    const got = edgePath({
      ...BASE,
      route: 'bezier',
      end: { x: 10, y: 0 },
    })
    expect(got.path).toBe('M0,0 C40,0 -30,0 10,0')
  })

  it('bezier 四档出线方向各推各的', () => {
    const at = (startSide: EdgePathInput['startSide']) =>
      edgePath({ ...BASE, route: 'bezier', end: { x: 100, y: 0 }, startSide })
        .path
    expect(at('right')).toContain('C40,0')
    expect(at('left')).toContain('C-40,0')
    expect(at('top')).toContain('C0,-40')
    expect(at('bottom')).toContain('C0,40')
  })

  it('bezier 的 points 多带一个末控制点让箭头与曲线相切', () => {
    const got = edgePath({ ...BASE, route: 'bezier', end: { x: 100, y: 0 } })
    expect(got.points).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 100, y: 0 },
    ])
  })
})

describe('edgePath 的拐点与半径', () => {
  it('拐点非空时优先于走线档位', () => {
    const got = edgePath({
      ...BASE,
      route: 'straight',
      waypoints: [{ x: 50, y: 0 }],
    })
    expect(got.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 50 },
    ])
    expect(got.path).not.toBe('M0,0 L100,50')
  })

  it('半径 0 时每个拐点都是直角', () => {
    const got = edgePath({
      ...BASE,
      waypoints: [{ x: 50, y: 0 }],
      radius: 0,
    })
    expect(got.path).toBe('M0,0 L50,0 L100,50')
  })

  it('labelAt 是沿折线弧长的比例，不是端点的线性插值', () => {
    const got = edgePath({ ...BASE, route: 'straight', labelAt: 0.25 })
    expect(got.label).toEqual({ x: 25, y: 12.5 })
    const bent = edgePath({ ...BASE, labelAt: 0.25 })
    expect(bent.label).toEqual({ x: 37.5, y: 0 })
  })
})

describe('edgePath 的反向渲染', () => {
  const waypoints = [
    { x: 30, y: 0 },
    { x: 30, y: 50 },
  ]

  it('端点互换', () => {
    const got = edgePath({ ...BASE, route: 'straight', reversed: true })
    expect(got.path).toBe('M100,50 L0,0')
    expect(got.points).toEqual([
      { x: 100, y: 50 },
      { x: 0, y: 0 },
    ])
  })

  it('side 跟着互换，折线形状才对称', () => {
    const forward = edgePath({ ...BASE, endSide: 'top' })
    const reversed = edgePath({ ...BASE, endSide: 'top', reversed: true })
    expect(reversed.points).toEqual([...forward.points].reverse())
  })

  it('拐点整体反序，路径不会自己交叉', () => {
    const forward = edgePath({ ...BASE, waypoints })
    const reversed = edgePath({ ...BASE, waypoints, reversed: true })
    expect(reversed.points).toEqual([...forward.points].reverse())
    expect(reversed.points).not.toEqual([BASE.end, ...waypoints, BASE.start])
  })

  it('不就地反转调用方的拐点数组', () => {
    const mine = [
      { x: 30, y: 0 },
      { x: 30, y: 50 },
    ]
    edgePath({ ...BASE, waypoints: mine, reversed: true })
    expect(mine).toEqual([
      { x: 30, y: 0 },
      { x: 30, y: 50 },
    ])
  })

  it('标签比例跟着反向量，与正向的 1-t 处重合', () => {
    const reversed = edgePath({
      ...BASE,
      route: 'straight',
      labelAt: 0.25,
      reversed: true,
    })
    const forward = edgePath({ ...BASE, route: 'straight', labelAt: 0.75 })
    expect(reversed.label.x).toBeCloseTo(forward.label.x, 6)
    expect(reversed.label.y).toBeCloseTo(forward.label.y, 6)
  })
})
