/**
 * @fileoverview 锁住大纲三种「⋯」菜单的项目与可用性：搜索态上移/下移禁用且文案
 * 点明原因、「移入某夹」按 `folder-into:<夹id>` 编值且不列已在的夹、
 * parts 段的新增/批量建并进段菜单。
 */
import { describe, expect, it } from 'vitest'

import {
  OUTLINE_FOLDER_MENU,
  ROW_MENU_INTO_PREFIX,
  outlineRowMenu,
  outlineSectionMenu,
} from '@/pages/TwinEditor/scripts/outlineMenus'
import type { OutlineRowMenuContext } from '@/pages/TwinEditor/scripts/outlineMenus'

function context(
  over: Partial<OutlineRowMenuContext> = {},
): OutlineRowMenuContext {
  return {
    searching: false,
    canMoveUp: true,
    canMoveDown: true,
    folders: [],
    folderId: null,
    ...over,
  }
}

describe('行菜单', () => {
  it('散行无夹时是上移/下移/复制/新建夹并移入/删除', () => {
    expect(outlineRowMenu(context()).map((item) => item.value)).toEqual([
      'move-up',
      'move-down',
      'duplicate',
      'folder-new',
      'remove',
    ])
  })

  it('头一行禁上移、末一行禁下移', () => {
    const menu = outlineRowMenu(context({ canMoveUp: false }))

    expect(menu.find((item) => item.value === 'move-up')?.disabled).toBe(true)
    expect(menu.find((item) => item.value === 'move-down')?.disabled).toBe(
      false,
    )
  })

  // 搜索视图里看不出挪去了哪，重排一律禁
  it('搜索态上移下移都禁用，文案点明「搜索中不能重排」', () => {
    const menu = outlineRowMenu(context({ searching: true }))
    const moves = menu.filter((item) => item.value.startsWith('move-'))

    expect(moves).toHaveLength(2)
    for (const item of moves) {
      expect(item.disabled).toBe(true)
      expect(item.label).toContain('（搜索中不能重排）')
    }
  })

  it('搜索态不禁复制与删除', () => {
    const menu = outlineRowMenu(context({ searching: true }))

    expect(menu.find((item) => item.value === 'duplicate')?.disabled).not.toBe(
      true,
    )
    expect(menu.find((item) => item.value === 'remove')?.disabled).not.toBe(
      true,
    )
  })

  it('每个夹出一条「移入」，值是前缀加夹 id', () => {
    const menu = outlineRowMenu(
      context({
        folders: [
          { id: 'f1', label: '温度组' },
          { id: 'f2', label: '备用组' },
        ],
      }),
    )
    const into = menu.filter((item) =>
      item.value.startsWith(ROW_MENU_INTO_PREFIX),
    )

    expect(into.map((item) => item.value)).toEqual([
      `${ROW_MENU_INTO_PREFIX}f1`,
      `${ROW_MENU_INTO_PREFIX}f2`,
    ])
    expect(into[0]?.label).toBe('移入「温度组」')
  })

  it('行已在的那个夹不再列「移入」，但给「移出文件夹」', () => {
    const menu = outlineRowMenu(
      context({
        folders: [
          { id: 'f1', label: '温度组' },
          { id: 'f2', label: '备用组' },
        ],
        folderId: 'f1',
      }),
    )

    expect(menu.map((item) => item.value)).toContain(
      `${ROW_MENU_INTO_PREFIX}f2`,
    )
    expect(menu.map((item) => item.value)).not.toContain(
      `${ROW_MENU_INTO_PREFIX}f1`,
    )
    expect(menu.map((item) => item.value)).toContain('folder-out')
  })

  it('散行没有「移出文件夹」', () => {
    expect(outlineRowMenu(context()).map((item) => item.value)).not.toContain(
      'folder-out',
    )
  })

  it('删除标成危险项', () => {
    expect(
      outlineRowMenu(context()).find((item) => item.value === 'remove')?.danger,
    ).toBe(true)
  })
})

describe('段菜单', () => {
  it('parts 段把新增与批量建并进菜单', () => {
    expect(
      outlineSectionMenu('parts', '部件').map((item) => item.value),
    ).toEqual(['add', 'bulk-add', 'folder-new'])
  })

  it('parts 的新增项带段标题', () => {
    expect(
      outlineSectionMenu('parts', '部件').find((item) => item.value === 'add')
        ?.label,
    ).toBe('新增部件')
  })

  // 只有部件有「一个模型节点一个」的对应关系
  it('其余段只有新建文件夹', () => {
    expect(
      outlineSectionMenu('anchors', '锚点').map((item) => item.value),
    ).toEqual(['folder-new'])
  })
})

describe('夹头菜单', () => {
  it('只有重命名与删除两项，删除是危险项', () => {
    expect(OUTLINE_FOLDER_MENU.map((item) => item.value)).toEqual([
      'rename',
      'remove',
    ])
    expect(OUTLINE_FOLDER_MENU[1]?.danger).toBe(true)
  })

  it('删除的文案写明不删里面的实体', () => {
    expect(OUTLINE_FOLDER_MENU[1]?.label).toContain('不删里面的实体')
  })
})
