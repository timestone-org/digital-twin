/** @fileoverview AI 功能开关的默认值、合法配置与非法配置拒绝。 */
import { afterEach, expect, it, vi } from 'vitest'
import { isAiPageEnabled, parseAiEnabled } from '@/config/aiFeatures'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('缺省保留 AI 功能', () => {
  expect(parseAiEnabled(undefined)).toBe(true)
})

it.each([
  { raw: 'true', expected: true },
  { raw: 'false', expected: false },
])('接受明确的布尔文本 $raw', ({ raw, expected }) => {
  expect(parseAiEnabled(raw)).toBe(expected)
})

it.each(['', 'TRUE', 'False', ' true', 'false ', '0', '1', null, true, 0])(
  '拒绝非法配置 %s',
  (raw) => {
    expect(() => parseAiEnabled(raw)).toThrow('必须是 true 或 false')
  },
)

it.each(['true', 'false'])('应用配置读取开关 %s', async (raw) => {
  vi.stubEnv('VITE_AI_ENABLED', raw)
  const config = await import('@/config/app')
  expect(config.AI_ENABLED).toBe(raw === 'true')
})

it('关闭 AI 后保留非 AI 页面和无目标的导航分组', () => {
  expect(isAiPageEnabled('/modeling/pipelines', false)).toBe(true)
  expect(isAiPageEnabled(undefined, false)).toBe(true)
})
