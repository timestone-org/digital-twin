/**
 * @fileoverview 舞台缩放贴合的算术：四档缩放倍率，以及它的反函数——「想让上屏后
 * 恰好 1:1，画布该配多大」。两支必须住在同一个文件里，反函数才有得对照。
 *
 * ⚠ 倍率这一支是**唯一**一份：`Twin2dStage.vue` 从这里取，编辑器的 1:1 也从这里取。
 * 各写各的表现是「编辑器说 1:1、上了大屏还是缩了一点」，而两边单看都对。
 * ⚠ 只有 `contain` 吃 `fitPadding`：其余三档的意思就是「把某一轴填满」，再乘一个
 * 安全留白就填不满了，而表现是「配了 width 却两边留白」（§9.1 那张表）。
 */
import { TWIN_2D_MAX_CANVAS_SIZE, TWIN_2D_MIN_CANVAS_SIZE } from './constants'
import { clamp, finiteOr } from './sanitize'
import type { Twin2dFitMode } from './kinds'

/** 归一百分比的分母。 */
const PERCENT = 100

/** 一块矩形区域的宽高。 */
export interface Twin2dBox {
  width: number
  height: number
}

/** 缩放贴合读的那两个键；模块壳读了配置递进来，包里一处都不读配置（§3.2）。 */
export interface Twin2dFitView {
  fitMode: Twin2dFitMode
  /** 四周安全留白（%），只有 `contain` 吃它。 */
  fitPadding: number
}

/**
 * 两轴缩放倍率：`屏幕像素 = 设计像素 × 倍率`。
 * @param view 缩放档与留白
 * @param canvas 画布自己的坐标系
 * @param box 容器尺寸（CSS 像素）
 */
export function twin2dFitScales(
  view: Twin2dFitView,
  canvas: Twin2dBox,
  box: Twin2dBox,
): [number, number] {
  const kx = box.width / canvas.width
  const ky = box.height / canvas.height
  switch (view.fitMode) {
    case 'contain': {
      const scale = Math.min(kx, ky) * (1 - view.fitPadding / PERCENT)
      return [scale, scale]
    }
    case 'width':
      return [kx, kx]
    case 'height':
      return [ky, ky]
    case 'stretch':
      return [kx, ky]
    case 'none':
      return [1, 1]
  }
}

/**
 * 1:1 的画布尺寸：按它配，上屏后倍率恰好是 1，编辑器里量出来的一像素就是大屏上的
 * 一像素。
 * ⚠ `contain` 下答案是「格子 × (1 − 留白)」，不是格子本身：留白是乘在倍率上的，
 * 渲染出来的图恒等于格子的 (1 − 留白)，画布配多大都改不了这一点——想铺满整格只有
 * 把留白调成 0 这一条路。
 * ⚠ `width` / `height` 两档只钉住它填满的那一轴，另一轴原样留给用户：那一轴不参与
 * 倍率，钉死它等于替用户决定图有多高（或多宽）。
 * ⚠ 边长仍要夹进画布的上下限：格子比下限还小时 1:1 就是配不出来的，此时交出夹取后
 * 的值，由调用方照实说「差多少」，而不是在这里假装配上了。
 * @param cell 这块模块在大屏上的格子尺寸（设计像素）
 * @param view 缩放档与留白
 * @param current 当前画布尺寸，供不参与倍率的那一轴原样留用
 */
export function twin2dDesignSize(
  cell: Twin2dBox,
  view: Twin2dFitView,
  current: Twin2dBox,
): Twin2dBox {
  const shrink = 1 - finiteOr(view.fitPadding, 0) / PERCENT
  switch (view.fitMode) {
    case 'contain':
      return sized(cell.width * shrink, cell.height * shrink)
    case 'width':
      return sized(cell.width, current.height)
    case 'height':
      return sized(current.width, cell.height)
    case 'stretch':
      return sized(cell.width, cell.height)
    // 这一档倍率恒为 1，画布配多大都是 1:1，没有「该配多大」这回事
    case 'none':
      return sized(current.width, current.height)
  }
}

/**
 * 一对边长收成合法画布尺寸：取整并夹进上下限。
 * ⚠ 取整不是好看：画布边长在归一化里就是整数（`canvasSide`），这里不取整的话交出去
 * 的尺寸一存一读就变了，而 1:1 也就跟着差了半像素。
 * @param width 宽
 * @param height 高
 */
function sized(width: number, height: number): Twin2dBox {
  return { width: side(width), height: side(height) }
}

/**
 * 一条边长。
 * @param value 原始值
 */
function side(value: number): number {
  return clamp(
    Math.round(finiteOr(value, TWIN_2D_MIN_CANVAS_SIZE)),
    TWIN_2D_MIN_CANVAS_SIZE,
    TWIN_2D_MAX_CANVAS_SIZE,
  )
}
