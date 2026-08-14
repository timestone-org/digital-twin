/**
 * @fileoverview 画布上的放置与批量整形：夹边界、找空位、整理布局、对齐与分布。
 * 全部纯函数，坐标一律是**本层**设计像素——跨父层坐标系不同，
 * 调用方必须保证参与的矩形同父（编辑器约定：仅同父可对齐/分布）。
 */
import type { DesignSize, NodeBox } from '@dt/runtime'

/** 浮点容差：亚像素抖动不算越界。 */
const EPS = 0.5

/** 夹一个矩形进本层边界，宽高先夹到 [min, 层边长]。 */
export function clampRect(
  rect: NodeBox,
  design: DesignSize,
  minW = 1,
  minH = 1,
): NodeBox {
  const w = Math.min(
    Math.max(rect.w, Math.max(1, minW)),
    Math.max(1, design.width),
  )
  const h = Math.min(
    Math.max(rect.h, Math.max(1, minH)),
    Math.max(1, design.height),
  )
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, design.width - w))
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, design.height - h))
  return { x, y, w, h }
}

/** 两矩形是否相交（AABB）。 */
export function rectsOverlap(a: NodeBox, b: NodeBox): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  )
}

/** 矩形是否完全落在本层边界内。 */
export function isInBounds(rect: NodeBox, design: DesignSize): boolean {
  return (
    rect.x >= -EPS &&
    rect.y >= -EPS &&
    rect.x + rect.w <= design.width + EPS &&
    rect.y + rect.h <= design.height + EPS
  )
}

/** 带身份的矩形，供找空位/整理时排除自己与回写。 */
export interface PlacedRect extends NodeBox {
  id: string
}

/**
 * 找一个 w×h 的空位：按步进扫描避开已有矩形。
 * 满布时退到左上、当前最底之下，并用 `inBounds: false` 告知越界——
 * 静默塞出画布外等于把节点弄丢。
 */
export function findFreeSlot(input: {
  rects: readonly PlacedRect[]
  w: number
  h: number
  design: DesignSize
  stepX: number
  stepY: number
  offsetX?: number
  offsetY?: number
  excludeId?: string
}): { x: number; y: number; inBounds: boolean } {
  const { rects, design } = input
  const others = rects.filter((rect) => rect.id !== input.excludeId)
  const w = Math.min(input.w, design.width)
  const h = Math.min(input.h, design.height)
  const stepX = input.stepX > 0 ? input.stepX : Math.max(1, w)
  const stepY = input.stepY > 0 ? input.stepY : Math.max(1, h)
  const offsetX = input.offsetX ?? 0
  const offsetY = input.offsetY ?? 0

  for (let y = offsetY; y + h <= design.height + EPS; y += stepY) {
    for (let x = offsetX; x + w <= design.width + EPS; x += stepX) {
      const candidate = { x, y, w, h }
      if (!others.some((other) => rectsOverlap(candidate, other))) {
        return { x, y, inBounds: true }
      }
    }
  }
  const maxBottom = others.reduce(
    (low, other) => Math.max(low, other.y + other.h),
    0,
  )
  return {
    x: offsetX,
    y: Math.min(maxBottom, Math.max(0, design.height - h)),
    inBounds: maxBottom + h <= design.height + EPS,
  }
}

/**
 * 整理布局：按 (y, x) 逐个重新紧凑放置，消重叠并钳回边界。
 * 只动位置，不动宽高与相对先后；返回按入参同序的新数组。
 */
export function tidyRects(
  rects: readonly PlacedRect[],
  design: DesignSize,
  stepX: number,
  stepY: number,
): PlacedRect[] {
  const ordered = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: PlacedRect[] = []
  for (const rect of ordered) {
    const w = Math.min(Math.max(1, rect.w), design.width)
    const h = Math.min(Math.max(1, rect.h), design.height)
    const slot = findFreeSlot({ rects: placed, w, h, design, stepX, stepY })
    placed.push({ ...rect, x: slot.x, y: slot.y, w, h })
  }
  return rects.map((rect) => placed.find((p) => p.id === rect.id) ?? rect)
}

