/**
 * @fileoverview 编辑器的键盘快捷键：撤销、重做、删除选中节点。
 * ⚠ window 监听用 AbortController 持有并在卸载时 abort：编辑器是会被切走的路由，
 * 留下的监听会在别的页面上继续吞掉撤销键。
 * ⚠ 焦点在输入框里时不接管：那时候撤销键该撤销的是输入框自己的文本。
 */

import { onMounted, onUnmounted } from 'vue'

/** 这些标签里按键归它们自己。 */
const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export interface EditorShortcutHandlers {
  undo: () => void
  redo: () => void
  remove: () => void
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return TEXT_ENTRY.has(target.tagName) || target.isContentEditable
}

/**
 * 判定一次按键该触发哪个动作；不触发任何动作时给 null。
 * @param event 键盘事件
 */
export function shortcutOf(
  event: KeyboardEvent,
): keyof EditorShortcutHandlers | null {
  if (isTextEntry(event.target)) return null
  const withCommand = event.metaKey || event.ctrlKey
  if (withCommand && event.key.toLowerCase() === 'z') {
    return event.shiftKey ? 'redo' : 'undo'
  }
  if (!withCommand && (event.key === 'Delete' || event.key === 'Backspace')) {
    return 'remove'
  }
  return null
}

/**
 * 装上快捷键。须在 setup 内调用。
 * @param handlers 三个动作的实现
 */
export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  let listeners: AbortController | null = null

  function onKeyDown(event: KeyboardEvent): void {
    const action = shortcutOf(event)
    if (action === null) return
    event.preventDefault()
    handlers[action]()
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
