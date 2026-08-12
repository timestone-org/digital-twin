/**
 * @fileoverview 左侧导航的唯一清单。新增页面只加这里的数组项。
 *
 * ⚠ 每一项的 `permission` 必须与 router 守卫的 `meta.permissions` 逐字一致：
 * 两边漂移就会出现「看得见点不进」或「看不见但能直接输地址进去」，
 * 由 navItems 的契约测试钉死。
 */

import { PERMISSION_CODES } from '@dt/contracts'

export interface NavItem {
  key: string
  label: string
  icon: string
  /** 叶子项的目标路由；分组项没有。 */
  to?: string
  /** 需要的权限码；**语义是「任一即可」**。缺省即人人可见。 */
  permission?: readonly string[]
  children?: NavItem[]
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: '工作台', icon: 'home', to: '/' },
  {
    key: 'tools',
    label: '工具',
    icon: 'layout-grid',
    children: [
      {
        key: 'opcua-servers',
        label: 'OPC UA 服务端',
        icon: 'activity',
        to: '/tools/opcua-servers',
        permission: [PERMISSION_CODES.opcuaView],
      },
    ],
  },
  {
    key: 'system',
    label: '系统管理',
    icon: 'settings',
    children: [
      {
        key: 'users',
        label: '用户管理',
        icon: 'users',
        to: '/system/users',
        permission: [PERMISSION_CODES.userView],
      },
      {
        key: 'roles',
        label: '角色管理',
        icon: 'shield-check',
        to: '/system/roles',
        permission: [PERMISSION_CODES.userView],
      },
      {
        key: 'permissions',
        label: '权限目录',
        icon: 'key-round',
        to: '/system/permissions',
        permission: [PERMISSION_CODES.userView, PERMISSION_CODES.roleManage],
      },
      {
        key: 'route-rules',
        label: '路由规则',
        icon: 'route',
        to: '/system/route-rules',
        permission: [PERMISSION_CODES.routeRuleView],
      },
    ],
  },
]

/** 取一项的权限码数组。缺省与空数组同义：人人可见。 */
export function navPermissionCodes(item: NavItem): readonly string[] {
  return item.permission ?? []
}
