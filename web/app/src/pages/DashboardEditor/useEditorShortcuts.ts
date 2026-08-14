/**
 * @fileoverview 编辑器的全套键盘手势：文件/编辑/选择/微调/缩放五组，
 * 与 `shortcuts.ts` 的帮助清单一一对应。
 * ⚠ window 监听用 AbortController 持有并在卸载时 abort：编辑器是会被切走的路由，
 * 留下的监听会在别的页面上继续吞掉撤销键。
 * ⚠ 表单获焦时把编辑类手势让给浏览器（撤销键该撤销的是输入框自己的文本），
 * 但 ⌘S 与缩放仍然全局接管——保存不该因为焦点在输入框里而变成「另存网页」。
 */

import { onMounted, onUnmounted } from 'vue'

import { isFormFocused } from './isFormFocused'

export interface EditorShortcutHandlers {
  save: () => void
  undo: () => void
  redo: () => void
  copy: () => void
  paste: () => void
  duplicate: () => void
  remove: () => void
  selectAll: () => void
  escape: () => void
  /** 方向键微调；`fine` 为 Alt 按住的 1px 精调。 */
  nudge: (dx: number, dy: number, fine: boolean) => void
  zoomStep: (direction: 1 | -1) => void
  /** ⌘0：回 100%。 */
  zoomReset: () => void
  /** ⌘⇧0：回适应窗口。 */
  zoomFit: () => void
  help: () => void
}

export interface EditorShortcutOptions {
  handlers: EditorShortcutHandlers
  /** 帮助/预览这类覆盖层打开时为真：全部手势让位，只留 Esc 关它。 */
  suspended?: () => boolean
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

type Action = keyof EditorShortcutHandlers

/** ⌘/Ctrl + 键 的全局手势；'0' 另按 Shift 分叉，见 `globalActionOf`。 */
const GLOBAL_COMMAND: Record<string, Action> = {
  s: 'save',
  '+': 'zoomStep',
  '=': 'zoomStep',
  '-': 'zoomStep',
}

/** ⌘/Ctrl + 键 的编辑类手势；'z' 另按 Shift 分叉，见 `editActionOf`。 */
const EDIT_COMMAND: Record<string, Action> = {
  z: 'undo',
  y: 'redo',
  c: 'copy',
  v: 'paste',
  d: 'duplicate',
  a: 'selectAll',
}

/** 全局手势：表单获焦时也接管。 */
function globalActionOf(
  event: KeyboardEvent,
  withCommand: boolean,
): Action | null {
  if (!withCommand) return null
  if (event.key === '0') return event.shiftKey ? 'zoomFit' : 'zoomReset'
  return GLOBAL_COMMAND[event.key.toLowerCase()] ?? null
}

/** 编辑类手势：表单获焦时让给浏览器。 */
function editActionOf(
  event: KeyboardEvent,
  withCommand: boolean,
): Action | null {
  const key = event.key
  if (withCommand) {
    const action = EDIT_COMMAND[key.toLowerCase()] ?? null
    return action === 'undo' && event.shiftKey ? 'redo' : action
  }
  if (key === 'Delete' || key === 'Backspace') return 'remove'
  if (key === '?' || key === 'F1') return 'help'
  return key in ARROWS ? 'nudge' : null
}

/**
 * 判定一次按键触发哪个动作；不触发给 null。
 * @param event 键盘事件
 * @param formFocused 焦点是否在表单类元素里
 */
export function shortcutOf(
  event: KeyboardEvent,
  formFocused: boolean,
): keyof EditorShortcutHandlers | null {
  if (event.key === 'Escape') return 'escape'
  const withCommand = event.metaKey || event.ctrlKey
  const global = globalActionOf(event, withCommand)
  if (global !== null) return global
  if (formFocused) return null
  return editActionOf(event, withCommand)
}

/**
 * 装上快捷键。须在 setup 内调用。
 */
export function useEditorShortcuts(options: EditorShortcutOptions): void {
  const { handlers } = options
  let listeners: AbortController | null = null

  function run(action: Action, event: KeyboardEvent): void {
    if (action === 'nudge') {
      const arrow = ARROWS[event.key]
      if (arrow !== undefined) handlers.nudge(arrow[0], arrow[1], event.altKey)
      return
    }
    if (action === 'zoomStep') {
      handlers.zoomStep(event.key === '-' ? -1 : 1)
      return
    }
    handlers[action]()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (options.suspended?.() === true) {
      if (event.key === 'Escape') handlers.escape()
      return
    }
    const action = shortcutOf(event, isFormFocused())
    if (action === null) return
    event.preventDefault()
    run(action, event)
  }

  onMounted(() => {
    listeners = new AbortController()
    window.addEventListener('keydown', onKeyDown, { signal: listeners.signal })
  })

  onUnmounted(() => {
    listeners?.abort()
    listeners = null
  })
}
