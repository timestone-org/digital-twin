/**
 * @fileoverview 拖动的纯算术与监听装配，供 `useCanvasDrag` 使用。
 * ⚠ 位移要除以舞台缩放：舞台是一次 `transform: scale`，屏幕上走 10px 在设计
 * 坐标系里不是 10px，不除的话缩得越小拖得越快。
 */

import type { NodeGeometry } from '@/features/dashboard/editorDoc'

/** 缩放时的最小边长（设计像素），免得拖成 0 之后再也点不中。 */
const MIN_SIZE_PX = 24

export type DragMode = 'move' | 'resize'

export interface CanvasDragOptions {
  /** 当前舞台缩放。 */
  scale: () => number
  /**
   * 几何变了。
   * @param isContinuous 拖动过程中为真，松手那一下为假——撤销栈据它决定合不合并
   */
  onChange: (
    nodeId: string,
    geometry: NodeGeometry,
    isContinuous: boolean,
  ) => void
}

/** 一次拖动的起手状态。 */
export interface DragSession {
  mode: DragMode
  nodeId: string
  from: NodeGeometry
  originX: number
  originY: number
}

/**
 * 位移后的几何。
 * @param mode 拖位置还是拖大小
 * @param from 起手时的几何
 * @param dx 设计坐标系里的横向位移
 * @param dy 设计坐标系里的纵向位移
 */
export function geometryAfterDrag(
  mode: DragMode,
  from: NodeGeometry,
  dx: number,
  dy: number,
): NodeGeometry {
  if (mode === 'move') return { ...from, x: from.x + dx, y: from.y + dy }
  return {
    ...from,
    w: Math.max(MIN_SIZE_PX, from.w + dx),
    h: Math.max(MIN_SIZE_PX, from.h + dy),
  }
}

/** 把一次指针位置换算成一次几何变更并抛出去。 */
function report(
  options: CanvasDragOptions,
  session: DragSession,
  moved: PointerEvent,
  isContinuous: boolean,
): void {
  const scale = options.scale()
  const divisor = scale > 0 ? scale : 1
  options.onChange(
    session.nodeId,
    geometryAfterDrag(
      session.mode,
      session.from,
      (moved.clientX - session.originX) / divisor,
      (moved.clientY - session.originY) / divisor,
    ),
    isContinuous,
  )
}

/**
 * 挂上这一次拖动的三个 window 监听，它们的生死全交给这个 controller。
 * @param options 缩放与回调
 * @param session 起手状态
 * @param controller 持有监听的 AbortController
 * @param onDone 收尾回调
 */
export function listenDrag(
  options: CanvasDragOptions,
  session: DragSession,
  controller: AbortController,
  onDone: () => void,
): void {
  const signal = controller.signal
  window.addEventListener(
    'pointermove',
    (moved: PointerEvent) => report(options, session, moved, true),
    { signal },
  )
  const finish = (ended: PointerEvent): void => {
    report(options, session, ended, false)
    onDone()
  }
  window.addEventListener('pointerup', finish, { signal })
  // ⚠ pointercancel 也要收尾：系统抢走指针时不会再发 pointerup
  window.addEventListener('pointercancel', finish, { signal })
}
