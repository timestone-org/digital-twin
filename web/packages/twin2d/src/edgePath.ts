/**
 * @fileoverview 连线的圆角折线 path 串、四档走线路由与统一入口 `edgePath()`（含反向
 * 渲染）；周长参数化、反投影与弧长取点在 geometry.ts。
 * 逐条口径见 docs/MODULE_TWIN_2D_DESIGN.md §8 与 §7.9 #63–#66。
 */
import { pointAlong, sideNormal } from './geometry'
import type { Pt } from './geometry'
import type { Twin2dRouteKind, Twin2dSide } from './kinds'
import { finiteOr } from './sanitize'

/** path 串的坐标精度 */
const COORD_DIGITS = 1
/** 圆角退化下限 */
const MIN_CORNER_RADIUS = 0.5
/** 近共线判定 */
const MAX_CORNER_DOT = 0.999
/** 直连阈值 */
const STRAIGHT_GAP = 0.5
/** 贝塞尔控制点的最小外推 */
const BEZIER_MIN_OFFSET = 40
/** 贝塞尔控制点的外推比例 */
const BEZIER_OFFSET_RATIO = 0.4

/**
 * path 串里的一个坐标：定到 0.1 像素并去掉尾随零。
 * ⚠ 不定位数的话浮点算出来的 path 会带十几位小数，diff 与断言都没法读。
 * @param v 坐标值，非有限值收成 0
 */
function fmt(v: number): string {
  return String(Number(finiteOr(v, 0).toFixed(COORD_DIGITS)))
}

/** 折线的一段。 */
interface Seg {
  a: Pt
  b: Pt
}

/**
 * 折线相邻点两两成段；点不足两个时为空表。
 * @param pts 折线点序列
 */
function segmentsOf(pts: readonly Pt[]): Seg[] {
  const segs: Seg[] = []
  let prev: Pt | null = null
  for (const cur of pts) {
    if (prev !== null) segs.push({ a: prev, b: cur })
    prev = cur
  }
  return segs
}

/**
 * 一个内点处的绘制命令：够半径就上圆角，否则直接拐直角。
 * ⚠ 两条退化保护缺一不可。`rr < 0.5` 那条顺带兜住 lenIn/lenOut 为 0 的除零，
 * 所以它必须排在求方向之前；`dot > 0.999`（偏转约 <2.6°）那条兜住近共线——
 * 两个切点几乎共线时弦长≈直径，SVG 会把这段弧画成一个半圆凸包，用户把拐点拖到
 * 与两邻点近共线的位置就看得见那个凸起。
 * @param prev 上一个点
 * @param cur 拐点
 * @param next 下一个点
 * @param radius 拐角半径上限
 */
function cornerCommands(prev: Pt, cur: Pt, next: Pt, radius: number): string {
  const sharp = `L${fmt(cur.x)},${fmt(cur.y)}`
  const lenIn = Math.hypot(cur.x - prev.x, cur.y - prev.y)
  const lenOut = Math.hypot(next.x - cur.x, next.y - cur.y)
  const rr = Math.min(radius, lenIn / 2, lenOut / 2)
  if (rr < MIN_CORNER_RADIUS) return sharp
  const inX = (cur.x - prev.x) / lenIn
  const inY = (cur.y - prev.y) / lenIn
  const outX = (next.x - cur.x) / lenOut
  const outY = (next.y - cur.y) / lenOut
  if (inX * outX + inY * outY > MAX_CORNER_DOT) return sharp
  const ax = fmt(cur.x - inX * rr)
  const ay = fmt(cur.y - inY * rr)
  const bx = fmt(cur.x + outX * rr)
  const by = fmt(cur.y + outY * rr)
  const sweep = inX * outY - inY * outX > 0 ? 1 : 0
  return `L${ax},${ay} A${fmt(rr)},${fmt(rr)} 0 0 ${sweep} ${bx},${by}`
}

/**
 * 折线点序列 → 带圆角的 SVG path d；点不足两个时为空串。
 * @param pts 折线点序列
 * @param radius 拐角半径上限
 */
export function roundCorners(pts: readonly Pt[], radius: number): string {
  const first = pts[0]
  if (first === undefined || pts.length < 2) return ''
  const out = [`M${fmt(first.x)},${fmt(first.y)}`]
  let prev: Seg | null = null
  let end = first
  for (const seg of segmentsOf(pts)) {
    if (prev !== null) out.push(cornerCommands(prev.a, seg.a, seg.b, radius))
    prev = seg
    end = seg.b
  }
  out.push(`L${fmt(end.x)},${fmt(end.y)}`)
  return out.join(' ')
}

/** 横向面的两档 */
function isHorizontal(side: Twin2dSide): boolean {
  return side === 'left' || side === 'right'
}

/**
 * 正交路由：按两端出线方向选中线或 L 形拐点，产出待上圆角的点序列。
 * ⚠ 只吃四档 Side，`'auto'` 必须先经 `resolveSide()` 解析掉（§4.4）。
 * @param s 起点
 * @param e 终点
 * @param sSide 起点出线方向
 * @param tSide 终点出线方向
 */
