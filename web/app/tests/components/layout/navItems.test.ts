/**
 * @fileoverview 锁住导航清单与路由表的一致性。
 * ⚠ 两边漂移完全静默：要么「看得见点不进」（导航没权限码、路由有），
 * 要么「看不见但能直接输地址进去」（反过来）。
 */
import { describe, expect, it } from 'vitest'

import { NAV_ITEMS, navPermissionCodes } from '@/components/layout/navItems'
import { router } from '@/router'

/** 摊平成叶子项。 */
const leaves = NAV_ITEMS.flatMap((item) => item.children ?? [item]).filter(
  (item) => item.to !== undefined,
)

describe('导航清单', () => {
  it('每个叶子项都指向一条真实存在的路由', () => {
    const paths = router.getRoutes().map((route) => route.path)
    for (const item of leaves) {
      expect(paths, item.key).toContain(item.to)
    }
  })

  it('导航项的权限码与路由 meta 逐字一致', () => {
    for (const item of leaves) {
      const route = router.getRoutes().find((r) => r.path === item.to)
      const routeCodes = [...(route?.meta.permissions ?? [])].sort()
      const navCodes = [...navPermissionCodes(item)].sort()
      expect(navCodes, item.key).toEqual(routeCodes)
    }
  })

  it('分组项自身不带权限码——可见性由子项推导', () => {
    for (const item of NAV_ITEMS) {
      if (item.children?.length) {
        expect(item.permission, item.key).toBeUndefined()
      }
    }
  })

  it('key 唯一', () => {
    const keys = NAV_ITEMS.flatMap((item) => [
      item.key,
      ...(item.children ?? []).map((child) => child.key),
    ])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('图标名全部已在 DtIcon 注册表里', async () => {
    const { isIconName } = await import('@dt/ui')
    const icons = NAV_ITEMS.flatMap((item) => [
      item.icon,
      ...(item.children ?? []).map((child) => child.icon),
    ])
    expect(icons.filter((icon) => !isIconName(icon))).toEqual([])
  })
})
