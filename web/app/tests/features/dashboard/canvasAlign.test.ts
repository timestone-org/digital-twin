/**
 * @fileoverview 对齐/分布/找空位/整理的口径：包围盒基准、首尾锚定、
 * 满布时显式报越界而不是静默塞出画布。
 */
import { describe, expect, it } from 'vitest'

import {
  alignRects,
  clampRect,
  distributeRects,
  findFreeSlot,
  isInBounds,
  rectsOverlap,
  tidyRects,
} from '@/features/dashboard/canvasAlign'

const DESIGN = { width: 1000, height: 800 }

describe('夹边界', () => {
  it('越界矩形夹回，宽高不小于下限', () => {
    expect(
      clampRect({ x: -50, y: 790, w: 2000, h: 0 }, DESIGN, 24, 24),
    ).toEqual({ x: 0, y: 776, w: 1000, h: 24 })
  })

  it('相交与出界判定', () => {
    expect(
      rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 10, h: 10 }),
    ).toBe(true)
    expect(isInBounds({ x: 990, y: 0, w: 20, h: 10 }, DESIGN)).toBe(false)
    // 亚像素超出算在界内，免得缩放算术的浮点尾巴触发越界提示
    expect(isInBounds({ x: 990.3, y: 0, w: 10, h: 10 }, DESIGN)).toBe(true)
  })
})

describe('对齐', () => {
  const rects = [
    { x: 10, y: 10, w: 100, h: 50 },
    { x: 200, y: 100, w: 50, h: 100 },
  ]

  it('左对齐取包围盒左缘，底对齐取包围盒底缘', () => {
    expect(alignRects(rects, 'left').map((rect) => rect.x)).toEqual([10, 10])
    expect(alignRects(rects, 'bottom').map((rect) => rect.y)).toEqual([
      150, 100,
    ])
  })

  it('水平居中以包围盒中线为基准', () => {
    const centered = alignRects(rects, 'hcenter')
    // 包围盒 10..250，中线 130
    expect(centered.map((rect) => rect.x + rect.w / 2)).toEqual([130, 130])
  })

  it('单个矩形原样返回，且不是同一引用', () => {
    const single = [{ x: 1, y: 2, w: 3, h: 4 }]
    const out = alignRects(single, 'left')
    expect(out).toEqual(single)
    expect(out[0]).not.toBe(single[0])
  })
})

describe('分布', () => {
  it('首尾不动，中间等间距', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 10 },
      { x: 130, y: 0, w: 100, h: 10 },
      { x: 400, y: 0, w: 100, h: 10 },
    ]
    const out = distributeRects(rects, 'x')
    expect(out[0]?.x).toBe(0)
    expect(out[2]?.x).toBe(400)
    // 总跨度 0..500，三块共 300，两个间隙各 100
    expect(out[1]?.x).toBe(200)
  })

  it('不足三个原样返回', () => {
    const rects = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 50, y: 0, w: 10, h: 10 },
    ]
    expect(distributeRects(rects, 'x')).toEqual(rects)
  })

  it('入参顺序与返回顺序一致，与轴向位置无关', () => {
    const rects = [
      { x: 400, y: 0, w: 100, h: 10 },
      { x: 0, y: 0, w: 100, h: 10 },
      { x: 130, y: 0, w: 100, h: 10 },
    ]
    const out = distributeRects(rects, 'x')
    expect(out[0]?.x).toBe(400)
    expect(out[1]?.x).toBe(0)
    expect(out[2]?.x).toBe(200)
  })
})

describe('找空位与整理', () => {
  it('避开已有矩形找到第一个不重叠的位置', () => {
    const slot = findFreeSlot({
      rects: [{ id: 'a', x: 0, y: 0, w: 500, h: 100 }],
      w: 400,
      h: 100,
      design: DESIGN,
      stepX: 100,
      stepY: 100,
    })
    expect(slot).toEqual({ x: 500, y: 0, inBounds: true })
  })

  it('满布时报 inBounds: false 而不是静默塞出画布', () => {
    const slot = findFreeSlot({
      rects: [{ id: 'a', x: 0, y: 0, w: 1000, h: 800 }],
      w: 1000,
      h: 800,
      design: DESIGN,
      stepX: 100,
      stepY: 100,
    })
    expect(slot.inBounds).toBe(false)
  })

  it('整理消除重叠、保持宽高与入参顺序', () => {
    const rects = [
      { id: 'a', x: 0, y: 0, w: 300, h: 100 },
      { id: 'b', x: 50, y: 20, w: 300, h: 100 },
    ]
    const out = tidyRects(rects, DESIGN, 100, 100)
    expect(out.map((rect) => rect.id)).toEqual(['a', 'b'])
    const first = out[0]
    const second = out[1]
    expect(first !== undefined && second !== undefined).toBe(true)
    if (first !== undefined && second !== undefined) {
      expect(rectsOverlap(first, second)).toBe(false)
      expect(first.w).toBe(300)
      expect(second.w).toBe(300)
    }
  })
})
