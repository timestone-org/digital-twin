/**
 * @fileoverview 导航树判定的契约：权限收敛「任一即可」、分组空掉即整组隐藏、
 * 高亮口径（'/' 只精确匹配）。两态侧栏共用这份判定，跑偏会让两边高亮不一致。
 */
import { describe, expect, it } from 'vitest'

import type { NavItem } from '@/components/layout/navItems'
import {
  activeChildKey,
  isGroupActive,
  isPathActive,
  visibleNavItems,
} from '@/components/layout/navTree'

const HOME: NavItem = { key: 'home', label: '工作台', icon: 'home', to: '/' }

const SYSTEM: NavItem = {
  key: 'system',
  label: '系统管理',
  icon: 'settings',
  children: [
    {
      key: 'users',
      label: '用户管理',
      icon: 'users',
      to: '/system/users',
      permission: ['user:view'],
    },
    {
      key: 'rules',
      label: '路由规则',
      icon: 'route',
      to: '/system/route-rules',
      permission: ['route-rule:view'],
    },
  ],
}

const TREE: readonly NavItem[] = [HOME, SYSTEM]

/** 持有其中任一码即放行，与 auth.can(codes, 'any') 同口径。 */
function holder(codes: readonly string[]) {
  return (required: readonly string[]) =>
    required.some((code) => codes.includes(code))
}

describe('visibleNavItems', () => {
  it('不带权限码的项人人可见', () => {
    expect(visibleNavItems(TREE, holder([])).map((item) => item.key)).toEqual([
      'home',
    ])
  })

  it('分组里只留下持有权限的子项', () => {
    const system = visibleNavItems(TREE, holder(['user:view']))[1]
    expect(system?.children?.map((child) => child.key)).toEqual(['users'])
  })

  it('一个子项都不剩时整组隐藏，而不是留一个空壳', () => {
    const keys = visibleNavItems(TREE, holder([])).map((item) => item.key)
    expect(keys).not.toContain('system')
  })

  it('数组语义是「任一即可」——只持其中一个码也看得见', () => {
    const group: NavItem = {
      key: 'system',
      label: '系统管理',
      icon: 'settings',
      children: [
        {
          key: 'permissions',
          label: '权限目录',
          icon: 'key-round',
          to: '/system/permissions',
          permission: ['user:view', 'role:manage'],
        },
      ],
    }
    expect(
      visibleNavItems([group], holder(['role:manage']))[0]?.children,
    ).toHaveLength(1)
  })

  it('不改原清单——收敛出来的是新对象', () => {
    visibleNavItems(TREE, holder(['user:view']))
    expect(SYSTEM.children).toHaveLength(2)
  })
})

describe('isPathActive', () => {
  it("'/' 只精确匹配，否则每一页都会把工作台点亮", () => {
    expect(isPathActive('/', '/')).toBe(true)
    expect(isPathActive('/system/users', '/')).toBe(false)
  })

  it('其余目标按前缀匹配，子路由也算在当前页上', () => {
    expect(isPathActive('/system/users/u1', '/system/users')).toBe(true)
    expect(isPathActive('/system/roles', '/system/users')).toBe(false)
  })

  it('分组项没有目标，一律不算活跃', () => {
    expect(isPathActive('/system/users', undefined)).toBe(false)
    expect(isPathActive('/system/users', '')).toBe(false)
  })

  it('前缀只认整段路径，/knowledgebase 不算落在 /knowledge 上', () => {
    expect(isPathActive('/knowledgebase', '/knowledge')).toBe(false)
    expect(isPathActive('/knowledge', '/knowledge')).toBe(true)
  })
})

/** 一个子项的目标是另一个的前缀：知识库那组正是这样。 */
const KNOWLEDGE: NavItem = {
  key: 'knowledge',
  label: '知识库',
  icon: 'search',
  children: [
    {
      key: 'manage',
      label: '知识库管理',
      icon: 'folder-open',
      to: '/knowledge',
    },
    {
      key: 'chat',
      label: '知识库对话',
      icon: 'sparkles',
      to: '/knowledge/chat',
    },
  ],
}

describe('activeChildKey', () => {
  it('子项互为前缀时只点亮匹配最长的那一个', () => {
    // ⚠ 按前缀各判各的会让两个子项同时亮，而其它分组看不出这个问题
    expect(activeChildKey('/knowledge/chat', KNOWLEDGE)).toBe('chat')
    expect(activeChildKey('/knowledge', KNOWLEDGE)).toBe('manage')
  })

  it('没有子项命中时是 null', () => {
    expect(activeChildKey('/profile', KNOWLEDGE)).toBeNull()
    expect(activeChildKey('/knowledge', HOME)).toBeNull()
  })
})

describe('isGroupActive', () => {
  it('任一子项命中即整组活跃', () => {
    expect(isGroupActive('/system/users', SYSTEM)).toBe(true)
    expect(isGroupActive('/profile', SYSTEM)).toBe(false)
  })

  it('没有子项的项不是分组', () => {
    expect(isGroupActive('/', HOME)).toBe(false)
  })
})
