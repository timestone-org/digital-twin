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
  // 大屏没有独立入口：项目与大屏都在工作台里管，再挂一项「大屏」会让
  // 「新建大屏」在两个地方各有一个入口，且两处的项目上下文对不上
  { key: 'home', label: '工作台', icon: 'layout-grid', to: '/' },
  // 素材是跨大屏的公共资源，不属于系统管理那一组：那一组管的是账号与权限
  {
    key: 'assets',
    label: '素材库',
    icon: 'image',
    to: '/assets',
    permission: [PERMISSION_CODES.assetView],
  },
  {
    // 采集是「去连现场设备读写点位」，与「工具 / OPC UA 服务端」方向相反：
    // 那边本平台是服务端、被上位机连。两组刻意不合并（COLLECT_DESIGN §1）
    key: 'collect',
    label: '数据采集',
    icon: 'gauge',
    children: [
      {
        key: 'collect-opcua',
        label: 'OPC UA',
        icon: 'activity',
        to: '/collect/opcua',
        permission: [PERMISSION_CODES.collectView],
      },
    ],
  },
  {
    key: 'hvac',
    label: '空调管理',
    icon: 'snowflake',
    children: [
      {
        key: 'hvac-units',
        label: '空调台账',
        icon: 'list-checks',
        to: '/hvac/units',
        permission: [PERMISSION_CODES.acView],
      },
      {
        key: 'hvac-startups',
        label: '开机事件',
        icon: 'activity',
        to: '/hvac/startups',
        permission: [PERMISSION_CODES.acView],
      },
      {
        key: 'hvac-models',
        label: '达标预测',
        icon: 'sparkles',
        to: '/hvac/models',
        permission: [PERMISSION_CODES.acView],
      },
      {
        key: 'hvac-spaces',
        label: '空间配置',
        icon: 'building',
        to: '/hvac/spaces',
        permission: [PERMISSION_CODES.acView],
      },
    ],
  },
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
      {
        key: 'api-keys',
        label: 'API 密钥',
        icon: 'lock',
        to: '/system/api-keys',
        permission: [PERMISSION_CODES.userView],
      },
    ],
  },
]

/** 取一项的权限码数组。缺省与空数组同义：人人可见。 */
export function navPermissionCodes(item: NavItem): readonly string[] {
  return item.permission ?? []
}
