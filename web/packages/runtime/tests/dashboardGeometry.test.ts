/**
 * @fileoverview 守大屏几何的三条口径：节点矩形是恒等映射且保留亚像素、
 * 容器子层的坐标系就是父容器的内容区、舞台等比 letterbox 且缩放贴近 1 时钉成 1:1。
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DESIGN_HEIGHT,
  DEFAULT_DESIGN_WIDTH,
  computeStageGeometry,
  containerGeometry,
  designSize,
  moduleRect,
} from '../src/dashboardGeometry'

describe('设计尺寸', () => {
  it('正数原样保留', () => {
    expect(designSize(1280, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('非正数与非有限数回退到 1920×1080', () => {
    expect(designSize(0, -5)).toEqual({ width: 1920, height: 1080 })
    expect(designSize(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      width: DEFAULT_DESIGN_WIDTH,
      height: DEFAULT_DESIGN_HEIGHT,
    })
  })
})

describe('节点矩形', () => {
  it('坐标与尺寸恒等映射，亚像素一位不丢', () => {
    expect(moduleRect({ x: 10.5, y: 20.25, w: 100.75, h: 60.125 })).toEqual({
      left: 10.5,
      top: 20.25,
      width: 100.75,
      height: 60.125,
    })
  })

  it('负尺寸夹到 0，脏坐标按 0 算', () => {
    expect(moduleRect({ x: Number.NaN, y: -8, w: -20, h: Number.NaN })).toEqual(
      {
        left: 0,
        top: -8,
        width: 0,
        height: 0,
      },
    )
  })
})

describe('容器子层坐标系', () => {
  it('等于容器矩形扣掉内容区内缩', () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 }

    expect(
      containerGeometry(rect, { top: 36, right: 8, bottom: 8, left: 8 }),
    ).toEqual({ width: 384, height: 256 })
  })

  it('内缩比容器还大时给 0，不给负尺寸', () => {
    const rect = { left: 0, top: 0, width: 20, height: 20 }

    expect(
      containerGeometry(rect, { top: 30, right: 30, bottom: 30, left: 30 }),
    ).toEqual({ width: 0, height: 0 })
  })

  it('递归一层就再扣一次：容器套容器逐层变小', () => {
    const inset = { top: 28, right: 8, bottom: 8, left: 8 }
    const outer = containerGeometry(
      { left: 0, top: 0, width: 400, height: 300 },
      inset,
    )
    const inner = containerGeometry(
      { left: 0, top: 0, width: outer.width, height: outer.height },
      inset,
    )

    expect(outer).toEqual({ width: 384, height: 264 })
    expect(inner).toEqual({ width: 368, height: 228 })
  })
})

describe('舞台缩放', () => {
  it('等比缩到视口里，正好整倍时没有留白', () => {
    expect(
      computeStageGeometry({ width: 960, height: 540 }, designSize(1920, 1080)),
    ).toEqual({ scale: 0.5, width: 960, height: 540, offsetX: 0, offsetY: 0 })
  })

  it('比例不一致时按短边缩，长边留 letterbox 黑边', () => {
    const stage = computeStageGeometry(
      { width: 1920, height: 1080 },
      designSize(1600, 1200),
    )

    expect(stage).toEqual({
      scale: 0.9,
      width: 1440,
      height: 1080,
      offsetX: 240,
      offsetY: 0,
    })
  })

  it('缩放落在 1 附近钉成 1:1，整屏不做重采样', () => {
    const stage = computeStageGeometry(
      { width: 1900, height: 1069 },
      designSize(1920, 1080),
    )

    expect(stage.scale).toBe(1)
    expect(stage.width).toBe(1920)
    expect(stage.offsetX).toBe(-10)
  })

  it('超出容差就照实缩，不钉', () => {
    const stage = computeStageGeometry(
      { width: 1900, height: 1000 },
      designSize(1920, 1080),
    )

    expect(stage.scale).toBeCloseTo(0.9259, 4)
    expect(stage.height).toBeCloseTo(1000, 6)
  })

  it('视口还没量出来时按 1:1 出设计尺寸，不产出 NaN', () => {
    expect(
      computeStageGeometry({ width: 0, height: 0 }, designSize(1920, 1080)),
    ).toEqual({
      scale: 1,
      width: 1920,
      height: 1080,
      offsetX: 0,
      offsetY: 0,
    })
  })
})
