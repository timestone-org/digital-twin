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

/**
 * 有路由、**故意**不进导航的固定路径。加一条要写清为什么。
 * ⚠ 这是允许清单不是排除清单：新页面忘了挂导航时，该红的是它而不是这张表。
 */
const NAV_EXEMPT = new Set([
  // 大屏没有独立入口：项目与大屏都在工作台里管（见 navItems 文件头）
  '/dashboards',
  // 模型列表由「分析建模」页内部跳过去，不单独占一格导航
  '/modeling/models',
  // 模型服务同上：它的入口在「分析建模」页的顶栏，与模型库并排
  '/modeling/services',
  // 运行记录同上
  '/modeling/runs',
  // 模板、接入实例与接入说明由第三方接入分区访问。
  '/modeling/instances',
  '/modeling/templates',
  '/modeling/integration',
])

describe('导航清单', () => {
  it('分析建模默认进入流程图工作台', () => {
    expect(NAV_ITEMS.find((item) => item.key === 'modeling')?.to).toBe(
      '/modeling/pipelines',
    )
  })
  it('数据采集按协议提供三个独立菜单入口', () => {
    const collection = NAV_ITEMS.find((item) => item.key === 'collect')
    expect(
      collection?.children?.map(({ label, to }) => ({ label, to })),
    ).toEqual([
      { label: 'OPC UA 采集', to: '/collect/opcua' },
      { label: 'Modbus TCP 采集', to: '/collect/modbus-tcp' },
      { label: 'HTTP / HTTPS 采集', to: '/collect/http' },
    ])
  })

  it.each([
    ['/collect/opcua', 'OPC UA 采集'],
    ['/collect/modbus-tcp', 'Modbus TCP 采集'],
    ['/collect/http', 'HTTP / HTTPS 采集'],
  ])('%s 有独立标题且沿用采集查看权限', (path, title) => {
    const route = router.getRoutes().find((entry) => entry.path === path)
    expect(route?.meta).toMatchObject({ title, permissions: ['collect:view'] })
  })

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

  it('每条要权限的固定路由都进得了导航，或者被明确豁免', () => {
    // ⚠ 这条守的是**反方向**：只钉「导航项→路由」的话，一个有路由、没导航项
    // 的页面在界面上完全不存在，而 typecheck、lint、全部单测一律放行——
    // 只有手敲地址才进得去。知识库就是这么漏掉一整个模块的。
    const wired = new Set(leaves.map((item) => item.to))
    const stray = router
      .getRoutes()
      .filter((route) => !route.path.includes(':'))
      .filter((route) => (route.meta.permissions ?? []).length > 0)
      .map((route) => route.path)
      .filter((path) => !wired.has(path) && !NAV_EXEMPT.has(path))

    expect(stray).toEqual([])
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
