/**
 * @fileoverview 画布用户缩放倍率的纯逻辑。适应窗口的 letterbox 倍率把 1920 舞台
 * 压到 0.4~0.5，做不了精细对位；用户倍率与它互斥——null = 跟随适应窗口，
 * 数值 = 固定倍率，超出视口交给画布滚动。
 * ⚠ 屏幕像素 ↔ 设计像素的换算除数必须统一用「生效倍率」，否则一开缩放就会
 * 「拖 1cm 跳 2cm」。
 */

/** 画布缩放倍率；null = 适应窗口。 */
export type CanvasZoom = number | null

/** 缩放档位：工具栏菜单与逐档快捷键共用。 */
export const ZOOM_PRESETS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3]

/** 低于 0.1 已无法辨认，高于 4 滚动成本大于收益。 */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

// ⚠ 浮点容差：逐档时 0.7499999 这类累积误差会把当前档自己算成「下一档」
const EPS = 1e-4

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

/** 逐档：升取第一个明显大于当前的档，降取最后一个明显小于的；越界钳到限。 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const zoom = clampZoom(current)
  if (direction === 1) {
    const up = ZOOM_PRESETS.find((preset) => preset > zoom + EPS)
    return clampZoom(up ?? MAX_ZOOM)
  }
  const down = [...ZOOM_PRESETS].reverse().find((preset) => preset < zoom - EPS)
  return clampZoom(down ?? MIN_ZOOM)
}

/**
 * 滚轮连续缩放走指数映射：放大再缩小同样格数能回到原倍率，
 * 线性加减在小倍率处步子过大。
 */
export function wheelZoom(current: number, deltaY: number): number {
  const zoom = clampZoom(current)
  if (!Number.isFinite(deltaY) || deltaY === 0) return zoom
  return clampZoom(zoom * Math.exp(-deltaY / 400))
}

/** 百分比标签取整，免得 46.0999% 抖动。 */
export function zoomPercent(scale: number): string {
  const value = Number.isFinite(scale) && scale > 0 ? scale : 1
  return `${Math.round(value * 100)}%`
}

/**
 * 以指针为锚点缩放后的新滚动位置：让设计坐标重新落回原屏幕位置。
 * @param scrollNow 缩放已生效、尚未修正滚动时的滚动位置
 * @param stageStart 缩放后舞台原点的 client 坐标
 */
export function anchorScroll(
  scrollNow: number,
  stageStart: number,
  designPos: number,
  scale: number,
  clientPos: number,
): number {
  return Math.max(0, scrollNow + (stageStart + designPos * scale - clientPos))
}
