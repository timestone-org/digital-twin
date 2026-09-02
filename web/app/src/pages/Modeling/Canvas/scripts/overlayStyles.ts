/**
 * @fileoverview 画在世界坐标**之外**的那三样东西的定位：框选框、对齐参考线、
 * 落件预览框。
 *
 * ⚠ 它们不跟着 `.dt-ml-canvas__world` 那层 transform 走，所以要自己把画布坐标
 * 乘一次缩放再加上平移；跟着走的话线宽与框边会被一起缩放，看着忽粗忽细。
 */
import type { GuideLine } from './nodeLayout'
import type { CanvasPoint, Viewport } from './useCanvasViewport'

/** 卡片的一半，落件预览框按它把光标放在框中间。 */
export const CARD_HALF: CanvasPoint = { left: 112, top: 34 }

type Style = Record<string, string>

/** 画布坐标 → 视口内的屏幕像素。 */
function onScreen(viewport: Viewport, value: number, axis: 'x' | 'y'): number {
  return value * viewport.zoom + (axis === 'x' ? viewport.left : viewport.top)
}

/** 框选框的位置与大小。 */
export function marqueeStyleOf(
  viewport: Viewport,
  from: CanvasPoint,
  to: CanvasPoint,
): Style {
  const left = Math.min(from.left, to.left)
  const top = Math.min(from.top, to.top)
  return {
    left: `${onScreen(viewport, left, 'x')}px`,
    top: `${onScreen(viewport, top, 'y')}px`,
    width: `${Math.abs(to.left - from.left) * viewport.zoom}px`,
    height: `${Math.abs(to.top - from.top) * viewport.zoom}px`,
  }
}

/** 一条参考线画在哪；竖线只给 `left`，横线只给 `top`，另一维交给样式表。 */
export function guideStylesOf(
  viewport: Viewport,
  guides: readonly GuideLine[],
): { key: string; isVertical: boolean; style: Style }[] {
  return guides.map((line) => ({
    key: `${line.axis}-${line.at}`,
    isVertical: line.axis === 'x',
    style:
      line.axis === 'x'
        ? { left: `${onScreen(viewport, line.at, 'x')}px` }
        : { top: `${onScreen(viewport, line.at, 'y')}px` },
  }))
}

/** 拖着算子在画布上空时，卡片将落在哪儿的那个虚框。 */
export function ghostStyleOf(viewport: Viewport, at: CanvasPoint): Style {
  return {
    left: `${onScreen(viewport, at.left - CARD_HALF.left, 'x')}px`,
    top: `${onScreen(viewport, at.top - CARD_HALF.top, 'y')}px`,
    width: `${CARD_HALF.left * 2 * viewport.zoom}px`,
    height: `${CARD_HALF.top * 2 * viewport.zoom}px`,
  }
}
