/** @fileoverview 页面地址统一挂载到 /ai/ 的路由契约。 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/router/guards', () => ({ installAuthGuard: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('页面路径前缀', () => {
  it('所有页面及带参数、查询和锚点的导航均生成 /ai/ 地址', async () => {
    vi.stubEnv('BASE_URL', '/ai/')
    const { router } = await import('@/router')
    for (const route of router.getRoutes()) {
      if (!route.path.includes(':')) {
        expect(router.resolve(route.path).href).toBe(`/ai${route.path}`)
      }
    }
    expect(router.resolve('/public/share-token').href).toBe(
      '/ai/public/share-token',
    )
    expect(router.resolve('/knowledge?embed=1&theme=emerald#chat').href).toBe(
      '/ai/knowledge?embed=1&theme=emerald#chat',
    )
    expect(router.resolve('/login?returnUrl=/knowledge').href).toBe(
      '/ai/login?returnUrl=/knowledge',
    )
    router.options.history.destroy()
  })
})
