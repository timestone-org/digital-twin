/**
 * @fileoverview 画布的键盘操作：删选中、撤销、取消选中。
 *
 * ⚠ 在输入框里打字时一律不响应：不判这一条的话，用户在参数弹窗里按退格删字，
 * 画布上的节点会跟着一起没（本仓编辑器已经吃过这个亏）。
 * ⚠ 监听挂在 window 上，卸载必须摘——画布是个整屏页面，留着的监听会在别的页面
 * 上继续吃按键。
 */
import { onBeforeUnmount, onMounted } from 'vue'

/** 画布要响应的三个动作。 */
export interface ShortcutActions {
  /** 删掉当前选中的节点与边。 */
  removeSelected: () => void
  /** 退回上一步。 */
  undo: () => void
  /** 清空选中。 */
  clearSelection: () => void
  /** 现在能不能改图（只读时按键一律不响应）。 */
  canEdit: () => boolean
}

/** 焦点在能打字的地方吗。 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** 这一下按键该触发哪个动作。认不出来给 null。 */
function actionOf(event: KeyboardEvent): keyof ShortcutActions | null {
  if (event.key === 'Escape') return 'clearSelection'
  if (event.key === 'Delete' || event.key === 'Backspace') {
    return 'removeSelected'
  }
  // ⚠ Mac 上是 metaKey，Windows/Linux 上是 ctrlKey，两个都要认
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    return 'undo'
  }
  return null
}

export function useCanvasShortcuts(actions: ShortcutActions): void {
  function onKey(event: KeyboardEvent): void {
    if (isTyping(event.target)) return
    const action = actionOf(event)
    if (action === null) return
    // 取消选中不算改图，只读时也该响应
    if (action !== 'clearSelection' && !actions.canEdit()) return
    event.preventDefault()
    actions[action]()
  }

  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
