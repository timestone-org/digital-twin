/**
 * @fileoverview 把键盘手势装到 window 上；键位判定在 `shortcutKeys.ts`。
 * ⚠ window 监听用 AbortController 持有并在卸载时 abort：编辑器是会被切走的路由，
 * 留下的监听会在别的页面上继续吞掉撤销键。
 */

import { onMounted, onUnmounted } from 'vue'

import { isFormFocused } from './isFormFocused'
import {
  ARROWS,
  nudgeStepOf,
  shortcutOf,
  type ShortcutAction,
} from './shortcutKeys'

export { shortcutOf } from './shortcutKeys'
export type {
  EditorShortcutHandlers,
  NudgeStep,
  ShortcutAction,
} from './shortcutKeys'

import type { EditorShortcutHandlers } from './shortcutKeys'

export interface EditorShortcutOptions {
  handlers: EditorShortcutHandlers
  /** 帮助/预览这类覆盖层打开时为真：全部手势让位，只留 Esc 关它。 */
  suspended?: () => boolean
}

/**
 * 装上快捷键。须在 setup 内调用。
 * @param options 处理器与「暂时让位」的判定
 */
export function useEditorShortcuts(options: EditorShortcutOptions): void {
  const { handlers } = options
  let listeners: AbortController | null = null

  function run(action: ShortcutAction, event: KeyboardEvent): void {
    if (action === 'nudge') {
      const arrow = ARROWS[event.key]
      if (arrow !== undefined) {
        handlers.nudge(arrow[0], arrow[1], nudgeStepOf(event))
      }
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
    const formFocused = isFormFocused()
    // 表单里的 Esc = 退出输入焦点：判定层不吃这一下，这里只把焦点收走
    if (event.key === 'Escape' && formFocused) {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
      return
    }
    const action = shortcutOf(event, formFocused)
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
