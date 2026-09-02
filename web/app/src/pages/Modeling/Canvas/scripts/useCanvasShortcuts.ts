/**
 * @fileoverview 画布的键盘操作。
 *
 * ⚠ 在输入框里打字时一律不响应：不判这一条的话，用户在参数弹窗里按退格删字，
 * 画布上的节点会跟着一起没（本仓编辑器已经吃过这个亏）。
 * ⚠ 监听挂在 window 上，卸载必须摘——画布是个整屏页面，留着的监听会在别的页面
 * 上继续吃按键。
 */
import { onBeforeUnmount, onMounted } from 'vue'

/** 方向键一下挪多少；按住 Shift 挪一大格。 */
const NUDGE_STEP = 8
const NUDGE_LEAP = 40

/** 画布要响应的那些动作。 */
export interface ShortcutActions {
  /** 删掉当前选中的节点与边。 */
  removeSelected: () => void
  /** 退回上一步。 */
  undo: () => void
  /** 把撤销掉的那一步再做一遍。 */
  redo: () => void
  /** 清空选中。 */
  clearSelection: () => void
  /** 全选节点。 */
  selectAll: () => void
  /** 复制选中的节点到剪贴板。 */
  copy: () => void
  /** 粘贴剪贴板里的节点。 */
  paste: () => void
  /** 就地再制一份选中。 */
  duplicate: () => void
  /** 给选中的那一个改名。 */
  rename: () => void
  /** 打开选中那个节点的参数。 */
  openConfig: () => void
  /** 让整张图回到视野里。 */
  fit: () => void
  /** 方向键微调选中的节点。 */
  nudge: (deltaLeft: number, deltaTop: number) => void
  /** 现在能不能改图（只读时改图类按键一律不响应）。 */
  canEdit: () => boolean
}

/** 一按就跑、不带参数的那些动作。方向键与 `canEdit` 不在其中。 */
type SimpleAction = Exclude<keyof ShortcutActions, 'nudge' | 'canEdit'>

/** 只读时也该响应的那几个——它们不改图。 */
const READONLY_SAFE = new Set<SimpleAction>([
  'clearSelection',
  'selectAll',
  'copy',
  'openConfig',
  'fit',
])

/** 焦点在能打字的地方吗。 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** 带修饰键的那几下。⚠ Mac 上是 metaKey，Windows/Linux 上是 ctrlKey，都要认。 */
function withModifier(event: KeyboardEvent): SimpleAction | null {
  const key = event.key.toLowerCase()
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y') return 'redo'
  if (key === 'a') return 'selectAll'
  if (key === 'c') return 'copy'
  if (key === 'v') return 'paste'
  if (key === 'd') return 'duplicate'
  return null
}

/** 方向键要挪多远；不是方向键给 null。 */
function nudgeOf(event: KeyboardEvent): [number, number] | null {
  const step = event.shiftKey ? NUDGE_LEAP : NUDGE_STEP
  if (event.key === 'ArrowLeft') return [-step, 0]
  if (event.key === 'ArrowRight') return [step, 0]
  if (event.key === 'ArrowUp') return [0, -step]
  if (event.key === 'ArrowDown') return [0, step]
  return null
}

/** 这一下按键该触发哪个动作。认不出来给 null。 */
function actionOf(event: KeyboardEvent): SimpleAction | null {
  if (event.metaKey || event.ctrlKey) return withModifier(event)
  if (event.key === 'Escape') return 'clearSelection'
  if (event.key === 'Delete' || event.key === 'Backspace') {
    return 'removeSelected'
  }
  if (event.key === 'F2') return 'rename'
  if (event.key === 'Enter') return 'openConfig'
  return null
}

export function useCanvasShortcuts(actions: ShortcutActions): void {
  function onKey(event: KeyboardEvent): void {
    if (isTyping(event.target)) return
    const nudge = event.metaKey || event.ctrlKey ? null : nudgeOf(event)
    if (nudge !== null) {
      if (!actions.canEdit()) return
      event.preventDefault()
      return actions.nudge(nudge[0], nudge[1])
    }
    const action = actionOf(event)
    if (action === null) return
    if (!READONLY_SAFE.has(action) && !actions.canEdit()) return
    event.preventDefault()
    actions[action]()
  }

  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