export function orthogonalRoute(
  s: Pt,
  e: Pt,
  sSide: Twin2dSide,
  tSide: Twin2dSide,
): Pt[] {
  const dx = Math.abs(s.x - e.x)
  const dy = Math.abs(s.y - e.y)
  if (dx < STRAIGHT_GAP || dy < STRAIGHT_GAP) return [s, e]
  const sH = isHorizontal(sSide)
  const tH = isHorizontal(tSide)
  if (sH && tH) {
    const midX = (s.x + e.x) / 2
    return [s, { x: midX, y: s.y }, { x: midX, y: e.y }, e]
  }
  if (!sH && !tH) {
    const midY = (s.y + e.y) / 2
    return [s, { x: s.x, y: midY }, { x: e.x, y: midY }, e]
  }
  // 混合：横向那端先走横的
  if (sH) return [s, { x: e.x, y: s.y }, e]
  return [s, { x: s.x, y: e.y }, e]
}

/** `edgePath()` 的入参：两端、拐点、走线档位与反向标志一次给全。 */
export interface EdgePathInput {
  start: Pt
  end: Pt
  startSide: Twin2dSide
  endSide: Twin2dSide
  /** 画布坐标系上的拐点；非空时**优先于** `route`。 */
  waypoints: readonly Pt[]
  /** 四档走线；`orthogonal` 与 `step` 指向同一条路由。 */
  route: Twin2dRouteKind
  /** 拐角半径上限。 */
  radius: number
  /** 标签落点占折线弧长的比例，0..1。 */
  labelAt: number
  /**
   * 反向渲染。
   * ⚠ 它必须由本函数消费而不是由调用方自己换：反向 = 端点互换 + side 互换 +
   * waypoints 整体 reverse 三件同时做，只换端点不反序拐点会让带拐点的路径自己
   * 交叉，而它看起来像「拐点算错了」（§7.9 #66）。
   */
  reversed: boolean
}

/** `edgePath()` 的产物。 */
export interface EdgePathResult {
  /** SVG path 的 d。 */
  path: string
  /** 标签锚点。 */
  label: Pt
  /** 完整折线点序列；箭头朝向取末两点。 */
  points: Pt[]
}

/** 摆正后的两端。 */
interface OrientedEnds {
  start: Pt
  end: Pt
  startSide: Twin2dSide
  endSide: Twin2dSide
  waypoints: readonly Pt[]
}

/**
 * 按 `reversed` 摆正两端：端点互换、side 互换、拐点整体反序。
 * @param input 原始入参
 */
function orientEnds(input: EdgePathInput): OrientedEnds {
  if (!input.reversed) {
    return {
      start: input.start,
      end: input.end,
      startSide: input.startSide,
      endSide: input.endSide,
      waypoints: input.waypoints,
    }
  }
  return {
    start: input.end,
    end: input.start,
    startSide: input.endSide,
    endSide: input.startSide,
    waypoints: [...input.waypoints].reverse(),
  }
}

/**
 * 折线分支的产物：圆角 path + 弧长标签锚点。
 * @param points 折线点序列
 * @param radius 拐角半径上限
 * @param labelAt 标签落点比例
 */
function polylineResult(
  points: Pt[],
  radius: number,
  labelAt: number,
): EdgePathResult {
  return {
    path: roundCorners(points, radius),
    label: pointAlong(points, labelAt),
    points,
  }
}

/**
 * 贝塞尔分支：控制点按两端出线方向外推 `max(40, 弦长×0.4)`。
 * @param ends 已摆正的两端
 * @param labelAt 标签落点比例
 */
function bezierPath(ends: OrientedEnds, labelAt: number): EdgePathResult {
  const { start: s, end: e } = ends
  const chord = Math.hypot(e.x - s.x, e.y - s.y)
  const off = Math.max(BEZIER_MIN_OFFSET, chord * BEZIER_OFFSET_RATIO)
  const ds = sideNormal(ends.startSide)
  const de = sideNormal(ends.endSide)
  const c1 = { x: s.x + ds.x * off, y: s.y + ds.y * off }
  const c2 = { x: e.x + de.x * off, y: e.y + de.y * off }
  const curve = `C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)}`
  return {
    path: `M${fmt(s.x)},${fmt(s.y)} ${curve} ${fmt(e.x)},${fmt(e.y)}`,
    // 标签走弦而不是 points：c2 不在曲线上，拿它插值会把标签甩到曲线外
    label: pointAlong([s, e], labelAt),
    // ⚠ points 里多出来的 c2 是末控制点，不是路径上的点：三次贝塞尔 B'(1) ∝ e−c2，
    // 而箭头朝向取末两点——带上它箭头才与曲线端点相切，去掉它箭头按弦向 e−s 画，
    // 非轴对齐时肉眼可见地歪
    points: [s, c2, e],
  }
}

/**
 * 连线路径统一入口：编辑器与运行态共用同一份产物，同一份配置才画出同一条线。
 * 拐点非空时优先走圆角折线，否则按四档走线分流。
 * @param input 两端、拐点、走线档位、半径、标签比例与反向标志
 */
export function edgePath(input: EdgePathInput): EdgePathResult {
  const ends = orientEnds(input)
  const { radius, labelAt } = input
  if (ends.waypoints.length > 0) {
    const points = [ends.start, ...ends.waypoints, ends.end]
    return polylineResult(points, radius, labelAt)
  }
  if (input.route === 'straight') {
    const points = [ends.start, ends.end]
    const tail = `L${fmt(ends.end.x)},${fmt(ends.end.y)}`
    return {
      path: `M${fmt(ends.start.x)},${fmt(ends.start.y)} ${tail}`,
      label: pointAlong(points, labelAt),
      points,
    }
  }
  if (input.route === 'bezier') return bezierPath(ends, labelAt)
  const { start, end, startSide, endSide } = ends
  const points = orthogonalRoute(start, end, startSide, endSide)
  return polylineResult(points, radius, labelAt)
}
