/**
 * @fileoverview 契约：右键菜单在节点上与空白处给两套条目，删除标危险色，
 * 且「点了不会有反应」的项一律置灰——摆一个点下去没动静的项比不摆更糟。
 */
import { describe, expect, it } from 'vitest'

import {
  contextMenuGroups,
  type ContextMenuInput,
} from '@/pages/DashboardEditor/scripts/contextMenuItems'

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
    subEditorLabel: '',
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
  it('落在节点上：层序自成一组，再是定位/复制/再制/删除，显隐单独一组', () => {
    expect(labels()).toEqual([
      '置顶',
      '上移一层',
      '下移一层',
      '置底',
      '定位到此节点',
      '复制',
      '再制',
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

  it('选中集里没有可复制的根时复制与再制一起置灰', () => {
    expect(entryOf('copy')?.disabled).toBe(false)
    expect(entryOf('copy', { canCopy: false })?.disabled).toBe(true)
    expect(entryOf('duplicate')?.disabled).toBe(false)
    expect(entryOf('duplicate', { canCopy: false })?.disabled).toBe(true)
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

  it('显隐是双向开关：已隐藏的节点给「显示本节点」且不置灰', () => {
    expect(entryOf('hide')?.label).toBe('隐藏本节点')
    expect(entryOf('hide')?.disabled).toBe(false)
    const hidden = entryOf('hide', { isNodeVisible: false })
    expect(hidden?.label).toBe('显示本节点')
    expect(hidden?.disabled).toBe(false)
  })
})

describe('子编辑器入口', () => {
  // ⚠ 读**声明**不读模块类型：写死类型名的话第三方模块永远拿不到这条入口，
  //   而那类判断 typecheck 与 lint 双双放行
  it('清单声明了子编辑器才摆这一条，且用声明里的文案', () => {
    const groups = contextMenuGroups(
      input({ nodeId: 'n1', subEditorLabel: '自定义卡片' }),
    )
    const entry = groups
      .flatMap((group) => group.items)
      .find((one) => one.action === 'customize')

    expect(entry?.label).toBe('自定义卡片…')
  })

  it('没声明的模块一条都不摆', () => {
    const groups = contextMenuGroups(input({ nodeId: 'n1' }))

    expect(
      groups.flatMap((group) => group.items).map((one) => one.action),
    ).not.toContain('customize')
  })

  // ⚠ 空白处右键没有节点，也就没有「进它的子编辑器」这回事
  it('空白处右键不摆它', () => {
    const groups = contextMenuGroups(
      input({ nodeId: null, subEditorLabel: '自定义卡片' }),
    )

    expect(
      groups.flatMap((group) => group.items).map((one) => one.action),
    ).not.toContain('customize')
  })

  it('排在层序之后、画布动作之前，与「在画布上摆弄它」分开成组', () => {
    const groups = contextMenuGroups(
      input({ nodeId: 'n1', subEditorLabel: '自定义卡片' }),
    )

    expect(groups.map((group) => group.key)).toEqual([
      'node-order',
      'node-sub-editor',
      'node',
      'node-visibility',
    ])
  })
})
