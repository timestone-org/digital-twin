/**
 * @fileoverview 画布视口：平移、缩放，以及屏幕↔画布两套坐标的换算。
 *
 * ⚠ 自绘画布的第一条自负责任：手势期间挂在 `window` 上的监听与视口的
 * `ResizeObserver` 卸载时必须摘掉，否则来回进出这一页会攒下几份
 * （ADR-0036 的后果一节）。
 */
import { onBeforeUnmount, reactive, readonly, ref } from 'vue'

/** 缩放上下限。再小看不清端口，再大一屏放不下两个节点。 */
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2.5
/** 滚轮一格的缩放步长。 */
const WHEEL_STEP = 0.0015
/** 适应视图时四周留的空白（画布像素）。 */
const FIT_PADDING = 48

/** 画布上的一个点。 */
export interface CanvasPoint {
  left: number
  top: number
}

/** 一个矩形，用来算「适应视图」。 */
export interface CanvasRect extends CanvasPoint {
  width: number
  height: number
}

/** 视口的平移与缩放。 */
export interface Viewport extends CanvasPoint {
  zoom: number
}

/**
 * 一块可平移可缩放的视口。
 *
 * @param host 视口那个 DOM 元素的引用，用来量真实尺寸与做坐标换算
 */
export function useCanvasViewport(
  host: Readonly<{ value: HTMLElement | null }>,
) {
  const viewport = reactive<Viewport>({ left: 0, top: 0, zoom: 1 })
  const size = reactive({ width: 0, height: 0 })
  const observer = ref<ResizeObserver | null>(null)

  /** 把屏幕坐标换成画布坐标。 */
  function toCanvas(clientLeft: number, clientTop: number): CanvasPoint {
    const box = host.value?.getBoundingClientRect()
    const originLeft = box?.left ?? 0
    const originTop = box?.top ?? 0
    return {
      left: (clientLeft - originLeft - viewport.left) / viewport.zoom,
      top: (clientTop - originTop - viewport.top) / viewport.zoom,
    }
  }

  /** 平移一段屏幕距离。 */
  function pan(deltaLeft: number, deltaTop: number): void {
    viewport.left += deltaLeft
    viewport.top += deltaTop
  }

  /**
   * 以某个屏幕点为锚缩放。
   *
   * ⚠ 必须以指针所在的点为锚：以视口中心为锚的话，用户放大时目标会往边上跑，
   * 手感像是画布在躲他。
   */
  function zoomAt(clientLeft: number, clientTop: number, delta: number): void {
    const before = toCanvas(clientLeft, clientTop)
    const next = clamp(viewport.zoom * (1 - delta * WHEEL_STEP))
    viewport.zoom = next
    const after = toCanvas(clientLeft, clientTop)
    viewport.left += (after.left - before.left) * next
    viewport.top += (after.top - before.top) * next
  }

  /** 把一组矩形整体放进视野。空清单时回到原点。 */
  function fit(rects: readonly CanvasRect[]): void {
    Object.assign(viewport, fitViewport(rects, size))
  }

  /** 开始盯着视口尺寸。装好之后 `fit` 才算得出来。 */
  function observe(): void {
    const element = host.value
    if (element === null || observer.value !== null) return
    observer.value = watchSize(element, size)
  }

  onBeforeUnmount(() => {
    observer.value?.disconnect()
    observer.value = null
  })

  return { viewport, size: readonly(size), toCanvas, pan, zoomAt, fit, observe }
}

/** 把一组矩形整体放进视野时该有的平移与缩放。 */
function fitViewport(
  rects: readonly CanvasRect[],
  size: Readonly<{ width: number; height: number }>,
): Viewport {
  if (rects.length === 0 || size.width === 0) {
    return { left: 0, top: 0, zoom: 1 }
  }
  const bounds = boundsOf(rects)
  const zoom = clamp(
    Math.min(
      (size.width - FIT_PADDING * 2) / Math.max(bounds.width, 1),
      (size.height - FIT_PADDING * 2) / Math.max(bounds.height, 1),
    ),
  )
  return {
    zoom,
    left: size.width / 2 - (bounds.left + bounds.width / 2) * zoom,
    top: size.height / 2 - (bounds.top + bounds.height / 2) * zoom,
  }
}

/** 盯着一个元素的尺寸，把它写进 `size`。 */
function watchSize(
  element: HTMLElement,
  size: { width: number; height: number },
): ResizeObserver {
  const watcher = new ResizeObserver(() => {
    size.width = element.clientWidth
    size.height = element.clientHeight
  })
  watcher.observe(element)
  size.width = element.clientWidth
  size.height = element.clientHeight
  return watcher
}

function clamp(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

function boundsOf(rects: readonly CanvasRect[]): CanvasRect {
  const left = Math.min(...rects.map((item) => item.left))
  const top = Math.min(...rects.map((item) => item.top))
  const right = Math.max(...rects.map((item) => item.left + item.width))
  const bottom = Math.max(...rects.map((item) => item.top + item.height))
  return { left, top, width: right - left, height: bottom - top }
}
