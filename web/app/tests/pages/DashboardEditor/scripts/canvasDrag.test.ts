/**
 * @fileoverview 契约：Shift 拖拽的两套锁定——移动按 |dx|≥|dy| 锁主轴（另一轴回
 * 起点原值、绕过吸附、逐事件可切换），缩放按**起手**宽高比锁定（边手柄该边主导、
 * 角手柄相对位移大者主导、min 等比兜底、边界按对边等比缩回、吸附整套让位）。
 */
import { describe, expect, it } from 'vitest'

import {
  normalizeEditorGrid,
  normalizeSnapConfig,
} from '@/features/dashboard/canvasSnap'
import {
  computeDrag,
  hasMoved,
  type DragItem,
  type DragSession,
} from '@/pages/DashboardEditor/scripts/canvasDrag'

function item(over: Partial<DragItem> = {}): DragItem {
  return {
    nodeId: 'a',
    parentId: null,
    start: { x: 100, y: 100, w: 200, h: 100 },
    originX: 0,
    originY: 0,
    layer: { width: 1000, height: 800 },
    minW: 10,
    minH: 10,
    pinnedEdge: null,
    ...over,
  }
}

function session(over: Partial<DragSession> = {}): DragSession {
  const anchor = over.anchor ?? item()
  return {
    kind: 'move',
    dir: { x: 0, y: 0 },
    clientX: 0,
    clientY: 0,
    anchor,
    items: [anchor],
    excluded: new Set<string>(),
    candidates: [],
    snap: normalizeSnapConfig({ mode: 'px', step: 10 }),
    grid: normalizeEditorGrid(),
    wasMulti: false,
    moved: false,
    ...over,
  }
}

function rectOf(result: ReturnType<typeof computeDrag>, id = 'a') {
  return result.rects.get(id)
}

describe('拖动阈值', () => {
  it('半像素内算单击，超出才算拖动', () => {
    expect(hasMoved(0.4, 0.4)).toBe(false)
    expect(hasMoved(0.6, 0)).toBe(true)
    expect(hasMoved(0, -0.6)).toBe(true)
  })
})

describe('Shift 移动锁主轴', () => {
  it('|dx|≥|dy| 锁水平：y 回起点，x 照常吸附', () => {
    const rect = rectOf(
      computeDrag(session(), {
        dx: 33,
        dy: 12,
        free: false,
        constrain: true,
        threshold: 6,
      }),
    )

    expect(rect).toEqual({ x: 130, y: 100, w: 200, h: 100 })
  })

  it('|dy|>|dx| 锁垂直：x 回起点，y 照常吸附', () => {
    const rect = rectOf(
      computeDrag(session(), {
        dx: 5,
        dy: -42,
        free: false,
        constrain: true,
        threshold: 6,
      }),
    )

    expect(rect).toEqual({ x: 100, y: 60, w: 200, h: 100 })
  })

  it('被锁的轴回**起点原值**并绕过吸附：起手不在步进上也不被拽到步进上', () => {
    const off = item({ start: { x: 103, y: 100, w: 200, h: 100 } })
    const rect = rectOf(
      computeDrag(session({ anchor: off, items: [off] }), {
        dx: 4,
        dy: 40,
        free: false,
        constrain: true,
        threshold: 6,
      }),
    )

    expect(rect?.x).toBe(103)
  })

  it('逐事件实时切换：同一会话里主轴随本帧位移重新判定', () => {
    const shared = session()

    const horizontal = rectOf(
      computeDrag(shared, {
        dx: 30,
        dy: 5,
        free: false,
        constrain: true,
        threshold: 6,
      }),
    )
    const vertical = rectOf(
      computeDrag(shared, {
        dx: 5,
        dy: 30,
        free: false,
        constrain: true,
        threshold: 6,
      }),
    )

    expect(horizontal).toMatchObject({ x: 130, y: 100 })
    expect(vertical).toMatchObject({ x: 100, y: 130 })
  })

  it('不按 Shift 两轴都动', () => {
    const rect = rectOf(
      computeDrag(session(), { dx: 33, dy: 12, free: false, threshold: 6 }),
    )

    expect(rect).toMatchObject({ x: 130, y: 110 })
  })

  it('多选整体拖动：锁轴后的净位移原样摊到同行项', () => {
    const anchor = item()
    const other = item({
      nodeId: 'b',
      start: { x: 400, y: 300, w: 100, h: 50 },
    })
    const result = computeDrag(session({ anchor, items: [anchor, other] }), {
      dx: 33,
      dy: 12,
      free: false,
      constrain: true,
      threshold: 6,
    })

    expect(rectOf(result, 'b')).toMatchObject({ x: 430, y: 300 })
  })
})

