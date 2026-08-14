/**
 * @fileoverview 画布上的拖动与缩放会话：每帧把新几何抛给调用方，松手那一下再抛一次收尾，
 * 落进别的容器时改抛换父。这里只持有运行态，动作与算术都在 `canvasDrag` 里。
 *
 * ⚠ window 上的监听由 `AbortController` 持有：只在 `pointerup` 里摘监听兜不住
 * 两种情况——组件在拖动中被卸载（切走大屏），以及系统抢走指针发来的
 * `pointercancel`。这两种都会留下一副永远在跟鼠标走的监听。
 */
import { onUnmounted, ref } from 'vue'

import type { GuideLine } from '@/features/dashboard/canvasSnap'
import {
  startDrag,
  stopDrag,
  type CanvasDrag,
  type CanvasDragOptions,
  type DragRuntime,
} from './canvasDrag'

export function useCanvasDrag(options: CanvasDragOptions): CanvasDrag {
  const runtime: DragRuntime = {
    options,
    isDragging: ref(false),
    guides: ref<GuideLine[]>([]),
    hoverContainerId: ref<string | null>(null),
    session: null,
    listeners: null,
  }

  onUnmounted(() => stopDrag(runtime))

  return {
    isDragging: runtime.isDragging,
    guides: runtime.guides,
    hoverContainerId: runtime.hoverContainerId,
    start: (session) => startDrag(runtime, session),
    stop: () => stopDrag(runtime),
  }
}
