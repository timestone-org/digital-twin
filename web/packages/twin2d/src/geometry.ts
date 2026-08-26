/**
 * @fileoverview 节点盒的周长参数化、反投影、出线方向解析与折线弧长取点：编辑器与
 * 运行态共用的一处几何真源；走线与 path 串生成在 edgePath.ts。
 * 逐条口径见 docs/MODULE_TWIN_2D_DESIGN.md §8。
 */
import { TWIN_2D_SIDE_PRIORITY } from './kinds'
import type { Twin2dPortSide, Twin2dSide } from './kinds'
import { clamp, finiteOr } from './sanitize'
import type { Twin2dPortAt } from './types'

/** 画布坐标系上的一个点。 */
export interface Pt {
  x: number
  y: number
}

/**
 * 节点盒，**以中心为参考**：x/y 是中心点，w/h 是宽高。
 * ⚠ 节点实例的 `x/y` 是左上角（§4.6），进这里之前必须换算：漏了的表现是全图连线
 * 整体偏半个节点，而它看起来像「锚点算错了」。
 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 周长上的一处：落点与所在边的外法线。 */
export interface PerimeterPoint {
  point: Pt
  normal: Pt
}

/** 周长四等分的一段 */
const PERIM_SEG = 0.25
/** 角点判定容差 */
const CORNER_EPS = 1e-9
/** 45° 外法线的单位分量 */
const DIAG = Math.SQRT1_2
/** 归一坐标的中点 */
const UNIT_MID = 0.5

/**
 * 把任意数值折进 [0,1)。
 * @param t 原始周长参数，非有限值收成 0
 */
export function wrap01(t: number): number {
  if (!Number.isFinite(t)) return 0
  return ((t % 1) + 1) % 1
}

/**
 * 四档边的外法线单位向量（画布坐标系，y 轴向下）。
 * ⚠ 全仓只有这一处定义「哪条边朝哪」：周长参数化的法线、端口出线方向跟着节点转、
 * 贝塞尔控制点的外推三处都读它。另写一份的表现是同一条边在两处朝反方向，
 * 而每一处单看都说得通。
 * @param side 四档边
 */
export function sideNormal(side: Twin2dSide): Pt {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 }
    case 'right':
      return { x: 1, y: 0 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
  }
}

/**
 * 盒的某条边上 t∈[0,1] 处的点（t=0.5 即边中点）。
 * @param box 中心参考盒
 * @param side 四档边
 * @param t 沿边的归一位置，越界夹取、非有限收成 0
 */
export function anchorPoint(box: Box, side: Twin2dSide, t = 0.5): Pt {
  const k = clamp(finiteOr(t, 0), 0, 1)
  const minX = box.x - box.w / 2
  const minY = box.y - box.h / 2
  switch (side) {
    case 'top':
      return { x: minX + box.w * k, y: minY }
    case 'right':
      return { x: minX + box.w, y: minY + box.h * k }
    case 'bottom':
      return { x: minX + box.w * k, y: minY + box.h }
    case 'left':
      return { x: minX, y: minY + box.h * k }
  }
}

/**
 * 四个角点的精确解，未命中角点返回 null。
 * ⚠ 角点给 45° 外法线：它同时属于两条边，取其中任一条边的轴向法线都会让按法线
 * 推出去的引脚贴着盒边斜插回盒内。
 * @param box 中心参考盒
 * @param p 已折进 [0,1) 的周长参数
 */
function cornerPoint(box: Box, p: number): PerimeterPoint | null {
  if (p < CORNER_EPS) {
    return { point: anchorPoint(box, 'top', 0), normal: { x: -DIAG, y: -DIAG } }
  }
  if (Math.abs(p - 0.25) < CORNER_EPS) {
    return {
      point: anchorPoint(box, 'right', 0),
      normal: { x: DIAG, y: -DIAG },
    }
  }
  if (Math.abs(p - 0.5) < CORNER_EPS) {
    return { point: anchorPoint(box, 'right', 1), normal: { x: DIAG, y: DIAG } }
  }
  if (Math.abs(p - 0.75) < CORNER_EPS) {
    return { point: anchorPoint(box, 'left', 1), normal: { x: -DIAG, y: DIAG } }
  }
  return null
}

/**
 * 周长参数处的落点与外法线：顺时针绕一圈，原点在左上角，四等分
 * `top[0,.25) → right[.25,.5) → bottom[.5,.75) → left[.75,1)`。
 * ⚠ bottom 与 left 两段用 `1 - local` **反向**参数化，顺时针闭环靠的就是这两段；
 * 写成正向的表现是只有这两条边上的点左右（上下）镜像、其余三段全对——
 * 这种「只在两条边上错」的偏差靠肉眼看图基本发现不了。
 * @param box 中心参考盒
 * @param perimT 周长参数，自动折进 [0,1)
 */
export function perimeterPoint(box: Box, perimT: number): PerimeterPoint {
  const p = wrap01(perimT)
  const corner = cornerPoint(box, p)
  if (corner !== null) return corner
  const seg = Math.floor(p / PERIM_SEG)
  const local = (p - seg * PERIM_SEG) / PERIM_SEG
  switch (seg) {
    case 0:
      return {
        point: anchorPoint(box, 'top', local),
        normal: sideNormal('top'),
      }
    case 1:
      return {
        point: anchorPoint(box, 'right', local),
        normal: sideNormal('right'),
      }
    case 2:
      return {
        point: anchorPoint(box, 'bottom', 1 - local),
        normal: sideNormal('bottom'),
      }
    default:
      return {
        point: anchorPoint(box, 'left', 1 - local),
        normal: sideNormal('left'),
      }
  }
}

