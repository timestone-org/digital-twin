/**
 * @fileoverview 契约：全套手势的判定口径与让位规则——表单获焦让出编辑类手势
 * 但保留 ⌘S 与缩放；挂起态只认 Esc；window 监听卸载即摘。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import {
  shortcutOf,
  useEditorShortcuts,
  type EditorShortcutHandlers,
} from '@/pages/DashboardEditor/useEditorShortcuts'

function keyEvent(
  key: string,
  over: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, ...over })
}

describe('按键判定', () => {
  it('编辑五件套：撤销/重做/复制/粘贴/再制', () => {
    expect(shortcutOf(keyEvent('z', { metaKey: true }), false)).toBe('undo')
    expect(
      shortcutOf(keyEvent('z', { metaKey: true, shiftKey: true }), false),
    ).toBe('redo')
    expect(shortcutOf(keyEvent('y', { ctrlKey: true }), false)).toBe('redo')
    expect(shortcutOf(keyEvent('c', { metaKey: true }), false)).toBe('copy')
    expect(shortcutOf(keyEvent('v', { metaKey: true }), false)).toBe('paste')
    expect(shortcutOf(keyEvent('d', { metaKey: true }), false)).toBe(
      'duplicate',
    )
  })

  it('删除、全选、帮助与方向键', () => {
    expect(shortcutOf(keyEvent('Delete'), false)).toBe('remove')
    expect(shortcutOf(keyEvent('Backspace'), false)).toBe('remove')
    expect(shortcutOf(keyEvent('a', { metaKey: true }), false)).toBe(
      'selectAll',
    )
    expect(shortcutOf(keyEvent('?'), false)).toBe('help')
    expect(shortcutOf(keyEvent('F1'), false)).toBe('help')
    expect(shortcutOf(keyEvent('ArrowLeft'), false)).toBe('nudge')
  })

  it('层序：⌘] / ⌘[ 逐层挪，加 Shift 一步到顶 / 到底', () => {
    expect(shortcutOf(keyEvent(']', { metaKey: true }), false)).toBe(
      'orderForward',
    )
    expect(shortcutOf(keyEvent('[', { metaKey: true }), false)).toBe(
      'orderBackward',
    )
    // ⚠ 按住 Shift 后浏览器给的 key 是 } 与 {，不是加了 shiftKey 的方括号
    expect(
      shortcutOf(keyEvent('}', { metaKey: true, shiftKey: true }), false),
    ).toBe('orderFront')
    expect(
      shortcutOf(keyEvent('{', { metaKey: true, shiftKey: true }), false),
    ).toBe('orderBack')
    expect(shortcutOf(keyEvent(']'), false)).toBeNull()
  })

  it('缩放手势与 Esc', () => {
    expect(shortcutOf(keyEvent('+', { metaKey: true }), false)).toBe('zoomStep')
    expect(shortcutOf(keyEvent('=', { metaKey: true }), false)).toBe('zoomStep')
    expect(shortcutOf(keyEvent('-', { metaKey: true }), false)).toBe('zoomStep')
    expect(shortcutOf(keyEvent('0', { metaKey: true }), false)).toBe(
      'zoomReset',
    )
    expect(
      shortcutOf(keyEvent('0', { metaKey: true, shiftKey: true }), false),
    ).toBe('zoomFit')
    expect(shortcutOf(keyEvent('Escape'), false)).toBe('escape')
  })

  it('表单获焦时编辑类让位，⌘S 与缩放保留', () => {
    expect(shortcutOf(keyEvent('z', { metaKey: true }), true)).toBeNull()
    expect(shortcutOf(keyEvent('Delete'), true)).toBeNull()
    expect(shortcutOf(keyEvent('ArrowLeft'), true)).toBeNull()
    expect(shortcutOf(keyEvent('s', { metaKey: true }), true)).toBe('save')
    expect(shortcutOf(keyEvent('0', { metaKey: true }), true)).toBe('zoomReset')
    expect(shortcutOf(keyEvent('Escape'), true)).toBe('escape')
  })

  it('带修饰键的 Delete 与普通字母不接管', () => {
    expect(shortcutOf(keyEvent('Delete', { metaKey: true }), false)).toBeNull()
    expect(shortcutOf(keyEvent('a'), false)).toBeNull()
  })
})

function handlerSpy(calls: string[]): EditorShortcutHandlers {
  return {
    save: () => calls.push('save'),
    undo: () => calls.push('undo'),
    redo: () => calls.push('redo'),
    copy: () => calls.push('copy'),
    paste: () => calls.push('paste'),
    duplicate: () => calls.push('duplicate'),
    remove: () => calls.push('remove'),
    selectAll: () => calls.push('selectAll'),
    escape: () => calls.push('escape'),
    nudge: (dx, dy, fine) => calls.push(`nudge:${dx},${dy},${String(fine)}`),
    zoomStep: (direction) => calls.push(`zoomStep:${direction}`),
    zoomReset: () => calls.push('zoomReset'),
    zoomFit: () => calls.push('zoomFit'),
    help: () => calls.push('help'),
    orderForward: () => calls.push('orderForward'),
    orderBackward: () => calls.push('orderBackward'),
    orderFront: () => calls.push('orderFront'),
    orderBack: () => calls.push('orderBack'),
  }
}

describe('监听的生死与挂起', () => {
  function mountShortcuts(suspended?: () => boolean) {
    const calls: string[] = []
    const host = defineComponent({
      setup() {
        useEditorShortcuts({
          handlers: handlerSpy(calls),
          ...(suspended === undefined ? {} : { suspended }),
        })
        return () => h('div')
      },
    })
    return { wrapper: mount(host), calls }
  }

  it('挂载后按键触发对应动作，方向键带上 Alt 精调标记', () => {
    const { wrapper, calls } = mountShortcuts()

    window.dispatchEvent(keyEvent('z', { metaKey: true }))
    window.dispatchEvent(keyEvent('ArrowRight', { altKey: true }))
    window.dispatchEvent(keyEvent('-', { metaKey: true }))

    expect(calls).toEqual(['undo', 'nudge:1,0,true', 'zoomStep:-1'])
    wrapper.unmount()
  })

  it('挂起态只认 Esc', () => {
    const on = ref(true)
    const { wrapper, calls } = mountShortcuts(() => on.value)

    window.dispatchEvent(keyEvent('z', { metaKey: true }))
    window.dispatchEvent(keyEvent('s', { metaKey: true }))
    window.dispatchEvent(keyEvent('Escape'))

    expect(calls).toEqual(['escape'])
    wrapper.unmount()
  })

  it('卸载之后不再接管按键', () => {
    const { wrapper, calls } = mountShortcuts()
    wrapper.unmount()

    window.dispatchEvent(keyEvent('z', { metaKey: true }))

    expect(calls).toEqual([])
  })
})
