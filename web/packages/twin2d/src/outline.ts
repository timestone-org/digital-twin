/**
 * @fileoverview 把外接矩形上的一处周长点投到符号**画出来的外缘**上：圆角矩形、椭圆与
 * 胶囊三档各有一支解析解，`rect` 一档原样返回。
 *
 * ⚠ 端口与连线端点都走这一支：不投的话线头一律停在外接矩形上，圆柱的两头、卡片的圆角
 * 处于是悬着一截空白——而符号自己画得没错、线也画得没错，两边单看都对。
 * ⚠ 只投**位置**，不动外法线：法线定的是线出来朝哪个方向走，正交路由按它拐第一个弯。
 * 跟着投成径向的话，贴着圆角出来的那几条线会斜着扎出去（§4.4 的路由前提是四正方向）。
 * ⚠ 投影一律沿「盒心 → 原落点」这条射线：沿法线投会让顶边上的点原地不动，而顶边正是
 * 圆角矩形与椭圆差得最多的地方。
 */
import { clamp } from './sanitize'
import type { Box, PerimeterPoint, Pt } from './geometry'
import type { Twin2dOutline } from './types'

/** 射线长度小到这个数以下就当它没有方向，原样返回。 */
const MIN_RAY = 1e-9

/**
 * 一处周长点投到外缘上。
 * @param box 节点在画布上占的盒（中心参考）
 * @param outline 这份样式声明的外缘
 * @param at 外接矩形上的落点与外法线
 */
export function twin2dOutlinePoint(
  box: Box,
  outline: Twin2dOutline,
  at: PerimeterPoint,
): PerimeterPoint {
  if (outline.kind === 'rect') return at
  const half = { x: box.w / 2, y: box.h / 2 }
  if (half.x <= 0 || half.y <= 0) return at
  const dx = at.point.x - box.x
  const dy = at.point.y - box.y
  if (Math.abs(dx) < MIN_RAY && Math.abs(dy) < MIN_RAY) return at
  // ⚠ 只许往里收，绝不往外推：`xy` 端口可以被有意摆在符号内部（比如画在体身正中的
  // 那种），不夹这一手会把它们一律弹到外缘上，而配置里那个坐标看着还是对的
  const t = Math.min(1, rayHit(outline, half, { x: dx, y: dy }))
  return { point: { x: box.x + dx * t, y: box.y + dy * t }, normal: at.normal }
}

/**
 * 从盒心沿 `d` 打出去，命中外缘时 `d` 该乘多少。
 * ⚠ 入参 `d` 恰好落在外接矩形上，所以答案恒在 (0, 1]：外缘一律**内切**于外接矩形，
 * 投影只会把线头往里收，不会推到符号外面去。
 * @param outline 外缘
 * @param half 外接矩形的半宽半高
 * @param d 盒心指向原落点的向量
 */
function rayHit(outline: Twin2dOutline, half: Pt, d: Pt): number {
  switch (outline.kind) {
    case 'ellipse':
      return ellipseHit(half, d)
    case 'capsule':
      return roundRectHit(half, d, Math.min(half.x, half.y))
    case 'round':
      return roundRectHit(
        half,
        d,
        clamp(outline.r, 0, Math.min(half.x, half.y)),
      )
    case 'rect':
      return 1
  }
}

/**
 * 椭圆：`(tx/a)² + (ty/b)² = 1` 解出 t。
 * @param half 半轴
 * @param d 方向向量
 */
function ellipseHit(half: Pt, d: Pt): number {
  const k = Math.hypot(d.x / half.x, d.y / half.y)
  return k > MIN_RAY ? 1 / k : 1
}

/**
 * 圆角矩形（胶囊 = 半径取短边之半的圆角矩形）：先求与直边的交点，落在角上再求与那枚
 * 角圆的交点。
 * ⚠ 半径为 0 时直接回 1：那就是外接矩形本身，走下面的圆解只会引入浮点噪声。
 * @param half 半宽半高
 * @param d 方向向量
 * @param r 圆角半径，已夹进 [0, 短边之半]
 */
function roundRectHit(half: Pt, d: Pt, r: number): number {
  if (r <= 0) return 1
  const straight = straightHit(half, d)
  const corner = { x: half.x - r, y: half.y - r }
  const hit = { x: Math.abs(d.x) * straight, y: Math.abs(d.y) * straight }
  // 落在两条直边围出的十字区里就是直边上的点，只有两头的方角要换成圆弧
  if (hit.x <= corner.x || hit.y <= corner.y) return straight
  return circleHit(corner, r, { x: Math.abs(d.x), y: Math.abs(d.y) })
}

/**
 * 与外接矩形四条直边的交点参数。
 * @param half 半宽半高
 * @param d 方向向量
 */
function straightHit(half: Pt, d: Pt): number {
  const tx =
    Math.abs(d.x) > MIN_RAY ? half.x / Math.abs(d.x) : Number.POSITIVE_INFINITY
  const ty =
    Math.abs(d.y) > MIN_RAY ? half.y / Math.abs(d.y) : Number.POSITIVE_INFINITY
  const t = Math.min(tx, ty)
  return Number.isFinite(t) ? t : 1
}

/**
 * 射线与一枚圆心在 `c`、半径 `r` 的圆的交点参数（射线自原点出发，方向 `d`）。
 * ⚠ 判别式取到负数时回 1：算出来的就是「打不中」，此时退回外接矩形而不是产出 NaN——
 * NaN 进了坐标只会让那条线整个消失，而别的线全对。
 * @param c 圆心（第一象限）
 * @param r 半径
 * @param d 方向向量（第一象限）
 */
function circleHit(c: Pt, r: number, d: Pt): number {
  const a = d.x * d.x + d.y * d.y
  if (a <= MIN_RAY) return 1
  const b = -(d.x * c.x + d.y * c.y)
  const cc = c.x * c.x + c.y * c.y - r * r
  const disc = b * b - a * cc
  if (disc < 0) return 1
  return (-b + Math.sqrt(disc)) / a
}
