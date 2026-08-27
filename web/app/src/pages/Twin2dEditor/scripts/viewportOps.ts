/**
 * @fileoverview 画布视口的纯算术：屏幕坐标 ⇄ 设计坐标、以指针为锚的缩放、平移、
 * 「适应」取景，以及舞台那一串 transform。视口本身由画布层持有，这里不留状态。
 *
 * ⚠ 缩放以**指针**为锚，不以画布中心为锚：以中心为锚时指针底下的那块图会往外跑，
 * 表现是「越放大越找不到刚才在看的地方」。
 * ⚠ 容器宽高为 0（首帧、被隐藏的页签）时一律回单位视口，绝不产出 NaN：
 * `translate(NaN, NaN)` 只会让整块空白，而 devtools 里看什么都正常。
 */
import { clamp, finiteOr, posDim } from '@dt/twin2d'
import type { Pt } from '@dt/twin2d'
import type { CSSProperties } from 'vue'

/**
 * 视口：`屏幕 = 设计 × scale + (tx, ty)`。
 * ⚠ 屏幕坐标以**画布宿主的左上角**为原点，不是窗口左上角。
 */
export interface Twin2dViewport {
  scale: number
  tx: number
  ty: number
}

/** 一块矩形区域的宽高（CSS 像素或设计像素，看用在哪一侧）。 */
export interface Twin2dViewBox {
  width: number
  height: number
}

/** 指针事件上那两个坐标；`PointerEvent` 与 `WheelEvent` 都满足它。 */
export interface Twin2dClientPoint {
  clientX: number
  clientY: number
}

/** 画布宿主在窗口里的原点；`DOMRect` 满足它。 */
export interface Twin2dHostRect {
  left: number
  top: number
}

/** 缩放下限：再小就只剩一团色块，不如让用户按「适应」。 */
export const TWIN_2D_MIN_ZOOM = 0.1

/** 缩放上限。 */
export const TWIN_2D_MAX_ZOOM = 8

/** 一档缩放的倍率，滚轮与工具栏的 +/− 共用。 */
export const TWIN_2D_ZOOM_STEP = 1.1

/** 「适应」时四周留白占比。 */
export const TWIN_2D_FIT_MARGIN = 0.04

/** `viewBox` 的除零护栏。 */
const MIN_CANVAS_SIDE = 1

/** 一格滚轮的 deltaY（像素档），触控板的连续小量按它折算成档数。 */
const WHEEL_NOTCH_PX = 100

/** 单次滚轮最多顶几档：触控板一次甩出的巨大 delta 不该直接跳到底。 */
const MAX_WHEEL_NOTCHES = 3

/** 没有平移也没有缩放的视口。 */
export const TWIN_2D_IDENTITY_VIEW: Readonly<Twin2dViewport> = Object.freeze({
  scale: 1,
  tx: 0,
  ty: 0,
})

/**
 * 造一个视口：倍率夹进上下限，位移收掉非有限值。
 * ⚠ 所有对外的构造口都走这里，NaN 只在这一处挡。
 * @param scale 倍率
 * @param tx 横向位移
 * @param ty 纵向位移
 */
function viewOf(scale: number, tx: number, ty: number): Twin2dViewport {
  return {
    scale: clampZoom(scale),
    tx: finiteOr(tx, 0),
    ty: finiteOr(ty, 0),
  }
}

/**
 * 倍率夹进 [0.1, 8]；非有限值回 1。
 * @param scale 原始倍率
 */
export function clampZoom(scale: number): number {
  return clamp(finiteOr(scale, 1), TWIN_2D_MIN_ZOOM, TWIN_2D_MAX_ZOOM)
}

/**
 * 屏幕像素 → 当前倍率下的设计像素。把手、命中带与吸附圈都要在屏幕上恒定几个像素，
 * 画进设计坐标系之前就得先除回倍率。
 * ⚠ 编辑器里这一路换算**只有这一份**：各层自己写 `px / scale` 的话，护栏与夹取各写
 * 各的，表现是「大部分倍率下对得上、某几档差几个像素」，而没有一条用例会红。
 * ⚠ 倍率非正时原样返回：除下去只会得到 Infinity，那一层会被撑成整块。
 * @param screenPx 屏幕上想要的尺寸
 * @param scale 当前视口倍率
 */
export function screenToDesignPx(screenPx: number, scale: number): number {
  const zoom = finiteOr(scale, 1)
  return zoom > 0 ? screenPx / zoom : screenPx
}

/**
 * 画布自己那套坐标系的 `viewBox`；各 SVG 层共用一份。
 * ⚠ 两边都过一手 `posDim`：`0 0 0 0` 会让整层什么都不画，而它看起来像「这一层没数据」。
 * @param canvas 画布尺寸
 */
export function canvasViewBox(canvas: Twin2dViewBox): string {
  return `0 0 ${posDim(canvas.width, MIN_CANVAS_SIDE)} ${posDim(canvas.height, MIN_CANVAS_SIDE)}`
}

/**
 * 指针的**宿主内**屏幕坐标。
 * @param rect 画布宿主的原点
 * @param at 指针事件
 */
export function localPoint(rect: Twin2dHostRect, at: Twin2dClientPoint): Pt {
  return {
    x: finiteOr(at.clientX, 0) - finiteOr(rect.left, 0),
    y: finiteOr(at.clientY, 0) - finiteOr(rect.top, 0),
  }
}

/**
 * 宿主内屏幕坐标 → 设计坐标。
 * @param view 当前视口
 * @param local 宿主内屏幕坐标
 */
