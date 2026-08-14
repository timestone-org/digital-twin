/**
 * @fileoverview 画布上的拖动与缩放。
 *
 * ⚠ window 上的监听由 `AbortController` 持有：只在 `pointerup` 里摘监听兜不住
 * 两种情况——组件在拖动中被卸载（切走大屏），以及系统抢走指针发来的
 * `pointercancel`。这两种都会留下一副永远在跟鼠标走的监听。
 */

import { onUnmounted, ref, type Ref } from 'vue'

import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import { listenDrag, type CanvasDragOptions, type DragMode } from './canvasDrag'

export interface CanvasDrag {
  isDragging: Ref<boolean>
  /**
   * 起一次拖动。
   * @param event 触发的指针事件
   * @param mode 拖位置还是拖大小
   * @param nodeId 被拖的节点
   * @param from 拖动开始时的几何
   */
  start: (
    event: PointerEvent,
    mode: DragMode,
    nodeId: string,
    from: NodeGeometry,
  ) => void
  /** 卸载时摘掉监听。组件用 onUnmounted 自动调，测试可以手动调。 */
  stop: () => void
}

export function useCanvasDrag(options: CanvasDragOptions): CanvasDrag {
  const isDragging = ref(false)
  let listeners: AbortController | null = null

  function stop(): void {
    listeners?.abort()
    listeners = null
    isDragging.value = false
  }

  function start(
    event: PointerEvent,
    mode: DragMode,
    nodeId: string,
    from: NodeGeometry,
  ): void {
    stop()
    const controller = new AbortController()
    listeners = controller
    isDragging.value = true
    listenDrag(
      options,
      { mode, nodeId, from, originX: event.clientX, originY: event.clientY },
      controller,
      stop,
    )
  }

  onUnmounted(stop)

  return { isDragging, start, stop }
}
