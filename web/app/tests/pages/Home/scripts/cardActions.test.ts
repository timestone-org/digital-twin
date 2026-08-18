/**
 * @fileoverview 卡片动作与权限码的映射契约。
 * ⚠ 菜单项的 value 是普通字符串，写错一个名字不会报错、只会点了没反应，
 * 唯一的防线是这里的「每一项都收得回闭合集合」。
 */
import { describe, expect, it } from 'vitest'
import { PERMISSION_CODES } from '@dt/contracts'
import { ICONS } from '@dt/ui'

import {
  CARD_ACTIONS,
  CARD_ACTION_CODES,
  CARD_MENU,
  toCardMenuAction,
} from '@/pages/Home/scripts/cardActions'

const KNOWN_CODES: readonly string[] = Object.values(PERMISSION_CODES)

describe('动作 × 权限码', () => {
  it('九个动作各有一条映射', () => {
    expect(Object.keys(CARD_ACTION_CODES).sort()).toEqual(
      [...CARD_ACTIONS].sort(),
    )
  })

  it('映射里的码都是已发布的权限码', () => {
    for (const codes of Object.values(CARD_ACTION_CODES)) {
      for (const code of codes) expect(KNOWN_CODES).toContain(code)
    }
  })

  it('预览不设门禁——卡片能被看见就意味着能预览', () => {
    expect(CARD_ACTION_CODES.preview).toEqual([])
  })

  it('删除、发布、复制、另存为模板都要 manage', () => {
    for (const action of [
      'delete',
      'share',
      'duplicate',
      'save-as-template',
    ] as const) {
      expect(CARD_ACTION_CODES[action]).toContain(
        PERMISSION_CODES.dashboardManage,
      )
    }
  })

  it('自检与导出只要读权限', () => {
    expect(CARD_ACTION_CODES.validate).toEqual([PERMISSION_CODES.dashboardView])
    expect(CARD_ACTION_CODES.export).toEqual([PERMISSION_CODES.dashboardView])
  })
})

describe('⋯ 菜单', () => {
  it('装的是 preview 之外的全部动作，不重不漏', () => {
    expect(CARD_MENU.map((entry) => entry.action).sort()).toEqual(
      CARD_ACTIONS.filter((action) => action !== 'preview')
        .slice()
        .sort(),
    )
  })

  it('每一项的图标都在 DtIcon 注册表里——没登记的名字静默不渲染', () => {
    for (const entry of CARD_MENU) {
      expect(Object.keys(ICONS)).toContain(entry.icon)
    }
  })

  it('只有删除是危险色', () => {
    const danger = CARD_MENU.filter((entry) => entry.danger === true)
    expect(danger.map((entry) => entry.action)).toEqual(['delete'])
  })

  it('每一项的 value 都收得回闭合集合', () => {
    for (const entry of CARD_MENU) {
      expect(toCardMenuAction(entry.action)).toBe(entry.action)
    }
  })

  it('认不出的 value 给 null，不冒充成某个动作', () => {
    expect(toCardMenuAction('preview')).toBeNull()
    expect(toCardMenuAction('nope')).toBeNull()
  })
})
