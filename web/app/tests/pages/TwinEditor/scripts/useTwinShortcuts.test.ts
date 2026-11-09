/** @fileoverview 3D 孪生编辑器的键盘手势：与另外两个编辑器同一套键位，表单里让位。 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import {
  twinShortcutOf,
  useTwinShortcuts,
} from '@/pages/TwinEditor/scripts/useTwinShortcuts'

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init })
}

describe('twinShortcutOf', () => {
  it('⌘/Ctrl 的 S、Z、⇧Z、Y 分别是保存、撤销、重做', () => {
    expect(twinShortcutOf(key({ key: 's', metaKey: true }), false)).toBe('save')
    expect(twinShortcutOf(key({ key: 'z', ctrlKey: true }), false)).toBe('undo')
    expect(
      twinShortcutOf(key({ key: 'Z', metaKey: true, shiftKey: true }), false),
    ).toBe('redo')
    expect(twinShortcutOf(key({ key: 'y', ctrlKey: true }), false)).toBe('redo')
  })

  it('Delete 与退格删除选中', () => {
    expect(twinShortcutOf(key({ key: 'Delete' }), false)).toBe('remove')
    expect(twinShortcutOf(key({ key: 'Backspace' }), false)).toBe('remove')
  })

  // ⚠ 输入框里的退格是删一个字：接管了就是把整个实体删掉
  it('表单获焦时只接管保存', () => {
    expect(twinShortcutOf(key({ key: 's', metaKey: true }), true)).toBe('save')
    expect(twinShortcutOf(key({ key: 'z', metaKey: true }), true)).toBeNull()
    expect(twinShortcutOf(key({ key: 'Backspace' }), true)).toBeNull()
  })

  it('别的键不触发', () => {
    expect(twinShortcutOf(key({ key: 'a' }), false)).toBeNull()
    expect(twinShortcutOf(key({ key: 's' }), false)).toBeNull()
  })
})

describe('useTwinShortcuts', () => {
  const handlers = {
    save: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    remove: vi.fn(),
  }
  let suspended = false

  afterEach(() => {
    for (const fn of Object.values(handlers)) fn.mockReset()
    suspended = false
    document.body.innerHTML = ''
  })

  function mountHost() {
    return mount(
      defineComponent({
        setup() {
          useTwinShortcuts({ handlers, suspended: () => suspended })
          return () => h('div')
        },
      }),
      { attachTo: document.body },
    )
  }

  it('按下即落到对应动作，并拦下浏览器的缺省行为', () => {
    const wrapper = mountHost()
    const event = key({ key: 's', metaKey: true })

    window.dispatchEvent(event)

    expect(handlers.save).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('焦点在输入框里时撤销与删除让位', () => {
    const wrapper = mountHost()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()

    window.dispatchEvent(key({ key: 'z', metaKey: true }))
    window.dispatchEvent(key({ key: 'Backspace' }))

    expect(handlers.undo).not.toHaveBeenCalled()
    expect(handlers.remove).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('让位期间一个键都不接', () => {
    const wrapper = mountHost()
    suspended = true

    window.dispatchEvent(key({ key: 'Delete' }))

    expect(handlers.remove).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // ⚠ 监听留在 window 上的话，切到别的页面撤销键还会改这份草稿
  it('卸载后不再接键', () => {
    const wrapper = mountHost()
    wrapper.unmount()

    window.dispatchEvent(key({ key: 'z', metaKey: true }))

    expect(handlers.undo).not.toHaveBeenCalled()
  })
})
