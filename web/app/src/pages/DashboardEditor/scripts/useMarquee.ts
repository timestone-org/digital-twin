/**
 * @fileoverview 空白处拖出的框选：框是设计坐标系里的矩形，松手时把相交的节点交出去。
 * ⚠ window 监听同样由 `AbortController` 持有，`pointercancel` 与卸载都要能收干净——
 * 只在 `pointerup` 里摘会留下一副永远跟着鼠标画框的监听。
 */
import { onUnmounted, ref, type Ref } from 'vue'

import type { NodeBox } from '@dt/runtime'

/** 起手多少设计像素之内还算「单击」而不是框选。 */
const MARQUEE_START_PX = 4

export interface MarqueeOptions {
  /** 指针的设计坐标；算不出来就不起手。 */
  pointerDesign: (at: {
    clientX: number
    clientY: number
  }) => { x: number; y: number } | null
  /** 与框相交的节点 id。 */
  hitIds: (box: NodeBox) => string[]
  onMarquee: (ids: string[], additive: boolean) => void
  /** 原地单击空白：清空选中；按住修饰键时不清，免得误触丢掉整批选中。 */
  onClear: () => void
}

export interface CanvasMarquee {
  /** 正在拖的框（设计坐标）；没在框选时为 null。 */
  box: Ref<NodeBox | null>
  start: (event: PointerEvent) => void
  stop: () => void
}

interface MarqueeSession {
  x: number
  y: number
  additive: boolean
  isActive: boolean
}

interface MarqueeRuntime {
  options: MarqueeOptions
  box: Ref<NodeBox | null>
  session: MarqueeSession | null
  listeners: AbortController | null
}

function stopMarquee(runtime: MarqueeRuntime): void {
  runtime.listeners?.abort()
  runtime.listeners = null
  runtime.session = null
  runtime.box.value = null
}

function onMarqueeMove(runtime: MarqueeRuntime, event: PointerEvent): void {
  const current = runtime.session
  const at = runtime.options.pointerDesign(event)
  if (current === null || at === null) return
  const dx = at.x - current.x
  const dy = at.y - current.y
  const tiny =
    Math.abs(dx) < MARQUEE_START_PX && Math.abs(dy) < MARQUEE_START_PX
  if (!current.isActive && tiny) return
  current.isActive = true
  runtime.box.value = {
    x: Math.min(current.x, at.x),
    y: Math.min(current.y, at.y),
    w: Math.abs(dx),
    h: Math.abs(dy),
  }
}

/** 松手收尾：拖出过框就交出命中集，没拖出来就是一次「点空白」。 */
function finishMarquee(runtime: MarqueeRuntime, isCancelled: boolean): void {
  const current = runtime.session
  const rect = runtime.box.value
  if (current === null || isCancelled) {
    stopMarquee(runtime)
    return
  }
  if (!current.isActive || rect === null) {
    if (!current.additive) runtime.options.onClear()
    stopMarquee(runtime)
    return
  }
  runtime.options.onMarquee(runtime.options.hitIds(rect), current.additive)
  stopMarquee(runtime)
}

function startMarquee(runtime: MarqueeRuntime, event: PointerEvent): void {
  const at = runtime.options.pointerDesign(event)
  if (at === null) return
  stopMarquee(runtime)
  runtime.session = {
    x: at.x,
    y: at.y,
    additive: event.shiftKey || event.ctrlKey || event.metaKey,
    isActive: false,
  }
  const controller = new AbortController()
  runtime.listeners = controller
  const { signal } = controller
  const move = (moved: PointerEvent): void => onMarqueeMove(runtime, moved)
  window.addEventListener('pointermove', move, { signal })
  window.addEventListener('pointerup', () => finishMarquee(runtime, false), {
    signal,
  })
  window.addEventListener('pointercancel', () => finishMarquee(runtime, true), {
    signal,
  })
}

export function useMarquee(options: MarqueeOptions): CanvasMarquee {
  const runtime: MarqueeRuntime = {
    options,
    box: ref<NodeBox | null>(null),
    session: null,
    listeners: null,
  }

  onUnmounted(() => stopMarquee(runtime))

  return {
    box: runtime.box,
    start: (event) => startMarquee(runtime, event),
    stop: () => stopMarquee(runtime),
  }
}
