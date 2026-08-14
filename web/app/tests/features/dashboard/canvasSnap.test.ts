/**
 * @fileoverview 吸附纯算术的口径：两种模式、Alt 逃逸、resize 只吸在动的边、
 * 智能参考线取每轴最近命中。
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SNAP_STEP,
  EDGE_ALL,
  applyResize,
  collectGuides,
  gridGuide,
  normalizeEditorGrid,
  normalizeSnapConfig,
  smartSnap,
  snapPoint,
  snapStep,
  type EdgeMask,
} from '@/features/dashboard/canvasSnap'

const DESIGN = { width: 1920, height: 1080 }
// 栅格 pitch：(1920-8)/24 = 79.666…，(1080-8)/30 = 35.733…
const GRID = normalizeEditorGrid({ marginX: 8, marginY: 8 })
const PX_SNAP = normalizeSnapConfig({ mode: 'px', step: 8 })
const GRID_SNAP = normalizeSnapConfig({ mode: 'grid' })

describe('配置归一化', () => {
  it('脏数据全部夹回缺省', () => {
    const snap = normalizeSnapConfig({ mode: 'px', step: Number.NaN })
    expect(snap.step).toBe(DEFAULT_SNAP_STEP)
    expect(normalizeSnapConfig(null)).toEqual({
      mode: 'grid',
      step: DEFAULT_SNAP_STEP,
      enabled: true,
      guides: true,
    })
    expect(normalizeEditorGrid({ cols: 9999 }).cols).toBe(96)
    expect(normalizeEditorGrid({ rows: -3 }).rows).toBe(12)
  })
})

describe('点吸附', () => {
  it('px 模式吸到步进的整数倍', () => {
    expect(
      snapPoint(13, 22, { design: DESIGN, grid: GRID, snap: PX_SNAP }),
    ).toEqual({ x: 16, y: 24 })
  })

  it('grid 模式吸到 margin + k·pitch 的栅格线', () => {
    const snapped = snapPoint(90, 40, {
      design: DESIGN,
      grid: GRID,
      snap: GRID_SNAP,
    })
    expect(snapped.x).toBeCloseTo(8 + (1920 - 8) / 24, 6)
    expect(snapped.y).toBeCloseTo(8 + (1080 - 8) / 30, 6)
  })

  it('Alt 逃逸与总开关关闭都原样返回', () => {
    expect(
      snapPoint(13, 22, {
        design: DESIGN,
        grid: GRID,
        snap: PX_SNAP,
        free: true,
      }),
    ).toEqual({
      x: 13,
      y: 22,
    })
    const off = normalizeSnapConfig({ enabled: false })
    expect(
      snapPoint(13, 22, { design: DESIGN, grid: GRID, snap: off }),
    ).toEqual({ x: 13, y: 22 })
  })
})

describe('方向键步长', () => {
  it('三种口径：格距 / 步进 / 1px', () => {
    expect(snapStep(DESIGN, GRID, GRID_SNAP).x).toBeCloseTo((1920 - 8) / 24, 6)
    expect(snapStep(DESIGN, GRID, PX_SNAP)).toEqual({ x: 8, y: 8 })
    const off = normalizeSnapConfig({ enabled: false })
    expect(snapStep(DESIGN, GRID, off)).toEqual({ x: 1, y: 1 })
  })
})

describe('resize 吸附', () => {
  const start = { x: 100, y: 100, w: 200, h: 100 }

  it('拖右下角：只有右边与底边被吸附', () => {
    const next = applyResize({
      start,
      dir: { x: 1, y: 1 },
      dx: 13,
      dy: 13,
      minW: 24,
      minH: 24,
      design: DESIGN,
      grid: GRID,
      snap: PX_SNAP,
    })
    expect(next.x).toBe(100)
    expect(next.y).toBe(100)
    // 右边 100+200+13=313 → 吸到 312，宽 = 212；底边 213 → 吸到 216，高 = 116
    expect(next.w).toBe(212)
    expect(next.h).toBe(116)
  })

  it('拖左边：x 移动、右边保持不动', () => {
    const next = applyResize({
      start,
      dir: { x: -1, y: 0 },
      dx: -13,
      dy: 0,
      minW: 24,
      minH: 24,
      design: DESIGN,
      grid: GRID,
      snap: PX_SNAP,
    })
    expect(next.x + next.w).toBe(start.x + start.w)
    expect(next.x).toBe(88)
  })

  it('缩不破最小边长', () => {
    const next = applyResize({
      start,
      dir: { x: 1, y: 0 },
      dx: -500,
      dy: 0,
      minW: 24,
      minH: 24,
      design: DESIGN,
      grid: GRID,
      snap: PX_SNAP,
    })
    expect(next.w).toBe(24)
  })
})

describe('智能参考线', () => {
  const moving = { left: 97, top: 200, width: 100, height: 50 }
  const target = { left: 100, top: 400, width: 80, height: 40 }

  it('每轴取阈值内最近的修正量', () => {
    const hit = smartSnap(moving, [target], 6)
    expect(hit.dx).toBe(3)
    expect(hit.dy).toBeNull()
  })

  it('resize 掩码只比在动的那条边', () => {
    const onlyRight: EdgeMask = [false, false, true]
    // 移动矩形右边 197 vs 目标左边 100 / 中线 140 / 右边 180 → 都超 6px 阈值
    const hit = smartSnap(moving, [target], 6, onlyRight, EDGE_ALL)
    expect(hit.dx).toBeNull()
  })

  it('共线才画参考线，且同位置聚合成一条', () => {
    const aligned = { ...moving, left: 100 }
    const twin = { left: 100, top: 600, width: 40, height: 40 }
    const guides = collectGuides(aligned, [target, twin], 0.5, EDGE_ALL, [
      false,
      false,
      false,
    ])
    const vertical = guides.filter((line) => line.orientation === 'v')
    expect(vertical).toHaveLength(1)
    expect(vertical[0]?.from).toBe(200)
    expect(vertical[0]?.to).toBe(640)
  })
})

describe('导引背景', () => {
  it('px 模式周期是步进且无偏移，grid 模式周期是 pitch 且偏移是 margin', () => {
    expect(gridGuide(DESIGN, GRID, PX_SNAP)).toEqual({
      colPeriod: 8,
      rowPeriod: 8,
      offsetX: 0,
      offsetY: 0,
    })
    const guide = gridGuide(DESIGN, GRID, GRID_SNAP)
    expect(guide.offsetX).toBe(8)
    expect(guide.colPeriod).toBeCloseTo((1920 - 8) / 24, 6)
  })
})
