/**
 * @fileoverview 画布的指针手势状态机：平移、拖节点、框选、拉连线。
 *
 * ⚠ 自绘画布的四条自负责任全在这里（ADR-0036 的后果一节）：
 * 一次手势只在 `pointerup` 提交**一步**撤销（逐帧提交的话撤销键再也按不回上
 * 一步）；拖拽中卸载要补提交一次；把手与选框按当前倍率反着缩回屏幕上的固定
 * 尺寸；挂在 `window` 上的 `pointermove` / `pointerup` **卸载时必须摘掉**。
 */
import { onBeforeUnmount, readonly, ref, shallowRef } from 'vue'

import type { WireEnd } from './portHits'
import type { CanvasPoint } from './useCanvasViewport'

/** 分辨「点了一下」与「拖了一段」的阈值（屏幕像素）。 */
const DRAG_THRESHOLD = 3

/** 正在进行的手势。 */
export type Gesture =
  | { kind: 'idle' }
  | { kind: 'panning' }
  | { kind: 'dragging'; nodeIds: readonly string[]; from: CanvasPoint }
  | { kind: 'marquee'; from: CanvasPoint; to: CanvasPoint }
  | { kind: 'wiring'; from: WireEnd; to: CanvasPoint }

/** 手势各阶段要回调给页面的那几件事。 */
export interface PointerHandlers {
  /** 平移了一段屏幕距离。 */
  onPan: (deltaLeft: number, deltaTop: number) => void
  /** 拖动中：把这批节点相对起点挪这么远（画布坐标）。 */
  onDragMove: (nodeIds: readonly string[], delta: CanvasPoint) => void
  /** 一次拖动结束。**这里才提交一步撤销。** */
  onDragEnd: (nodeIds: readonly string[]) => void
  /** 框选结束：这个矩形里的节点。 */
  onMarquee: (from: CanvasPoint, to: CanvasPoint) => void
  /** 连线结束：松手时指针底下是哪个元素（可能什么都没有）。 */
  onWire: (from: WireEnd, to: HTMLElement | null) => void
}

/** 手势在移动一步之后的样子。平移不经这里——它改的是视口不是手势。 */
function advanced(
  current: Gesture,
  at: CanvasPoint,
  handlers: PointerHandlers,
): Gesture {
  if (current.kind === 'dragging') {
    handlers.onDragMove(current.nodeIds, {
      left: at.left - current.from.left,
      top: at.top - current.from.top,
    })
    return current
  }
  if (current.kind === 'marquee') return { ...current, to: at }
  if (current.kind === 'wiring') return { ...current, to: at }
  return current
}

/**
 * 一次手势结束时该提交什么。
 *
 * ⚠ 只在这里提交一步撤销：逐帧提交的话，撤销键再也按不回上一步——按一次只退
 * 一帧，用户要按几十次才回得到起点。
 */
function commit(
  current: Gesture,
  hasMoved: boolean,
  dropped: HTMLElement | null,
  handlers: PointerHandlers,
): void {
  if (current.kind === 'dragging' && hasMoved) {
    handlers.onDragEnd(current.nodeIds)
    return
  }
  if (current.kind === 'marquee' && hasMoved) {
    handlers.onMarquee(current.from, current.to)
    return
  }
  if (current.kind === 'wiring') handlers.onWire(current.from, dropped)
}

/**
 * 画布的指针手势。
 *
 * @param toCanvas 屏幕坐标 → 画布坐标
 * @param handlers 各阶段的回调
 */
export function useCanvasPointer(
  toCanvas: (left: number, top: number) => CanvasPoint,
  handlers: PointerHandlers,
) {
  const gesture = shallowRef<Gesture>({ kind: 'idle' })
  const origin = ref<CanvasPoint>({ left: 0, top: 0 })
  const moved = ref(false)

  function begin(next: Gesture, event: PointerEvent): void {
    gesture.value = next
    origin.value = { left: event.clientX, top: event.clientY }
    moved.value = false
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function onMove(event: PointerEvent): void {
    const deltaLeft = event.clientX - origin.value.left
    const deltaTop = event.clientY - origin.value.top
    if (Math.hypot(deltaLeft, deltaTop) > DRAG_THRESHOLD) moved.value = true
    if (gesture.value.kind === 'panning') {
      handlers.onPan(deltaLeft, deltaTop)
      origin.value = { left: event.clientX, top: event.clientY }
      return
    }
    const at = toCanvas(event.clientX, event.clientY)
    gesture.value = advanced(gesture.value, at, handlers)
  }

  function onUp(event: PointerEvent): void {
    settle(event.target instanceof HTMLElement ? event.target : null)
  }

  /**
   * 收尾：按当前手势提交一次，然后回到空闲。
   *
   * ⚠ 卸载时也要走它：拖到一半切走页面而不补提交，那一段拖动既没落库、也不在
   * 撤销栈里——用户回来只会看到节点莫名其妙回到了原位。
   */
  function settle(dropped: HTMLElement | null): void {
    commit(gesture.value, moved.value, dropped, handlers)
    gesture.value = { kind: 'idle' }
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  onBeforeUnmount(() => settle(null))

  return {
    gesture: readonly(gesture),
    /** 是否已经越过「算拖动」的阈值。点一下与拖一段靠它分。 */
    hasMoved: readonly(moved),
    /** 开始平移画布。 */
    startPan: (event: PointerEvent) => begin({ kind: 'panning' }, event),
    /** 开始拖一批节点。 */
    startDrag: (event: PointerEvent, nodeIds: readonly string[]) =>
      begin(dragFrom(event, nodeIds, toCanvas), event),
    /** 开始框选。 */
    startMarquee: (event: PointerEvent) =>
      begin(marqueeFrom(event, toCanvas), event),
    /** 从一个接点开始拉线。出口与入口两侧都能起手。 */
    startWiring: (event: PointerEvent, from: WireEnd) =>
      begin(wiringFrom(event, from, toCanvas), event),
  }
}

type ToCanvas = (left: number, top: number) => CanvasPoint

function dragFrom(
  event: PointerEvent,
  nodeIds: readonly string[],
  toCanvas: ToCanvas,
): Gesture {
  return {
    kind: 'dragging',
    nodeIds,
    from: toCanvas(event.clientX, event.clientY),
  }
}

function marqueeFrom(event: PointerEvent, toCanvas: ToCanvas): Gesture {
  const at = toCanvas(event.clientX, event.clientY)
  return { kind: 'marquee', from: at, to: at }
}

function wiringFrom(
  event: PointerEvent,
  from: WireEnd,
  toCanvas: ToCanvas,
): Gesture {
  return {
    kind: 'wiring',
    from,
    to: toCanvas(event.clientX, event.clientY),
  }
}