describe('Shift 缩放锁宽高比', () => {
  const constrain = { free: false, constrain: true, threshold: 6 } as const

  it('边手柄该边主导：拖右边宽先定，高按起手比导出', () => {
    const rect = rectOf(
      computeDrag(session({ kind: 'resize', dir: { x: 1, y: 0 } }), {
        dx: 50,
        dy: 999,
        ...constrain,
      }),
    )

    expect(rect).toEqual({ x: 100, y: 100, w: 250, h: 125 })
  })

  it('角手柄相对位移大者主导', () => {
    const byY = rectOf(
      computeDrag(session({ kind: 'resize', dir: { x: 1, y: 1 } }), {
        dx: 10,
        dy: 40,
        ...constrain,
      }),
    )
    const byX = rectOf(
      computeDrag(session({ kind: 'resize', dir: { x: 1, y: 1 } }), {
        dx: 60,
        dy: 10,
        ...constrain,
      }),
    )

    // dy 相对位移（40/100）大 → 高主导；dx 相对位移（60/200）大 → 宽主导
    expect(byY).toEqual({ x: 100, y: 100, w: 280, h: 140 })
    expect(byX).toEqual({ x: 100, y: 100, w: 260, h: 130 })
  })

  it('动起始边（左手柄）时结束边钉在原处', () => {
    const rect = rectOf(
      computeDrag(session({ kind: 'resize', dir: { x: -1, y: 0 } }), {
        dx: -50,
        dy: 0,
        ...constrain,
      }),
    )

    expect(rect).toEqual({ x: 50, y: 100, w: 250, h: 125 })
  })

  it('拖到最小边时等比放大兜底，比例不破', () => {
    const anchor = item({ minW: 50, minH: 40 })
    const rect = rectOf(
      computeDrag(session({ kind: 'resize', dir: { x: 1, y: 0 }, anchor }), {
        dx: -190,
        dy: 0,
        ...constrain,
      }),
    )

    expect(rect).toEqual({ x: 100, y: 100, w: 80, h: 40 })
  })

  it('顶到本层边界时按被钉住的对边等比缩回', () => {
    const anchor = item({ start: { x: 700, y: 100, w: 200, h: 100 } })
    const rect = rectOf(
      computeDrag(session({ kind: 'resize', dir: { x: 1, y: 0 }, anchor }), {
        dx: 200,
        dy: 0,
        ...constrain,
      }),
    )

    expect(rect).toEqual({ x: 700, y: 100, w: 300, h: 150 })
  })

  it('锁比时吸附与参考线整套让位', () => {
    const result = computeDrag(
      session({ kind: 'resize', dir: { x: 1, y: 0 } }),
      {
        dx: 53,
        dy: 0,
        ...constrain,
      },
    )

    // 253 不在 10 的步进上：吸附让位；对照组不按 Shift 时右边吸到 350
    expect(rectOf(result)).toMatchObject({ w: 253, h: 126.5 })
    expect(result.guides).toEqual([])

    const snapped = rectOf(
      computeDrag(session({ kind: 'resize', dir: { x: 1, y: 0 } }), {
        dx: 53,
        dy: 0,
        free: false,
        threshold: 6,
      }),
    )
    expect(snapped?.w).toBe(250)
  })
})
