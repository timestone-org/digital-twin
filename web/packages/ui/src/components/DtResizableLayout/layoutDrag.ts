/** @fileoverview 布局分隔拖动的指针捕获和事件清理。 */
import { ref } from 'vue'
import { resizePair, type LayoutDirection } from './layoutSizes'

interface DragSnapshot {
  direction: LayoutDirection
  sizes: readonly number[]
  minimums: readonly number[]
}

export function createLayoutDrag(
  read: () => DragSnapshot,
  apply: (sizes: number[]) => void,
  commit: () => void,
) {
  const isResizing = ref(false)
  let unbind: (() => void) | null = null
  function stop(): void {
    unbind?.()
    unbind = null
    isResizing.value = false
  }
  function start(index: number, event: PointerEvent): void {
    const snapshot = read()
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      index < 0 ||
      index >= snapshot.sizes.length - 1
    )
      return
    event.preventDefault()
    event.stopPropagation()
    stop()
    const coordinate = (next: PointerEvent): number =>
      snapshot.direction === 'horizontal' ? next.clientX : next.clientY
    const initial = coordinate(event)
    const move = (next: PointerEvent): void =>
      apply(
        resizePair(
          snapshot.sizes,
          snapshot.minimums,
          index,
          (snapshot.sizes[index] ?? 0) + coordinate(next) - initial,
        ),
      )
    const finish = (): void => {
      stop()
      commit()
    }
    const target =
      event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    unbind = listenToPointer(target, event.pointerId, move, finish, stop)
    isResizing.value = true
  }
  return { isResizing, start, stop }
}

function listenToPointer(
  target: HTMLElement | null,
  pointerId: number,
  move: (event: PointerEvent) => void,
  finish: () => void,
  cancel: () => void,
): () => void {
  const captured = capturePointer(target, pointerId)
  const movePointer = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) move(event)
  }
  const finishPointer = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) finish()
  }
  const cancelPointer = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) cancel()
  }
  window.addEventListener('pointermove', movePointer)
  window.addEventListener('pointerup', finishPointer)
  window.addEventListener('pointercancel', cancelPointer)
  window.addEventListener('blur', cancel)
  target?.addEventListener('lostpointercapture', cancelPointer)
  return () => {
    window.removeEventListener('pointermove', movePointer)
    window.removeEventListener('pointerup', finishPointer)
    window.removeEventListener('pointercancel', cancelPointer)
    window.removeEventListener('blur', cancel)
    target?.removeEventListener('lostpointercapture', cancelPointer)
    releasePointer(target, pointerId, captured)
  }
}

function capturePointer(
  target: HTMLElement | null,
  pointerId: number,
): boolean {
  try {
    target?.setPointerCapture(pointerId)
    return target !== null && typeof target.setPointerCapture === 'function'
  } catch {
    return false
  }
}

function releasePointer(
  target: HTMLElement | null,
  pointerId: number,
  captured: boolean,
): void {
  try {
    if (captured) target?.releasePointerCapture(pointerId)
  } catch {
    // ⚠ 浏览器可能已在 pointerup 时自动释放捕获。
  }
}