/** 对齐方式：左/水平居中/右 + 顶/垂直居中/底。 */
export const ALIGN_KINDS = [
  'left',
  'hcenter',
  'right',
  'top',
  'vcenter',
  'bottom',
] as const
export type AlignKind = (typeof ALIGN_KINDS)[number]

/**
 * 对齐一组矩形（≥2）：以选中集的包围盒为基准，返回与入参同序的新数组。
 * 不足两个原样浅拷贝返回。
 */
export function alignRects(
  rects: readonly NodeBox[],
  kind: AlignKind,
): NodeBox[] {
  if (rects.length < 2) return rects.map((rect) => ({ ...rect }))
  const minX = Math.min(...rects.map((rect) => rect.x))
  const maxRight = Math.max(...rects.map((rect) => rect.x + rect.w))
  const minY = Math.min(...rects.map((rect) => rect.y))
  const maxBottom = Math.max(...rects.map((rect) => rect.y + rect.h))
  const centerX = (minX + maxRight) / 2
  const centerY = (minY + maxBottom) / 2
  return rects.map((rect) => {
    switch (kind) {
      case 'left':
        return { ...rect, x: minX }
      case 'hcenter':
        return { ...rect, x: centerX - rect.w / 2 }
      case 'right':
        return { ...rect, x: maxRight - rect.w }
      case 'top':
        return { ...rect, y: minY }
      case 'vcenter':
        return { ...rect, y: centerY - rect.h / 2 }
      case 'bottom':
        return { ...rect, y: maxBottom - rect.h }
    }
  })
}

/** 该轴上的起点：x 轴取左边，y 轴取上边。 */
function startOf(rect: NodeBox, axis: 'x' | 'y'): number {
  return axis === 'x' ? rect.x : rect.y
}

/** 该轴上的尺寸：x 轴取宽，y 轴取高。 */
function sizeOf(rect: NodeBox, axis: 'x' | 'y'): number {
  return axis === 'x' ? rect.w : rect.h
}

/** 按该轴起点排序后的下标序；入参同序不变，只给遍历次序。 */
function orderByAxis(rects: readonly NodeBox[], axis: 'x' | 'y'): number[] {
  const order = rects.map((_, index) => index)
  order.sort((a, b) => {
    const left = rects[a]
    const right = rects[b]
    if (left === undefined || right === undefined) return 0
    return startOf(left, axis) - startOf(right, axis)
  })
  return order
}

/** 首尾定位：首个的起点，与首尾跨度均分掉各自尺寸后剩下的间隙。 */
function spanOf(
  rects: readonly NodeBox[],
  order: readonly number[],
  axis: 'x' | 'y',
): { start: number; gap: number } | null {
  const firstIndex = order[0]
  const lastIndex = order[order.length - 1]
  if (firstIndex === undefined || lastIndex === undefined) return null
  const first = rects[firstIndex]
  const last = rects[lastIndex]
  if (first === undefined || last === undefined) return null
  const start = startOf(first, axis)
  const end = startOf(last, axis) + sizeOf(last, axis)
  const total = order.reduce((sum, index) => {
    const rect = rects[index]
    return rect === undefined ? sum : sum + sizeOf(rect, axis)
  }, 0)
  return { start, gap: (end - start - total) / (order.length - 1) }
}

/**
 * 等间距分布（≥3）：按该轴排序后首尾不动、中间使相邻间隙均等；
 * 重叠时间隙为负仍均等。返回与入参同序的新数组。
 */
export function distributeRects(
  rects: readonly NodeBox[],
  axis: 'x' | 'y',
): NodeBox[] {
  const out = rects.map((rect) => ({ ...rect }))
  if (rects.length < 3) return out
  const order = orderByAxis(rects, axis)
  const span = spanOf(rects, order, axis)
  if (span === null) return out
  let cursor = span.start
  for (const index of order) {
    const rect = rects[index]
    if (rect === undefined) continue
    out[index] = axis === 'x' ? { ...rect, x: cursor } : { ...rect, y: cursor }
    cursor += sizeOf(rect, axis) + span.gap
  }
  return out
}