export function toDesignPoint(view: Twin2dViewport, local: Pt): Pt {
  const divisor = view.scale > 0 ? view.scale : 1
  return {
    x: (local.x - view.tx) / divisor,
    y: (local.y - view.ty) / divisor,
  }
}

/**
 * 设计坐标 → 宿主内屏幕坐标。
 * @param view 当前视口
 * @param design 设计坐标
 */
export function toLocalPoint(view: Twin2dViewport, design: Pt): Pt {
  return {
    x: design.x * view.scale + view.tx,
    y: design.y * view.scale + view.ty,
  }
}

/**
 * 指针的设计坐标：一步到位，画布层把它接给手势状态机。
 * @param view 当前视口
 * @param rect 画布宿主的原点
 * @param at 指针事件
 */
export function designPointAt(
  view: Twin2dViewport,
  rect: Twin2dHostRect,
  at: Twin2dClientPoint,
): Pt {
  return toDesignPoint(view, localPoint(rect, at))
}

/**
 * 平移：按屏幕位移挪，倍率不变。
 * ⚠ 吃的是**屏幕**位移：平移过程中指针底下的设计坐标恒定不动，拿设计位移算的话
 * 画面纹丝不动。
 * @param view 当前视口
 * @param dx 屏幕横向位移
 * @param dy 屏幕纵向位移
 */
export function panBy(
  view: Twin2dViewport,
  dx: number,
  dy: number,
): Twin2dViewport {
  return viewOf(
    view.scale,
    view.tx + finiteOr(dx, 0),
    view.ty + finiteOr(dy, 0),
  )
}

/**
 * 缩到指定倍率，并让 `anchor` 底下的那个设计坐标钉在原地。
 * @param view 当前视口
 * @param scale 目标倍率，越界自动夹取
 * @param anchor 锚点（宿主内屏幕坐标），一般就是指针位置
 */
export function zoomTo(
  view: Twin2dViewport,
  scale: number,
  anchor: Pt,
): Twin2dViewport {
  const next = clampZoom(scale)
  const at = toDesignPoint(view, anchor)
  return viewOf(next, anchor.x - at.x * next, anchor.y - at.y * next)
}

/**
 * 滚轮缩放：deltaY 折成档数再乘倍率，锚在指针上。
 * @param view 当前视口
 * @param deltaY 滚轮的纵向增量
 * @param anchor 指针位置（宿主内屏幕坐标）
 */
export function zoomByWheel(
  view: Twin2dViewport,
  deltaY: number,
  anchor: Pt,
): Twin2dViewport {
  const notches = clamp(
    finiteOr(-deltaY, 0) / WHEEL_NOTCH_PX,
    -MAX_WHEEL_NOTCHES,
    MAX_WHEEL_NOTCHES,
  )
  return zoomTo(view, view.scale * TWIN_2D_ZOOM_STEP ** notches, anchor)
}

/**
 * 工具栏的 +/−：以视口正中为锚按倍率缩放。
 * ⚠ 不锚在正中的话，每按一次图都会往左上角跑一截。
 * @param view 当前视口
 * @param box 视口容器尺寸（CSS 像素）
 * @param factor 这一次的倍率，放大给 `TWIN_2D_ZOOM_STEP`、缩小给它的倒数
 */
export function zoomByFactor(
  view: Twin2dViewport,
  box: Twin2dViewBox,
  factor: number,
): Twin2dViewport {
  const anchor: Pt = {
    x: finiteOr(box.width, 0) / 2,
    y: finiteOr(box.height, 0) / 2,
  }
  return zoomTo(view, view.scale * finiteOr(factor, 1), anchor)
}

/**
 * 「适应」取景：整张画布等比缩进容器并居中。
 * ⚠ 容器或画布任一边为 0 时回单位视口——首帧就是这样，算下去只会得到 NaN。
 * @param canvas 画布自己的坐标系尺寸
 * @param box 视口容器尺寸（CSS 像素）
 * @param margin 四周留白占比
 */
export function fitView(
  canvas: Twin2dViewBox,
  box: Twin2dViewBox,
  margin = TWIN_2D_FIT_MARGIN,
): Twin2dViewport {
  const cw = finiteOr(canvas.width, 0)
  const ch = finiteOr(canvas.height, 0)
  const bw = finiteOr(box.width, 0)
  const bh = finiteOr(box.height, 0)
  if (cw <= 0 || ch <= 0 || bw <= 0 || bh <= 0)
    return { ...TWIN_2D_IDENTITY_VIEW }
  const keep = 1 - clamp(finiteOr(margin, 0), 0, 0.5)
  const scale = clampZoom(Math.min(bw / cw, bh / ch) * keep)
  return viewOf(scale, (bw - cw * scale) / 2, (bh - ch * scale) / 2)
}

/**
 * 舞台元素的样式：画布尺寸原样铺开，整块一次变换。
 * ⚠ `transform-origin` 必须是 `0 0`，且 CSS 的变换列表从右往左作用到点上，
 * 所以这一串正好等价于 `屏幕 = 设计 × scale + t`——与 `toLocalPoint` 同一条式子。
 * origin 一改，指针命中就与画出来的图整体错位。
 * @param view 当前视口
 * @param canvas 画布自己的坐标系尺寸
 */
export function stageStyle(
  view: Twin2dViewport,
  canvas: Twin2dViewBox,
): CSSProperties {
  return {
    width: `${canvas.width}px`,
    height: `${canvas.height}px`,
    transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
    transformOrigin: '0 0',
  }
}
