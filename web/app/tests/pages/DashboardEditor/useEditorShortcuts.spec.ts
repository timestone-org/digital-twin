/**
 * @fileoverview 契约：撤销/重做/删除的快捷键在输入框里不接管，
 * 且 window 监听在卸载时被摘掉——留下的监听会在别的页面上继续吞掉撤销键。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import {
  shortcutOf,
  useEditorShortcuts,
} from '@/pages/DashboardEditor/useEditorShortcuts'

function keyEvent(
  key: string,
  over: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, ...over })
}

/** 把事件的 target 指到一个真实元素上。 */
function firedOn(element: Element, event: KeyboardEvent): KeyboardEvent {
  element.dispatchEvent(event)
  return event
}

describe('按键判定', () => {
  it('⌘/Ctrl + Z 是撤销，加 Shift 是重做', () => {
    expect(shortcutOf(keyEvent('z', { metaKey: true }))).toBe('undo')
    expect(shortcutOf(keyEvent('Z', { ctrlKey: true }))).toBe('undo')
    expect(shortcutOf(keyEvent('z', { metaKey: true, shiftKey: true }))).toBe(
      'redo',
    )
  })

  it('Delete 与 Backspace 是删除选中节点', () => {
    expect(shortcutOf(keyEvent('Delete'))).toBe('remove')
    expect(shortcutOf(keyEvent('Backspace'))).toBe('remove')
  })

  it('带修饰键的 Delete 不算删除', () => {
    expect(shortcutOf(keyEvent('Delete', { metaKey: true }))).toBeNull()
  })

  it('其余按键一律不接管', () => {
    expect(shortcutOf(keyEvent('a'))).toBeNull()
  })

  it('焦点在输入框里时按键归输入框自己', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)

    expect(
      shortcutOf(firedOn(input, keyEvent('z', { metaKey: true }))),
    ).toBeNull()
    expect(shortcutOf(firedOn(input, keyEvent('Backspace')))).toBeNull()

    input.remove()
  })

  it('焦点在可编辑区域里同样不接管', () => {
    const box = document.createElement('div')
    box.setAttribute('contenteditable', 'true')
    document.body.appendChild(box)

    expect(shortcutOf(firedOn(box, keyEvent('Delete')))).toBeNull()

    box.remove()
  })
})

describe('监听的生死', () => {
  function mountShortcuts() {
    const calls: string[] = []
    const host = defineComponent({
      setup() {
        useEditorShortcuts({
          undo: () => calls.push('undo'),
          redo: () => calls.push('redo'),
          remove: () => calls.push('remove'),
        })
        return () => h('div')
      },
    })
    return { wrapper: mount(host), calls }
  }

  it('挂载后按键触发对应动作', () => {
    const { wrapper, calls } = mountShortcuts()

    window.dispatchEvent(keyEvent('z', { metaKey: true }))
    window.dispatchEvent(keyEvent('z', { metaKey: true, shiftKey: true }))
    window.dispatchEvent(keyEvent('Delete'))

    expect(calls).toEqual(['undo', 'redo', 'remove'])
    wrapper.unmount()
  })

  it('卸载之后不再接管按键', () => {
    const { wrapper, calls } = mountShortcuts()
    wrapper.unmount()

    window.dispatchEvent(keyEvent('z', { metaKey: true }))

    expect(calls).toEqual([])
  })
})
