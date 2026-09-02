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
    // 知识库挨着素材库：两者都是**跨大屏的公共资料**，不属于任何一张屏，
    // 也不属于系统管理那一组（那一组管的是账号与权限）。
    // 一级分组，下面两页：管资料的，与对着资料提问的。
    // ⚠ 两页都只挂读码 `knowledge:use`，与路由 meta 逐字一致——两边漂移会
    // 造出「看得见点不进」或「看不见但输地址能进」，由 navItems 的契约测试钉死。
    key: 'knowledge',
    label: '知识库',
    icon: 'search',
    children: [
      {
        key: 'knowledge-manage',
        label: '知识库管理',
        icon: 'folder-open',
        to: '/knowledge',
        permission: [PERMISSION_CODES.knowledgeUse],
      },
      {
        key: 'knowledge-chat',
        label: '知识库对话',
        icon: 'sparkles',
        to: '/knowledge/chat',
        permission: [PERMISSION_CODES.knowledgeUse],
      },
    ],
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
    // 台账挨着采集：它唯一的上游就是采集落下来的点位历史（DATASET_DESIGN §2.1）。
    // ⚠ 只挂读码，与路由的 meta.permissions 逐字一致——两边漂移会造出
    // 「看得见点不进」或「看不见但输地址能进」，由 navItems 的契约测试钉死。
    key: 'datasets',
    label: '数据台账',
    icon: 'table',
    to: '/datasets',
    permission: [PERMISSION_CODES.datasetView],
  },
  {
    // 公式库挨着台账：它是台账列的口径来源，但**不属于**任何一张台账。
    // ⚠ 挂的是 formula:view 而不是 dataset:view——两个码互不蕴含，
    // 与路由 meta 逐字一致，由 navItems 的契约测试钉死。
    key: 'formulas',
    label: '公式库',
    icon: 'type',
    to: '/formulas',
    permission: [PERMISSION_CODES.formulaView],
  },
  {
    // 建模挨着台账：它的上游就是台账，下游又回到台账（发布成公式）。
    // ⚠ 只挂读码 `modeling:view`，与路由 meta 逐字一致——两边漂移会造出
    // 「看得见点不进」或「看不见但输地址能进」，由 navItems 的契约测试钉死。
    key: 'modeling',
    label: '分析建模',
    icon: 'workflow',
    to: '/modeling/pipelines',
    permission: [PERMISSION_CODES.modelingView],
  },
  {
    // 趋势分析横跨两层数据：上游的点位历史与派生出来的台账。挂在台账旁边而
    // 不是塞进采集组里——它的入口是「我想看一条曲线」，不是「我要配采集」。
    // ⚠ 两个码是**任一即可**，与路由的 permissionMode: 'any' 对应；导航项的码
    // 与路由 meta 逐字一致，由 navItems 的契约测试钉死。
    key: 'trend',
    label: '趋势分析',
    icon: 'chart-line',
    to: '/trend',
    permission: [PERMISSION_CODES.collectView, PERMISSION_CODES.datasetView],
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
      {
        // 供应商目录同时喂助手与知识库，故叫「模型管理」而不是「助手模型」；
        // 订阅账号那一节仍归 assistant:manage，在页内另判
        key: 'models',
        label: '模型管理',
        icon: 'sparkles',
        to: '/system/models',
        permission: [PERMISSION_CODES.llmView],
      },
    ],
  },
]

/** 取一项的权限码数组。缺省与空数组同义：人人可见。 */
export function navPermissionCodes(item: NavItem): readonly string[] {
  return item.permission ?? []
}
