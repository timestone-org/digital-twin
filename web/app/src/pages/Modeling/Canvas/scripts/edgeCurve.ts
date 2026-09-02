/**
 * @fileoverview 一条边画出来是什么样：贝塞尔路径、中点、以及末端箭头的朝向。
 *
 * 与连线规则分家——规则回答「能不能连」，这里只回答「连上之后长什么样」。
 */
import type { CanvasPoint } from './useCanvasViewport'

/** 贝塞尔的水平控制点距离（画布像素）。 */
const CURVE_TENSION = 60

/** 箭头三角的边长（画布像素）。 */
const ARROW_SIZE = 7

/** 一条已经算好两端坐标的边，交给 SVG 那一层去画。 */
export interface DrawnEdge {
  id: string
  from: CanvasPoint
  to: CanvasPoint
}

/** 两端的水平控制点距离。拉得越远弯得越缓。 */
function tensionOf(from: CanvasPoint, to: CanvasPoint): number {
  return Math.max(CURVE_TENSION, Math.abs(to.left - from.left) / 2)
}

/** 一条边的贝塞尔路径。两端都给画布坐标。 */
export function curveOf(from: CanvasPoint, to: CanvasPoint): string {
  const tension = tensionOf(from, to)
  return [
    `M ${from.left} ${from.top}`,
    `C ${from.left + tension} ${from.top}`,
    `${to.left - tension} ${to.top}`,
    `${to.left} ${to.top}`,
  ].join(' ')
}

/**
 * 边的中点，删除按钮挂在这里。
 *
 * 两个控制点是从两端各自水平推出去同样一段，t=0.5 处那两项正好抵消，于是中点
 * 就落在两端的算术平均上——不必真去算三次贝塞尔。
 */
export function midOf(from: CanvasPoint, to: CanvasPoint): CanvasPoint {
  return {
    left: (from.left + to.left) / 2,
    top: (from.top + to.top) / 2,
  }
}

/**
 * 末端箭头的三角形。指向入口，方向取曲线在终点处的切线——那里的切线是水平的，
 * 所以箭头恒定朝右，不必逐条算角度。
 */
export function arrowOf(to: CanvasPoint): string {
  const tip = to.left
  const back = to.left - ARROW_SIZE
  const half = ARROW_SIZE / 2
  return [
    `M ${tip} ${to.top}`,
    `L ${back} ${to.top - half}`,
    `L ${back} ${to.top + half}`,
    'Z',
  ].join(' ')
}
