/**
 * @fileoverview 输入区按键判定。最要紧的一条：IME 组合期间的 Enter 是在选字，
 * 发出去的话半句拼音就飞出去了——Safari 在收字那一下 isComposing 已经是 false
 * 而 keyCode 还是 229，两个口径都要认。
 */
import { describe, expect, it } from 'vitest'

import {
  composeKeyOf,
  isAssistantToggle,
  modLabelOf,
  type ComposeKeyStroke,
} from '@/features/ai/composeKeys'

function stroke(part: Partial<ComposeKeyStroke>): ComposeKeyStroke {
  return {
    key: '',
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    keyCode: 0,
    ...part,
  }
}

describe('composeKeyOf', () => {
  it('Enter 发送', () => {
    expect(composeKeyOf(stroke({ key: 'Enter' }), true)).toBe('send')
  })

  it('⌘Enter / Ctrl+Enter 同样发送', () => {
    expect(composeKeyOf(stroke({ key: 'Enter', metaKey: true }), true)).toBe(
      'send',
    )
    expect(composeKeyOf(stroke({ key: 'Enter', ctrlKey: true }), true)).toBe(
      'send',
    )
  })

  it('Shift/Alt+Enter 是换行，交回给输入框', () => {
    expect(
      composeKeyOf(stroke({ key: 'Enter', shiftKey: true }), true),
    ).toBeNull()
    expect(
      composeKeyOf(stroke({ key: 'Enter', altKey: true }), true),
    ).toBeNull()
  })

  it('IME 组合中的 Enter 不发送（isComposing 与 keyCode 229 两个口径）', () => {
    expect(
      composeKeyOf(stroke({ key: 'Enter', isComposing: true }), true),
    ).toBeNull()
    expect(
      composeKeyOf(stroke({ key: 'Enter', keyCode: 229 }), true),
    ).toBeNull()
  })

  it('草稿为空时 ↑ 召回，非空时让给光标移动', () => {
    expect(composeKeyOf(stroke({ key: 'ArrowUp' }), false)).toBe('recall')
    expect(composeKeyOf(stroke({ key: 'ArrowUp' }), true)).toBeNull()
  })

  it('带修饰键的 ↑ 不召回', () => {
    expect(
      composeKeyOf(stroke({ key: 'ArrowUp', metaKey: true }), false),
    ).toBeNull()
  })
})

describe('isAssistantToggle', () => {
  it('⌘I 与 Ctrl+I 都算，大小写不挑', () => {
    expect(isAssistantToggle(stroke({ key: 'i', metaKey: true }))).toBe(true)
    expect(isAssistantToggle(stroke({ key: 'I', ctrlKey: true }))).toBe(true)
  })

  it('裸 i 或带 Shift 的不算', () => {
    expect(isAssistantToggle(stroke({ key: 'i' }))).toBe(false)
    expect(
      isAssistantToggle(stroke({ key: 'i', metaKey: true, shiftKey: true })),
    ).toBe(false)
  })
})

describe('modLabelOf', () => {
  it('Mac 系是 ⌘，其余是 Ctrl', () => {
    expect(modLabelOf('MacIntel')).toBe('⌘')
    expect(modLabelOf('iPhone')).toBe('⌘')
    expect(modLabelOf('Win32')).toBe('Ctrl')
    expect(modLabelOf('Linux x86_64')).toBe('Ctrl')
  })
})
