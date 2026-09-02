/**
 * @fileoverview 画布快捷键：删选中、撤销、取消选中，以及在输入框里打字时一律
 * 不响应。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { useCanvasShortcuts } from '@/pages/Modeling/Canvas/scripts/useCanvasShortcuts'

function actions(canEdit = true) {
  return {
    removeSelected: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    clearSelection: vi.fn(),
    selectAll: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    rename: vi.fn(),
    openConfig: vi.fn(),
    fit: vi.fn(),
    nudge: vi.fn(),
    canEdit: () => canEdit,
  }
}

function setup(hooks: ReturnType<typeof actions>) {
  return mount(
    defineComponent({
      setup() {
        useCanvasShortcuts(hooks)
        return () => h('div')
      },
    }),
  )
}

function press(key: string, over: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...over })
  window.dispatchEvent(event)
  return event
}

/** 把按键派发到一个真的输入框上，模拟「正在打字」。 */
function typeIn(tag: string, key: string): void {
  const element = document.createElement(tag)
  document.body.append(element)
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
  element.remove()
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('画布快捷键', () => {
  it('Delete 与退格都删选中', () => {
    const hooks = actions()
    setup(hooks)

    press('Delete')
    press('Backspace')

    expect(hooks.removeSelected).toHaveBeenCalledTimes(2)
  })

  it('Ctrl+Z 与 Cmd+Z 都撤销——两个平台各认一个', () => {
    const hooks = actions()
    setup(hooks)

    press('z', { ctrlKey: true })
    press('Z', { metaKey: true })

    expect(hooks.undo).toHaveBeenCalledTimes(2)
  })

  it('单按 z 不撤销，不然打字时会天天误触', () => {
    const hooks = actions()
    setup(hooks)

    press('z')

    expect(hooks.undo).not.toHaveBeenCalled()
  })

  it('Esc 取消选中', () => {
    const hooks = actions()
    setup(hooks)

    press('Escape')

    expect(hooks.clearSelection).toHaveBeenCalledOnce()
  })

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])(
    '焦点在 %s 上时退格是删字，不是删节点',
    (tag) => {
      const hooks = actions()
      setup(hooks)

      typeIn(tag, 'Backspace')

      expect(hooks.removeSelected).not.toHaveBeenCalled()
    },
  )

  it('富文本区域里同样不响应', () => {
    const hooks = actions()
    setup(hooks)
    const element = document.createElement('div')
    // happy-dom 不按 contenteditable 属性推 isContentEditable，直接置位
    Object.defineProperty(element, 'isContentEditable', { value: true })
    document.body.append(element)

    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    )

    expect(hooks.removeSelected).not.toHaveBeenCalled()
  })

  it('只读时删不掉也撤不回，但 Esc 照样能取消选中', () => {
    const hooks = actions(false)
    setup(hooks)

    press('Delete')
    press('z', { ctrlKey: true })
    press('Escape')

    expect(hooks.removeSelected).not.toHaveBeenCalled()
    expect(hooks.undo).not.toHaveBeenCalled()
    expect(hooks.clearSelection).toHaveBeenCalledOnce()
  })

  it('响应了就吃掉这一下按键，不让浏览器再拿它去后退', () => {
    setup(actions())

    expect(press('Backspace').defaultPrevented).toBe(true)
  })

  it('卸载之后不再吃按键', () => {
    const hooks = actions()
    const wrapper = setup(hooks)

    wrapper.unmount()
    press('Delete')

    expect(hooks.removeSelected).not.toHaveBeenCalled()
  })
})
