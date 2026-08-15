/**
 * @fileoverview 契约：右键菜单在节点上与空白处给两套条目，删除标危险色，
 * 且「点了不会有反应」的项一律置灰——摆一个点下去没动静的项比不摆更糟。
 */
import { describe, expect, it } from 'vitest'

import {
  contextMenuGroups,
  type ContextMenuInput,
} from '@/pages/DashboardEditor/contextMenuItems'

function input(over: Partial<ContextMenuInput> = {}): ContextMenuInput {
  return {
    nodeId: 'a',
    isNodeVisible: true,
    canForward: true,
    canBackward: true,
    canCopy: true,
    canPaste: true,
    canSelectAll: true,
    isFitted: false,
    mod: '⌘',
    ...over,
  }
}

function labels(over: Partial<ContextMenuInput> = {}): string[] {
  return contextMenuGroups(input(over)).flatMap((group) =>
    group.items.map((item) => item.label),
  )
}

function entryOf(action: string, over: Partial<ContextMenuInput> = {}) {
  return contextMenuGroups(input(over))
    .flatMap((group) => group.items)
    .find((item) => item.action === action)
}

describe('条目表', () => {
  it('落在节点上：层序自成一组，再是居中与复制删除，隐藏单独一组', () => {
    expect(labels()).toEqual([
      '置顶',
      '上移一层',
      '下移一层',
      '置底',
      '移到画布中心',
      '复制',
      '删除',
      '隐藏本节点',
    ])
    expect(contextMenuGroups(input())).toHaveLength(3)
  })

  it('落在空白处：粘贴全选，适应窗口单独一组', () => {
    expect(labels({ nodeId: null })).toEqual(['粘贴', '全选', '适应窗口'])
    expect(contextMenuGroups(input({ nodeId: null }))).toHaveLength(2)
  })

  it('快捷键提示跟着平台的修饰键走，没绑快捷键的给空串', () => {
    expect(entryOf('copy')?.keys).toBe('⌘ C')
    expect(entryOf('paste', { nodeId: null, mod: 'Ctrl' })?.keys).toBe('Ctrl V')
    expect(entryOf('forward')?.keys).toBe('⌘ ]')
    expect(entryOf('front')?.keys).toBe('⌘ ⇧ ]')
    expect(entryOf('center')?.keys).toBe('')
  })

  it('删除是危险动作', () => {
    expect(entryOf('remove')?.danger).toBe(true)
    expect(entryOf('copy')?.danger).toBe(false)
  })
})

describe('置灰', () => {
  it('已经在这一层最上面时，置顶与上移一起置灰', () => {
    expect(entryOf('forward', { canForward: false })?.disabled).toBe(true)
    expect(entryOf('front', { canForward: false })?.disabled).toBe(true)
    expect(entryOf('back', { canForward: false })?.disabled).toBe(false)
  })

  it('已经在最下面时，置底与下移一起置灰', () => {
    expect(entryOf('backward', { canBackward: false })?.disabled).toBe(true)
    expect(entryOf('back', { canBackward: false })?.disabled).toBe(true)
    expect(entryOf('front', { canBackward: false })?.disabled).toBe(false)
  })

  it('选中集里没有可复制的根时复制置灰', () => {
    expect(entryOf('copy')?.disabled).toBe(false)
    expect(entryOf('copy', { canCopy: false })?.disabled).toBe(true)
  })

  it('剪贴板空时粘贴置灰', () => {
    const blank = { nodeId: null }
    expect(entryOf('paste', blank)?.disabled).toBe(false)
    expect(entryOf('paste', { ...blank, canPaste: false })?.disabled).toBe(true)
  })

  it('一个顶层节点都没有时全选置灰', () => {
    const blank = { nodeId: null }
    expect(entryOf('select-all', blank)?.disabled).toBe(false)
    expect(
      entryOf('select-all', { ...blank, canSelectAll: false })?.disabled,
    ).toBe(true)
  })

  it('已经在适应窗口档时适应窗口置灰', () => {
    const blank = { nodeId: null }
    expect(entryOf('fit', blank)?.disabled).toBe(false)
    expect(entryOf('fit', { ...blank, isFitted: true })?.disabled).toBe(true)
  })

  it('节点本来就是隐藏的时候隐藏置灰', () => {
    expect(entryOf('hide')?.disabled).toBe(false)
    expect(entryOf('hide', { isNodeVisible: false })?.disabled).toBe(true)
  })
})
