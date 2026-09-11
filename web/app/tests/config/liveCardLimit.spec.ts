/** @fileoverview 实时卡片上限的默认值、环境覆盖与非法配置拒绝。 */
import { afterEach, expect, it, vi } from 'vitest'
import { parseLiveCardLimit } from '@/config/liveCardLimit'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('未配置时默认启用最近20张卡片', () => {
  expect(parseLiveCardLimit(undefined)).toBe(20)
})

it.each(['1', '50', '200'])('接受正整数 %s', (value) => {
  expect(parseLiveCardLimit(value)).toBe(Number(value))
})

it.each(['', '0', '-1', '1.5', 'abc', 'Infinity', '9007199254740992'])(
  '拒绝非法配置 %s',
  (value) => {
    expect(() => parseLiveCardLimit(value)).toThrow('必须是正整数')
  },
)

it('页面配置读取环境变量的覆盖值', async () => {
  vi.stubEnv('VITE_KNOWLEDGE_CHAT_MAX_ACTIVE_LIVE_CARDS', '50')
  const config = await import('@/config/app')
  expect(config.MAX_ACTIVE_LIVE_CARDS).toBe(50)
})
