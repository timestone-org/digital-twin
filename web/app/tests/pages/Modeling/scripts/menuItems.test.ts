/**
 * @fileoverview 右键菜单的条目与置灰：什么时候摆哪一组、哪一项该点不动。
 */
import { describe, expect, it } from 'vitest'

import type {
  MenuAction,
  MenuInput,
} from '@/pages/Modeling/Canvas/scripts/menuItems'
import { groupsFor } from '@/pages/Modeling/Canvas/scripts/menuItems'
import {
  clampMenu,
  menuHeightOf,
} from '@/pages/Modeling/Canvas/scripts/menuPosition'

function input(over: Partial<MenuInput> = {}): MenuInput {
  return {
    nodeId: null,
    edgeId: null,
    selectedCount: 0,
    hasIncoming: false,
    hasResult: false,
    canPaste: false,
    hasNodes: true,
    isReadonly: false,
    mod: '⌘',
    ...over,
  }
}

function actionsIn(over: Partial<MenuInput> = {}): MenuAction[] {
  return groupsFor(input(over)).flatMap((group) =>
    group.items.map((item) => item.action),
  )
}

function entryOf(action: MenuAction, over: Partial<MenuInput> = {}) {
  return groupsFor(input(over))
    .flatMap((group) => group.items)
    .find((item) => item.action === action)
}

describe('该摆哪些条目', () => {
  it('落在空白处时没有「参数」「结果」', () => {
    expect(actionsIn()).not.toContain('config')
    expect(actionsIn()).not.toContain('result')
  })

  it('落在节点上时才有「参数」', () => {
    expect(actionsIn({ nodeId: 'n1' })).toContain('config')
  })

  // ⚠ 常摆着的话，一张卡片上右键会弹出一列点了没反应的灰条
  it('选中不足两张时整组对齐都不出现', () => {
    expect(actionsIn({ selectedCount: 1 })).not.toContain('align:left')
  })

  it('选中两张就摆出对齐，等距要三张才亮', () => {
    expect(actionsIn({ selectedCount: 2 })).toContain('align:left')
    expect(entryOf('spread:x', { selectedCount: 2 })?.disabled).toBe(true)
    expect(entryOf('spread:x', { selectedCount: 3 })?.disabled).toBe(false)
  })

  it('只读时对齐与删除整组都不出现', () => {
    const actions = actionsIn({ selectedCount: 3, isReadonly: true })

    expect(actions).not.toContain('align:left')
    expect(actions).not.toContain('remove')
  })

  it('落在线上时删的是那条线，文案也说出来', () => {
    expect(entryOf('remove', { edgeId: 'e1' })?.label).toContain('线')
  })

  it('什么都没选中、也没落在线上时不摆删除', () => {
    expect(actionsIn()).not.toContain('remove')
  })
})

describe('置灰', () => {
  it('剪贴板空着时「粘贴」点不动', () => {
    expect(entryOf('paste')?.disabled).toBe(true)
    expect(entryOf('paste', { canPaste: true })?.disabled).toBe(false)
  })

  it('没选中东西时「复制」点不动', () => {
    expect(entryOf('copy')?.disabled).toBe(true)
    expect(entryOf('copy', { selectedCount: 1 })?.disabled).toBe(false)
  })

  it('没有接进来的线时「断开」点不动', () => {
    expect(entryOf('disconnect', { nodeId: 'n1' })?.disabled).toBe(true)
    expect(
      entryOf('disconnect', { nodeId: 'n1', hasIncoming: true })?.disabled,
    ).toBe(false)
  })

  it('没有结果时「结果」点不动', () => {
    expect(entryOf('result', { nodeId: 'n1' })?.disabled).toBe(true)
  })

  it('空图时「全选」「一键整理」「适应视图」都点不动', () => {
    for (const action of ['select-all', 'auto-layout', 'fit'] as const) {
      expect(entryOf(action, { hasNodes: false })?.disabled).toBe(true)
    }
  })

  it('快捷键提示跟着平台走', () => {
    expect(entryOf('copy', { selectedCount: 1 })?.keys).toBe('⌘C')
    expect(entryOf('copy', { selectedCount: 1, mod: 'Ctrl' })?.keys).toBe(
      'CtrlC',
    )
  })

  it('删除是危险色', () => {
    expect(entryOf('remove', { selectedCount: 1 })?.danger).toBe(true)
  })
})

describe('菜单落点', () => {
  it('贴右下角时往回收，不被顶出视口', () => {
    const at = clampMenu(
      { x: 1900, y: 1000 },
      { width: 1920, height: 1080 },
      { items: 5, groups: 2 },
    )

    expect(at.x).toBeLessThan(1900)
    expect(at.y).toBeLessThan(1000)
  })

  // ⚠ 只锁右下的话，小视口里菜单会被顶出左上角，前几项永远点不到
  it('视口比菜单还小时也不会跑到负坐标去', () => {
    const at = clampMenu(
      { x: 10, y: 10 },
      { width: 200, height: 200 },
      { items: 20, groups: 5 },
    )

    expect(at.x).toBeGreaterThanOrEqual(0)
    expect(at.y).toBeGreaterThanOrEqual(0)
  })

  // ⚠ 按最长的那份估高会让短菜单被顶得离指针老远
  it('高度按当前条目数算，条目少时不多让', () => {
    expect(menuHeightOf(3, 1)).toBeLessThan(menuHeightOf(20, 5))
  })
})
