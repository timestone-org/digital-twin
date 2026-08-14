/**
 * @fileoverview 画布视口的样式与手势装配：舞台样式、指针→设计坐标换算、
 * 空格/中键平移与空格键态的 window 监听。
 * ⚠ 屏幕坐标换设计坐标一律除「生效倍率」，除错一处就是「拖 1cm 跳 2cm」。
 */
import { nextTick, type ComputedRef, type CSSProperties, type Ref } from 'vue'

import type { DesignSize, ModuleRect } from '@dt/runtime'

import {
  gridGuide,
  type EditorGridConfig,
  type SnapConfig,
} from '@/features/dashboard/canvasSnap'
import {
  anchorScroll,
  wheelZoom,
  type CanvasZoom,
} from '@/features/dashboard/canvasZoom'
import { isFormFocused } from './isFormFocused'

/** client 坐标，鼠标事件与拖放事件共用。 */
export interface ClientPoint {
  clientX: number
  clientY: number
}

export interface CanvasViewportOptions {
  design: () => DesignSize
  zoom: () => CanvasZoom
  /** ⌘滚轮缩放：受控上抛，父层不接就不缩放。 */
  onZoom: (zoom: number) => void
}

export interface CanvasViewportView {
  viewportRef: Ref<HTMLElement | null>
  stageRef: Ref<HTMLElement | null>
  /** 适应窗口倍率，工具栏显示用。 */
  fitScale: ComputedRef<number>
  /** 生效倍率：用户没定倍率时跟随适应窗口。 */
  effScale: ComputedRef<number>
  stageStyle: ComputedRef<CSSProperties>
  wrapStyle: ComputedRef<CSSProperties>
  /** 空格按住 = 平移模式。 */
  isPanMode: ComputedRef<boolean>
  pointerDesign: (at: ClientPoint) => { x: number; y: number } | null
  onWheel: (event: WheelEvent) => void
  /** 空格或中键起手的平移；接管了这次指针就返回真。 */
  startPan: (event: PointerEvent) => boolean
  centerOn: (rect: ModuleRect) => void
  stop: () => void
}

/** 舞台本体：设计尺寸原样铺开，整块一次缩放。 */
export function stageStyleOf(design: DesignSize, scale: number): CSSProperties {
  return {
    width: `${design.width}px`,
    height: `${design.height}px`,
    transform: `scale(${scale})`,
  }
}

/** 舞台的占位框：缩放后的实际尺寸，超出视口即由视口自己滚动。 */
export function wrapStyleOf(design: DesignSize, scale: number): CSSProperties {
  return {
    width: `${design.width * scale}px`,
    height: `${design.height * scale}px`,
  }
}

/** 绝对定位一个设计坐标系里的矩形；给 null 就是一个零尺寸的框。 */
export function rectStyleOf(rect: ModuleRect | null): CSSProperties {
  return {
    left: `${rect?.left ?? 0}px`,
    top: `${rect?.top ?? 0}px`,
    width: `${rect?.width ?? 0}px`,
    height: `${rect?.height ?? 0}px`,
  }
}

/** 栅格导引线的最小周期（设计像素）：再密就是一片噪点，不如不画。 */
const GRID_MIN_PERIOD_PX = 4

/** 吸附导引背景：两道 repeating-gradient 画出栅格线，色值走 token。 */
export function gridBackgroundStyle(
  design: DesignSize,
  grid: EditorGridConfig,
  snap: SnapConfig,
): CSSProperties {
  const guide = gridGuide(design, grid, snap)
  if (
    !snap.enabled ||
    guide.colPeriod < GRID_MIN_PERIOD_PX ||
    guide.rowPeriod < GRID_MIN_PERIOD_PX
  ) {
    return {}
  }
  const line = 'var(--border-subtle) 0 1px'
  return {
    backgroundImage:
      `repeating-linear-gradient(to right, ${line}, transparent 1px ${guide.colPeriod}px), ` +
      `repeating-linear-gradient(to bottom, ${line}, transparent 1px ${guide.rowPeriod}px)`,
    backgroundPosition: `${guide.offsetX}px ${guide.offsetY}px`,
  }
}

/** 指针的设计坐标（相对舞台原点）。 */
export function designPointAt(
  stage: { left: number; top: number },
  client: ClientPoint,
  scale: number,
): { x: number; y: number } {
  const divisor = scale > 0 ? scale : 1
  return {
    x: (client.clientX - stage.left) / divisor,
    y: (client.clientY - stage.top) / divisor,
  }
}

/**
 * 缩放或居中之后把某个设计坐标推回指定的屏幕位置。
 * @param input 视口与舞台元素、要钉住的设计坐标、生效倍率与目标屏幕位置
 */
export function scrollAnchored(input: {
  viewport: HTMLElement
  stage: HTMLElement
  at: { x: number; y: number }
  scale: number
  clientX: number
  clientY: number
}): void {
  const rect = input.stage.getBoundingClientRect()
  const { viewport, at, scale } = input
  viewport.scrollLeft = anchorScroll(
    viewport.scrollLeft,
    rect.left,
    at.x,
    scale,
    input.clientX,
  )
  viewport.scrollTop = anchorScroll(
    viewport.scrollTop,
    rect.top,
    at.y,
    scale,
    input.clientY,
  )
}

