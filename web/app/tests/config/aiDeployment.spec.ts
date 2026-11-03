/** @fileoverview AI 功能开关对导航、路由与助手装配的交付契约。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const AI_PATHS = [
  '/knowledge',
  '/knowledge/chat',
  '/system/models',
  '/system/assistant',
]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe.each([
  { raw: 'true', isEnabled: true },
  { raw: 'false', isEnabled: false },
])('VITE_AI_ENABLED=$raw', ({ raw, isEnabled }) => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_AI_ENABLED', raw)
  })

  it('导航按开关展示知识库与模型管理，保留业务建模入口', async () => {
    const { NAV_ITEMS } = await import('@/components/layout/navItems')
    const paths = NAV_ITEMS.flatMap((item) => item.children ?? [item]).map(
      (item) => item.to,
    )
    for (const path of AI_PATHS.slice(0, 3)) {
      expect(paths.includes(path), path).toBe(isEnabled)
    }
    expect(NAV_ITEMS.some((item) => item.key === 'knowledge')).toBe(isEnabled)
    expect(paths).toContain('/modeling/pipelines')
    expect(paths).toContain('/hvac/models')
    expect(paths).toContain('/reports')
  })

  it('关闭后的 AI 地址无法匹配业务页面，其他路由继续可用', async () => {
    const { router } = await import('@/router')
    try {
      const paths = router.getRoutes().map((route) => route.path)
      for (const path of AI_PATHS) {
        expect(paths.includes(path), path).toBe(isEnabled)
        if (!isEnabled) expect(router.resolve(path).name).toBe('not-found')
      }
      expect(router.resolve('/modeling/pipelines').name).toBe(
        'modeling-pipelines',
      )
      expect(router.resolve('/hvac/models').name).toBe('hvac-models')
    } finally {
      router.options.history.destroy()
    }
  })

  it('助手只在功能启用时安装交互口子', async () => {
    const { installAiAssistant } = await import('@/bootstrap/ai')
    const { aiPorts, isAiInstalled } = await import('@/features/ai/ports')
    installAiAssistant()
    expect(isAiInstalled()).toBe(isEnabled)
    expect(aiPorts() !== null).toBe(isEnabled)
  })
})
