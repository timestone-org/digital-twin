/**
 * @fileoverview 3D 孪生编辑器的键盘手势：保存、撤销重做、删除选中。判定是纯函数，
 * 装载那一支把 window 监听挂上并在卸载时摘干净；与 2D、大屏编辑器同一套键位。
 *
 * ⚠ 表单获焦时撤销、删除让位（按最近可交互祖先判，见 `ownsKeyboard`）：输入框里的
 *   ⌘Z 是撤销这一格的字，退格是删一个字，接管了就会撤掉别的改动、删掉整个实体。
 * ⚠ ⌘S 连表单里也接管：保存不该因为焦点在输入框里就变成浏览器的「另存网页」。
 */
import { onMounted, onUnmounted } from 'vue'

import { useWorkspacePage } from '@/features/workspace/context'
import { ownsKeyboard } from '@/utils/keyboardOwner'

/** 一次按键落到哪个动作上。 */
export type TwinShortcutAction = 'save' | 'undo' | 'redo' | 'remove'

/** ⌘/Ctrl + 键 的那几个；`z` 另按 Shift 分叉成重做。 */
const COMMAND_ACTIONS: Readonly<Record<string, TwinShortcutAction>> =
  Object.freeze({ s: 'save', z: 'undo', y: 'redo' })

/** 不带修饰键的那几个。 */
const PLAIN_ACTIONS: Readonly<Record<string, TwinShortcutAction>> =
  Object.freeze({ delete: 'remove', backspace: 'remove' })

/**
 * 判定一次按键触发哪个动作；不触发给 null。
 * @param event 键盘事件
 * @param formFocused 焦点是否落在该独占键盘的东西里
 */
export function twinShortcutOf(
  event: KeyboardEvent,
  formFocused: boolean,
): TwinShortcutAction | null {
  const withCommand = event.metaKey || event.ctrlKey
  const table = withCommand ? COMMAND_ACTIONS : PLAIN_ACTIONS
  const action = table[event.key.toLowerCase()] ?? null
  if (action === null || (formFocused && action !== 'save')) return null
  return action === 'undo' && event.shiftKey ? 'redo' : action
}

export interface TwinShortcutOptions {
  handlers: Record<TwinShortcutAction, () => void>
  /** 视口在等拾取、或弹窗开着时为真：全部手势让位。 */
  suspended?: () => boolean
}

/**
 * 装上键盘手势。须在 setup 内调用。
 * ⚠ window 监听用 `AbortController` 持有并在卸载时 abort：编辑器是会被切走的路由，
 * 留下的监听会在别的页面上继续吞掉撤销键。
 * @param options 落点与「暂时让位」的判定
 */
export function useTwinShortcuts(options: TwinShortcutOptions): void {
  const page = useWorkspacePage()
  let listeners: AbortController | null = null

  function onKeyDown(event: KeyboardEvent): void {
    if (page?.active.value === false) return
    if (options.suspended?.() === true) return
    const action = twinShortcutOf(event, ownsKeyboard(document.activeElement))
    if (action === null) return
    event.preventDefault()
    options.handlers[action]()
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