/**
 * 平移：按下那一刻的滚动位置加上指针的反向位移。
 * @param controller 持有这次平移的三个 window 监听
 * @param onDone 收尾回调
 */
export function panWithPointer(
  element: HTMLElement,
  event: PointerEvent,
  controller: AbortController,
  onDone: () => void,
): void {
  const origin = {
    clientX: event.clientX,
    clientY: event.clientY,
    left: element.scrollLeft,
    top: element.scrollTop,
  }
  const { signal } = controller
  window.addEventListener(
    'pointermove',
    (moved: PointerEvent) => {
      element.scrollLeft = origin.left - (moved.clientX - origin.clientX)
      element.scrollTop = origin.top - (moved.clientY - origin.clientY)
    },
    { signal },
  )
  const end = (): void => {
    controller.abort()
    onDone()
  }
  window.addEventListener('pointerup', end, { signal })
  window.addEventListener('pointercancel', end, { signal })
}

/**
 * 空格键态挂在 window 上：指针可能停在画布外才按下空格再移回来。
 * ⚠ 失焦一律复位——切到别的窗口时收不到 keyup，回来会卡在平移态。
 * @param onChange 空格按下为真、松开或失焦为假
 */
export function listenSpaceKey(
  controller: AbortController,
  onChange: (isHeld: boolean) => void,
): void {
  const { signal } = controller
  window.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isFormFocused()) return
      onChange(true)
    },
    { signal },
  )
  window.addEventListener(
    'keyup',
    (event: KeyboardEvent) => {
      if (event.code === 'Space') onChange(false)
    },
    { signal },
  )
  window.addEventListener('blur', () => onChange(false), { signal })
}

/** 视口的运行态：组合式函数只持有它，动作都是下面这几个函数。 */
export interface ViewportRuntime {
  options: CanvasViewportOptions
  viewportRef: Ref<HTMLElement | null>
  stageRef: Ref<HTMLElement | null>
  size: Ref<DesignSize>
  isSpaceHeld: Ref<boolean>
  effScale: ComputedRef<number>
  observer: ResizeObserver | null
  keys: AbortController | null
  pan: AbortController | null
}

/** 指针的设计坐标；舞台还没挂上时算不出来。 */
export function pointerDesignOf(
  runtime: ViewportRuntime,
  at: ClientPoint,
): { x: number; y: number } | null {
  const stage = runtime.stageRef.value
  if (stage === null) return null
  return designPointAt(
    stage.getBoundingClientRect(),
    at,
    runtime.effScale.value,
  )
}

function anchorViewport(
  runtime: ViewportRuntime,
  at: { x: number; y: number },
  to: ClientPoint,
): void {
  const viewport = runtime.viewportRef.value
  const stage = runtime.stageRef.value
  if (viewport === null || stage === null) return
  const scale = runtime.effScale.value
  scrollAnchored({ viewport, stage, at, scale, ...to })
}

/**
 * ⌘/Ctrl 滚轮以指针为锚缩放：先上抛倍率，等父层回传新 zoom 重排后再回推滚动，
 * 指针底下的设计坐标才不动。不带修饰键的滚轮留给视口自己滚（= 平移）。
 */
export function wheelZoomAt(runtime: ViewportRuntime, event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const at = pointerDesignOf(runtime, event)
  runtime.options.onZoom(wheelZoom(runtime.effScale.value, event.deltaY))
  if (at === null) return
  const { clientX, clientY } = event
  void nextTick(() => anchorViewport(runtime, at, { clientX, clientY }))
}

/** 空格按住或中键按下才接管指针去平移。 */
export function startPanning(
  runtime: ViewportRuntime,
  event: PointerEvent,
): boolean {
  const viewport = runtime.viewportRef.value
  if (viewport === null) return false
  if (!runtime.isSpaceHeld.value && event.button !== 1) return false
  runtime.pan?.abort()
  const controller = new AbortController()
  runtime.pan = controller
  panWithPointer(viewport, event, controller, () => {
    runtime.pan = null
  })
  return true
}

/** 把一个设计坐标系里的矩形滚到视口中央。 */
export function centerViewport(
  runtime: ViewportRuntime,
  rect: ModuleRect,
): void {
  const viewport = runtime.viewportRef.value
  if (viewport === null) return
  const view = viewport.getBoundingClientRect()
  anchorViewport(
    runtime,
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    {
      clientX: view.left + view.width / 2,
      clientY: view.top + view.height / 2,
    },
  )
}

/** 挂上视口尺寸观察与空格键态。 */
export function mountViewport(runtime: ViewportRuntime): void {
  const keys = new AbortController()
  runtime.keys = keys
  listenSpaceKey(keys, (held) => {
    runtime.isSpaceHeld.value = held
  })
  const element = runtime.viewportRef.value
  if (element === null) return
  const observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect
    if (rect !== undefined) {
      runtime.size.value = { width: rect.width, height: rect.height }
    }
  })
  observer.observe(element)
  runtime.observer = observer
  runtime.size.value = {
    width: element.clientWidth,
    height: element.clientHeight,
  }
}

/** 卸载时把观察器与两副 window 监听一起收掉。 */
export function stopViewport(runtime: ViewportRuntime): void {
  runtime.observer?.disconnect()
  runtime.observer = null
  runtime.keys?.abort()
  runtime.keys = null
  runtime.pan?.abort()
  runtime.pan = null
}
