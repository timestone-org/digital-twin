/**
 * @fileoverview 契约：取数结果只有 ok 与 error 两档，取不到就说取不到。
 * ⚠ 失败绝不退化成空序列——空序列会被读成「这段时间没数据」，那是另一个事实。
 */
import type { DataSourceProvider, HistoryResult } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { DataSourceError } from '../src/errors'
import { errorSlot, okSlot, readHistorySlot } from '../src/slot'

const QUERY = { nodeKey: 'src-1:temp', range: { lastWindow: '1h' } }

function providerReading(
  read: () => Promise<HistoryResult>,
): DataSourceProvider {
  return {
    kind: 'archive',
    subscribe: () => () => undefined,
    readHistory: read,
  }
}

describe('槽结果', () => {
  it('ok 槽带值，error 槽带原因', () => {
    const error = new DataSourceError('invalid-query', '缺点位')

    expect(okSlot(12)).toEqual({ state: 'ok', value: 12 })
    expect(errorSlot(error)).toEqual({ state: 'error', error })
  })
})

describe('读一段历史并收成槽', () => {
  it('取到时原样带上截断位与陈旧位', async () => {
    const result: HistoryResult = {
      points: [{ t: 1, v: 3 }],
      isTruncated: true,
      isStale: true,
    }
    const slot = await readHistorySlot(
      providerReading(() => Promise.resolve(result)),
      QUERY,
    )

    expect(slot).toEqual({ state: 'ok', value: result })
  })

  it('provider 拒绝时给 error 槽且原样保留原因码', async () => {
    const error = new DataSourceError('unsupported-history', '没有历史')
    const slot = await readHistorySlot(
      providerReading(() => Promise.reject(error)),
      QUERY,
    )

    expect(slot).toEqual({ state: 'error', error })
  })

  it('陌生的失败收成 fetch-failed 并挂上原始错误', async () => {
    const cause = new Error('502 Bad Gateway')
    const slot = await readHistorySlot(
      providerReading(() => Promise.reject(cause)),
      QUERY,
    )

    expect(slot.state).toBe('error')
    expect(slot).toMatchObject({
      error: {
        code: 'fetch-failed',
        message: '历史取数失败：502 Bad Gateway',
        cause,
      },
    })
  })

  it('失败的槽里没有序列，不给空数组冒充没数据', async () => {
    const slot = await readHistorySlot(
      providerReading(() => Promise.reject(new Error('断网'))),
      QUERY,
    )

    expect(slot.state).toBe('error')
    expect(slot).not.toHaveProperty('value')
  })
})
