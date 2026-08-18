/**
 * @fileoverview 一次按键判定成哪个编辑器动作的纯函数层，无 Vue、无 DOM 监听。
 * 装载在 `useEditorShortcuts.ts`，帮助清单在 `shortcuts.ts`，三处的动作名同一套。
 * ⚠ 表单获焦时编辑类手势要让给浏览器（撤销键该撤销输入框自己的文本），
 * 但 ⌘S 与缩放仍然全局接管——保存不该因为焦点在输入框里而变成「另存网页」。
 */

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
  /** 层序：逐层挪与一步到顶 / 到底。 */
  orderForward: () => void
  orderBackward: () => void
  orderFront: () => void
  orderBack: () => void
  zoomStep: (direction: 1 | -1) => void
  /** ⌘0：回 100%。 */
  zoomReset: () => void
  /** ⌘⇧0：回适应窗口。 */
  zoomFit: () => void
  help: () => void
}

export type ShortcutAction = keyof EditorShortcutHandlers

export const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** ⌘/Ctrl + 键 的全局手势；'0' 另按 Shift 分叉，见 `globalActionOf`。 */
const GLOBAL_COMMAND: Record<string, ShortcutAction> = {
  s: 'save',
  '+': 'zoomStep',
  '=': 'zoomStep',
  '-': 'zoomStep',
}

/** ⌘/Ctrl + 键 的编辑类手势；'z' 另按 Shift 分叉，见 `commandEditActionOf`。 */
const EDIT_COMMAND: Record<string, ShortcutAction> = {
  z: 'undo',
  y: 'redo',
  c: 'copy',
  v: 'paste',
  d: 'duplicate',
  a: 'selectAll',
}

/**
 * 层序键：⌘] 上移、⌘[ 下移，加 Shift 一步到顶 / 到底。
 * ⚠ 按住 Shift 后 `event.key` 变成 `}` 与 `{`，只认方括号会让加 Shift 的那两个失灵。
 */
const ORDER_KEYS: Record<string, 'up' | 'down'> = {
  ']': 'up',
  '}': 'up',
  '[': 'down',
  '{': 'down',
}

function orderActionOf(
  direction: 'up' | 'down',
  toEnd: boolean,
): ShortcutAction {
  if (direction === 'up') return toEnd ? 'orderFront' : 'orderForward'
  return toEnd ? 'orderBack' : 'orderBackward'
}

/** 全局手势：表单获焦时也接管。 */
function globalActionOf(
  event: KeyboardEvent,
  withCommand: boolean,
): ShortcutAction | null {
  if (!withCommand) return null
  if (event.key === '0') return event.shiftKey ? 'zoomFit' : 'zoomReset'
  return GLOBAL_COMMAND[event.key.toLowerCase()] ?? null
}

/** 按住修饰键的编辑类手势：层序键先认，再是编辑六件套。 */
function commandEditActionOf(event: KeyboardEvent): ShortcutAction | null {
  const order = ORDER_KEYS[event.key]
  if (order !== undefined) return orderActionOf(order, event.shiftKey)
  const action = EDIT_COMMAND[event.key.toLowerCase()] ?? null
  return action === 'undo' && event.shiftKey ? 'redo' : action
}

/** 编辑类手势：表单获焦时让给浏览器。 */
function editActionOf(
  event: KeyboardEvent,
  withCommand: boolean,
): ShortcutAction | null {
  const key = event.key
  if (withCommand) return commandEditActionOf(event)
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
): ShortcutAction | null {
  if (event.key === 'Escape') return 'escape'
  const withCommand = event.metaKey || event.ctrlKey
  const global = globalActionOf(event, withCommand)
  if (global !== null) return global
  if (formFocused) return null
  return editActionOf(event, withCommand)
}
