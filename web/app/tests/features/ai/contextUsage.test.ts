/** @fileoverview 上下文事件只接受完整、有限且有明确估算标志的载荷。 */
import { describe, expect, it } from 'vitest'

import { readContextUsage } from '@/features/ai/contextUsage'

const usage = {
  used_tokens: 24000,
  max_tokens: 32768,
  percent: 73.2,
  is_estimated: true,
  state: 'ready',
  compression_count: 0,
}

describe('上下文使用率', () => {
  it('保留服务端的实际预算、估算标志与压缩状态', () => {
    expect(readContextUsage(usage)).toEqual(usage)
    expect(readContextUsage({ ...usage, state: 'compressing' })?.state).toBe(
      'compressing',
    )
    expect(
      readContextUsage({ ...usage, state: 'compressed', compression_count: 2 }),
    ).toMatchObject({ state: 'compressed', compression_count: 2 })
  })

  it.each([
    { max_tokens: 0 },
    { used_tokens: -1 },
    { used_tokens: Number.NaN },
    { percent: Number.POSITIVE_INFINITY },
    { percent: 101 },
    { percent: -1 },
    { compression_count: 0.5 },
    { compression_count: -1 },
    { is_estimated: undefined },
    { state: 'unknown' },
  ])('忽略不合法事件：%j', (patch) => {
    expect(readContextUsage({ ...usage, ...patch })).toBeNull()
  })
})
