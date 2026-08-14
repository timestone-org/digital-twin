/**
 * @fileoverview 缩放纯逻辑口径：钳位、逐档防浮点尾巴、指数滚轮可逆、锚点滚动。
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_ZOOM,
  MIN_ZOOM,
  anchorScroll,
  clampZoom,
  stepZoom,
  wheelZoom,
  zoomPercent,
} from '@/features/dashboard/canvasZoom'

describe('钳位', () => {
  it('非法值回 1，越界夹到上下限', () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(0)).toBe(1)
    expect(clampZoom(-2)).toBe(1)
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
  })
})

describe('逐档', () => {
  it('升降各取相邻档位', () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.75)
  })

  it('浮点尾巴不会把当前档算成下一档', () => {
    expect(stepZoom(0.7499999, 1)).toBe(1)
    expect(stepZoom(0.7500001, -1)).toBe(0.5)
  })

  it('两端钳到上下限', () => {
    expect(stepZoom(3, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(0.25, -1)).toBe(MIN_ZOOM)
  })
})

describe('滚轮', () => {
  it('同样格数放大再缩小回到原倍率', () => {
    const zoomedIn = wheelZoom(1, -100)
    expect(wheelZoom(zoomedIn, 100)).toBeCloseTo(1, 10)
  })

  it('deltaY 为 0 或非法时不动', () => {
    expect(wheelZoom(1.5, 0)).toBe(1.5)
    expect(wheelZoom(1.5, Number.NaN)).toBe(1.5)
  })
})

describe('标签与锚点', () => {
  it('百分比取整', () => {
    expect(zoomPercent(0.460999)).toBe('46%')
    expect(zoomPercent(Number.NaN)).toBe('100%')
  })

  it('锚点滚动让设计坐标落回原屏幕位置，且不出负', () => {
    // 舞台原点 100，设计位 200 @ 2x → 屏幕 500；指针在 300 → 需再滚 200
    expect(anchorScroll(50, 100, 200, 2, 300)).toBe(250)
    expect(anchorScroll(0, 0, 0, 1, 500)).toBe(0)
  })
})
