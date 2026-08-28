/**
 * @fileoverview 手势帧上的两条纯判定：这一按归不归本层接，以及 Shift 锁轴。
 * 抽出来是为了能单测——留在 SFC 里只能靠挂载一整层再发指针事件才验得到。
 */
import type { Twin2dGestureFrame } from './useCanvasPointer'

/** 鼠标左键。 */
const LEFT_BUTTON = 0

/**
 * 接下这一按：主键才归调用方，接了就不再往上冒。
 * ⚠ 中键归画布壳平移、右键留给上下文菜单，这两下一律放过去；一并吞掉的表现是
 * 「按在节点上就平移不了」，而按在空白处一切正常。
 * ⚠ 接下的那一下必须 `stopPropagation`，否则「点节点」会连带被当成点空白。
 * @param event 起手的 `pointerdown`
 */
export function twin2dClaimPointer(event: PointerEvent): boolean {
  if (event.button !== LEFT_BUTTON) return false
  event.stopPropagation()
  return true
}

/**
 * Shift = 只走位移大的那根轴。
 * @param frame 这一帧
 */
export function twin2dAxisLocked(frame: Twin2dGestureFrame): {
  dx: number
  dy: number
} {
  if (!frame.shift) return { dx: frame.dx, dy: frame.dy }
  return Math.abs(frame.dx) >= Math.abs(frame.dy)
    ? { dx: frame.dx, dy: 0 }
    : { dx: 0, dy: frame.dy }
}