/**
 * 四条边里取分数最小的一条。
 * ⚠ 并列一律按 `TWIN_2D_SIDE_PRIORITY` 定序，全仓只有这一处决定并列怎么办：
 * 另写一份的表现是同一个端口在反投影与 `resolveSide` 两处朝不同方向出线。
 * @param scoreOf 一条边的分数，越小越近
 */
function nearestSide(scoreOf: (side: Twin2dSide) => number): Twin2dSide {
  let best: Twin2dSide = TWIN_2D_SIDE_PRIORITY[0]
  let bestScore = scoreOf(best)
  for (const side of TWIN_2D_SIDE_PRIORITY) {
    const score = scoreOf(side)
    if (score < bestScore) {
      best = side
      bestScore = score
    }
  }
  return best
}

/**
 * 反投影：把任意点投到盒周长上最近的位置，返回 perimT∈[0,1)。
 * @param box 中心参考盒
 * @param p 画布坐标系上的点，盒内盒外都收
 */
export function projectToPerimT(box: Box, p: Pt): number {
  const minX = box.x - box.w / 2
  const maxX = box.x + box.w / 2
  const minY = box.y - box.h / 2
  const maxY = box.y + box.h / 2
  // 除零护栏
  const w = box.w || 1
  const h = box.h || 1
  const cx = clamp(p.x, minX, maxX)
  const cy = clamp(p.y, minY, maxY)
  const hit: Record<Twin2dSide, { d: number; t: number }> = {
    top: { d: Math.hypot(p.x - cx, p.y - minY), t: 0.25 * ((cx - minX) / w) },
    right: {
      d: Math.hypot(p.x - maxX, p.y - cy),
      t: 0.25 + 0.25 * ((cy - minY) / h),
    },
    bottom: {
      d: Math.hypot(p.x - cx, p.y - maxY),
      t: 0.5 + 0.25 * ((maxX - cx) / w),
    },
    left: {
      d: Math.hypot(p.x - minX, p.y - cy),
      t: 0.75 + 0.25 * ((maxY - cy) / h),
    },
  }
  const side = nearestSide((s) => hit[s].d)
  return wrap01(hit[side].t)
}

/**
 * 周长参数落在哪条边上。
 * @param t 周长参数，自动折进 [0,1)
 */
export function perimTToSide(t: number): Twin2dSide {
  const p = wrap01(t)
  if (p < 0.25) return 'top'
  if (p < 0.5) return 'right'
  if (p < 0.75) return 'bottom'
  return 'left'
}

/**
 * 把端口的出线方向解析成四档之一。
 * ⚠ 必须在进 `orthogonalRoute` 之前解析掉：`'auto'` 流进路由等于走一个隐式的
 * undefined 分支，表现是这一条线从节点中心横穿出去、其余线全对（§4.4）。
 * @param box 中心参考盒，`xy` 落点要靠它把归一值换算成像素
 * @param side 端口上配的出线方向，含待解析的 `'auto'`
 * @param at 端口落点：`perim` 按 t 所在边推，`xy` 按到四边的最近边推
 */
export function resolveSide(
  box: Box,
  side: Twin2dPortSide,
  at: Twin2dPortAt,
): Twin2dSide {
  if (side !== 'auto') return side
  if (at.kind === 'perim') return perimTToSide(at.t)
  const x = clamp(finiteOr(at.x, UNIT_MID), 0, 1)
  const y = clamp(finiteOr(at.y, UNIT_MID), 0, 1)
  // ⚠ 距离按像素而不是按归一值：宽扁盒上归一值会把一个明显更贴近上边的点判成靠左，
  // 表现是这一根线从错误的方向出去、其余线全对
  const gap: Record<Twin2dSide, number> = {
    top: y * box.h,
    right: (1 - x) * box.w,
    bottom: (1 - y) * box.h,
    left: x * box.w,
  }
  return nearestSide((s) => gap[s])
}

/**
 * 折线点序列的总长；点不足两个时为 0。
 * @param pts 折线点序列
 */
export function polylineLength(pts: readonly Pt[]): number {
  let total = 0
  let prev: Pt | null = null
  for (const cur of pts) {
    if (prev !== null) total += Math.hypot(cur.x - prev.x, cur.y - prev.y)
    prev = cur
  }
  return total
}

/**
 * 沿折线弧长取点：`t01` 是占总长的比例，空表回原点、单点表回那个点。
 * ⚠ 这是 `labelAt` 的定义式，也是一个**近似**——真正渲染的 path 由 `roundCorners`
 * 产出、拐角处带 `A` 圆弧，比折线短一点点，所以标签位置与「沿真实路径的百分比」
 * 有几像素偏差。别当 bug 去修：换 `getPointAtLength()` 要真 DOM，happy-dom 下
 * 测不了，为几像素换掉整块可测性不值（§8）。
 * @param pts 折线点序列
 * @param t01 弧长比例，越界夹取、非有限收成 0
 */
export function pointAlong(pts: readonly Pt[], t01: number): Pt {
  let target = clamp(finiteOr(t01, 0), 0, 1) * polylineLength(pts)
  let prev: Pt | null = null
  for (const cur of pts) {
    if (prev !== null) {
      const len = Math.hypot(cur.x - prev.x, cur.y - prev.y)
      if (target <= len) {
        const k = len === 0 ? 0 : target / len
        return {
          x: prev.x + (cur.x - prev.x) * k,
          y: prev.y + (cur.y - prev.y) * k,
        }
      }
      target -= len
    }
    prev = cur
  }
  return prev ?? { x: 0, y: 0 }
}
