/**
 * @fileoverview 大屏卡片上的九个动作，以及每个动作要的权限码。
 *
 * 码只有三档（`dashboard:view` / `:edit` / `:manage`，见
 * server/services/auth-server/.../rules_platform.py 的 910/912/915/920 四级阶梯）：
 * 读面归 view，改配置归 edit，而「新建一张屏」「删掉一张屏」「把一张屏交给
 * 全互联网」这三类归 manage。
 *
 * ⚠ 前端门禁不是安全边界，真正的拦截在 platform-server 的 require 与
 * auth-server 的路由规则上；这里只是别画出点进去必被弹回的按钮。
 */
import { PERMISSION_CODES } from '@dt/contracts'

export const CARD_ACTIONS = [
  'preview',
  'share',
  'edit',
  'duplicate',
  'rename',
  'validate',
  'save-as-template',
  'export',
  'delete',
] as const

export type CardAction = (typeof CARD_ACTIONS)[number]

/** ⋯ 菜单里能发出的动作，`preview` 除外（它在悬浮层上已有按钮）。 */
export type CardMenuAction = Exclude<CardAction, 'preview'>

/** 每个动作要的权限码，语义是**任一即可**；空数组表示不设门禁。 */
export const CARD_ACTION_CODES: Record<CardAction, readonly string[]> = {
  preview: [],
  // 发布/撤回公开链接：把一张屏交给未认证的公网，与改一行配置不同档
  share: [PERMISSION_CODES.dashboardManage],
  edit: [PERMISSION_CODES.dashboardEdit],
  // 复制会新建一张屏，落在建屏那一档
  duplicate: [PERMISSION_CODES.dashboardManage],
  rename: [PERMISSION_CODES.dashboardEdit],
  validate: [PERMISSION_CODES.dashboardView],
  // 另存为模板写的是模板库，同属建屏面
  'save-as-template': [PERMISSION_CODES.dashboardManage],
  export: [PERMISSION_CODES.dashboardView],
  delete: [PERMISSION_CODES.dashboardManage],
}

/** ⋯ 菜单的一项。 */
export interface CardMenuEntry {
  action: CardMenuAction
  label: string
  /** 已在 DtIcon 注册表登记的名字。 */
  icon: string
  danger?: boolean
}

/** ⋯ 菜单的固定排序：先看、再改、再产出、最后删。 */
export const CARD_MENU: readonly CardMenuEntry[] = [
  { action: 'edit', label: '编辑', icon: 'pencil' },
  { action: 'rename', label: '重命名', icon: 'pencil' },
  { action: 'duplicate', label: '创建副本', icon: 'copy' },
  { action: 'validate', label: '绑定自检', icon: 'list-checks' },
  { action: 'share', label: '发布与分享', icon: 'share' },
  { action: 'save-as-template', label: '另存为模板', icon: 'save' },
  { action: 'export', label: '导出 JSON', icon: 'download' },
  { action: 'delete', label: '删除', icon: 'trash', danger: true },
]

/**
 * 把 ⋯ 菜单项的 value 收回闭合集合；认不出给 null。
 * ⚠ 不写 `as`：菜单项的 value 是 `string`，断言回来会让改错一个名字之后，
 * 点菜单静默什么都不发生。
 * @param value 菜单项的 value
 */
export function toCardMenuAction(value: string): CardMenuAction | null {
  return CARD_MENU.find((entry) => entry.action === value)?.action ?? null
}
