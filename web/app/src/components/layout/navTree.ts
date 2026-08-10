/**
 * @fileoverview 导航树的判定：按权限收敛、当前路由高亮。
 * 与组件分开是为了让这几条判定能脱离挂载单测——两态侧栏共用同一份口径。
 */

import { navPermissionCodes, type NavItem } from './navItems'

/** 是否持有其中**任一**权限码。 */
export type NavPermissionCheck = (codes: readonly string[]) => boolean

/**
 * 单项可见性。**数组语义是「任一即可」**——按「全都要」判会让只持其中一个码的
 * 账号左栏整块空掉。口径必须与 router 守卫逐字一致。
 */
function canSee(item: NavItem, hasAny: NavPermissionCheck): boolean {
  const codes = navPermissionCodes(item)
  return codes.length === 0 || hasAny(codes)
}

/**
 * 按权限收敛导航树；分组自身不带码，可见性由子项推导：一个都不剩才整组隐藏。
 * @param items 完整清单
 * @param hasAny 权限判定
 */
export function visibleNavItems(
  items: readonly NavItem[],
  hasAny: NavPermissionCheck,
): NavItem[] {
  return items.flatMap((item) => {
    if (!item.children?.length) return canSee(item, hasAny) ? [item] : []
    const children = item.children.filter((child) => canSee(child, hasAny))
    return children.length ? [{ ...item, children }] : []
  })
}

/**
 * 当前路由是否落在这个目标上。'/' 只精确匹配，否则每一页都会把工作台点亮。
 * @param currentPath 当前路由的 path
 * @param to 导航项目标，分组项没有
 */
export function isPathActive(
  currentPath: string,
  to: string | undefined,
): boolean {
  if (to === undefined || to === '') return false
  return to === '/' ? currentPath === '/' : currentPath.startsWith(to)
}

/** 分组是否含当前路由所在的子项。 */
export function isGroupActive(currentPath: string, item: NavItem): boolean {
  return (item.children ?? []).some((child) =>
    isPathActive(currentPath, child.to),
  )
}
