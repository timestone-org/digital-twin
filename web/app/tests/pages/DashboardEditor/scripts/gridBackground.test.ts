/**
 * @fileoverview 契约：栅格导引线按屏幕像素画——舞台整体缩放之后线宽仍约 1 屏幕像素。
 * ⚠ 线宽写死 1 设计像素的话，适应窗口缩到 1/3 时线宽只剩 0.33 屏幕像素，
 * 有的列整条消失、有的叠成两条，网格看着疏密不均。
 */
import { describe, expect, it } from 'vitest'

import { gridBackgroundStyle } from '@/pages/DashboardEditor/scripts/canvasViewport'

const DESIGN = { width: 1920, height: 1080 }
const GRID = { cols: 24, rows: 30, marginX: 0, marginY: 0 }
const SNAP = { mode: 'grid' as const, step: 8, enabled: true, guides: true }

describe('栅格导引线', () => {
  it('缩放后线宽仍约一个屏幕像素', () => {
    const style = gridBackgroundStyle(DESIGN, GRID, SNAP, 1 / 3)

    expect(String(style.backgroundImage)).toContain('0 3px')
  })

  it('原尺寸下仍是 1 像素线', () => {
    const style = gridBackgroundStyle(DESIGN, GRID, SNAP, 1)

    expect(String(style.backgroundImage)).toContain('0 1px')
  })
})
