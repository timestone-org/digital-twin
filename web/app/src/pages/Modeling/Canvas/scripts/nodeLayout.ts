/**
 * @fileoverview 画布上一批卡片的几何：对齐、等距分布、栅格吸附、与对齐参考线。
 *
 * 全是纯函数——进来一批矩形，出去一张「谁挪到哪」的表。不碰响应式，也不认识
 * 图与算子，于是每一条都能单独测。
 */
import type { CanvasPoint } from './useCanvasViewport'

/** 新卡片连着落时的错开步长。 */
const CASCADE_STEP = 40

/** 栅格吸附的步长（画布像素）。 */
export const GRID_STEP = 8

/**
 * 吸附到别的卡片边线的容差，单位是**屏幕像素**。
 *
 * ⚠ 用之前必须除以当前缩放换成画布像素：直接当画布像素用的话，缩到 25% 时它只
 * 相当于 1.5 个屏幕像素——吸附等于没了；放到 250% 时又变成 15 个，卡片还离得老远
 * 就被吸走。这条本仓的另一块画布已经踩过。
 */
export const SNAP_TOLERANCE = 6

/** 一张卡片的外接矩形。 */
export interface NodeRect extends CanvasPoint {
  id: string
  width: number
  height: number
}

/** 六种对齐。 */
export const ALIGN_KINDS = [
  'left',
  'center-x',
  'right',
  'top',
  'center-y',
  'bottom',
] as const

export type AlignKind = (typeof ALIGN_KINDS)[number]

/** 一条对齐参考线。`at` 是画布坐标上的位置。 */
export interface GuideLine {
  axis: 'x' | 'y'
  at: number
}

/** 一批矩形的外接盒。空清单时给一个零盒。 */
function boundsOf(rects: readonly NodeRect[]): {
  left: number
  top: number
  right: number
  bottom: number
} {
  return {
    left: Math.min(...rects.map((item) => item.left)),
    top: Math.min(...rects.map((item) => item.top)),
    right: Math.max(...rects.map((item) => item.left + item.width)),
    bottom: Math.max(...rects.map((item) => item.top + item.height)),
  }
}

/** 某一种对齐下，一张卡片该挪到的左上角。 */
function alignedPoint(
  rect: NodeRect,
  kind: AlignKind,
  box: ReturnType<typeof boundsOf>,
): CanvasPoint {
  if (kind === 'left') return { left: box.left, top: rect.top }
  if (kind === 'right') return { left: box.right - rect.width, top: rect.top }
  if (kind === 'center-x') {
    return { left: (box.left + box.right - rect.width) / 2, top: rect.top }
  }
  if (kind === 'top') return { left: rect.left, top: box.top }
  if (kind === 'bottom') {
    return { left: rect.left, top: box.bottom - rect.height }
  }
  return { left: rect.left, top: (box.top + box.bottom - rect.height) / 2 }
}

/**
 * 把一批卡片对齐。少于两张时什么都不做——一张卡片没有「对齐」可言。
 *
 * @param rects 参与对齐的卡片
 * @param kind 对到哪一边
 */
export function alignTo(
  rects: readonly NodeRect[],
  kind: AlignKind,
): Map<string, CanvasPoint> {
  const moves = new Map<string, CanvasPoint>()
  if (rects.length < 2) return moves
  const box = boundsOf(rects)
  for (const rect of rects) moves.set(rect.id, alignedPoint(rect, kind, box))
  return moves
}

/**
 * 让一批卡片在某个轴上等距：两头不动，中间的匀开。
 *
 * ⚠ 匀的是**间隙**不是中心距：按中心距匀的话，宽窄不一的卡片之间会看着疏密
 * 不均，而用户按下这颗按钮想要的正是「看着一样宽」。
 */
export function distributeAlong(
  rects: readonly NodeRect[],
  axis: 'x' | 'y',
): Map<string, CanvasPoint> {
  const moves = new Map<string, CanvasPoint>()
  if (rects.length < 3) return moves
  const sized = (rect: NodeRect): number =>
    axis === 'x' ? rect.width : rect.height
  const placed = (rect: NodeRect): number =>
    axis === 'x' ? rect.left : rect.top
  const ordered = [...rects].sort((left, right) => placed(left) - placed(right))
  const box = boundsOf(rects)
  const span = axis === 'x' ? box.right - box.left : box.bottom - box.top
  const filled = ordered.reduce((sum, rect) => sum + sized(rect), 0)
  const gap = (span - filled) / (ordered.length - 1)
  let cursor = axis === 'x' ? box.left : box.top
  for (const rect of ordered) {
    moves.set(
      rect.id,
      axis === 'x'
        ? { left: cursor, top: rect.top }
        : { left: rect.left, top: cursor },
    )
    cursor += sized(rect) + gap
  }
  return moves
}

/** 连着落好几张卡片时错开一点，免得叠在一起。 */
export function cascadeFrom(at: CanvasPoint, count: number): CanvasPoint {
  const offset = (count % 6) * CASCADE_STEP
  return { left: at.left + offset, top: at.top + offset }
}

/** 吸到栅格上。 */
export function snapToGrid(at: CanvasPoint, step = GRID_STEP): CanvasPoint {
  return {
    left: Math.round(at.left / step) * step,
    top: Math.round(at.top / step) * step,
  }
}

/** 一个轴上，卡片自己的三条候选线（前缘 / 中线 / 后缘）。 */
function edgesOf(rect: NodeRect, axis: 'x' | 'y'): [number, number, number] {
  const start = axis === 'x' ? rect.left : rect.top
  const size = axis === 'x' ? rect.width : rect.height
  return [start, start + size / 2, start + size]
}

/** 一个轴上离得最近的那条吸附线：给出该轴要挪多少，以及贴上的那条线。 */
function nearestOn(
  moving: NodeRect,
  others: readonly NodeRect[],
  axis: 'x' | 'y',
  tolerance: number,
): { delta: number; guide: GuideLine } | null {
  let best: { delta: number; guide: GuideLine } | null = null
  for (const mine of edgesOf(moving, axis)) {
    for (const other of others) {
      for (const theirs of edgesOf(other, axis)) {
        const delta = theirs - mine
        if (Math.abs(delta) > tolerance) continue
        if (best !== null && Math.abs(best.delta) <= Math.abs(delta)) continue
        best = { delta, guide: { axis, at: theirs } }
      }
    }
  }
  return best
}

/**
 * 拖动中的吸附：算出该额外挪多少，以及要画哪几条参考线。
 *
 * @param moving 拖动中那张卡片当前的矩形
 * @param others 画布上其余卡片
 * @param zoom 当前缩放——容差是屏幕像素，要靠它换算成画布像素
 */
export function snapAgainst(
  moving: NodeRect,
  others: readonly NodeRect[],
  zoom: number,
): { delta: CanvasPoint; guides: GuideLine[] } {
  const tolerance = SNAP_TOLERANCE / Math.max(zoom, 0.01)
  const horizontal = nearestOn(moving, others, 'x', tolerance)
  const vertical = nearestOn(moving, others, 'y', tolerance)
  const guides: GuideLine[] = []
  if (horizontal !== null) guides.push(horizontal.guide)
  if (vertical !== null) guides.push(vertical.guide)
  return {
    delta: { left: horizontal?.delta ?? 0, top: vertical?.delta ?? 0 },
    guides,
  }
}
