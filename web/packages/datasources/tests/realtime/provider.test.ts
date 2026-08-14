/**
 * @fileoverview 契约：实时 provider 不自己建连接，订阅与历史都走注入的口子；
 * 没注入历史取数时一律拒绝，不拿收到过的那几个点冒充历史曲线。
 */
import type { HistoryResult, PointSample } from '@dt/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createRealtimeProvider } from '../../src/realtime/provider'

const QUERY = { nodeKey: 'src-1:temp', range: { lastWindow: '1h' } }
const SAMPLE: PointSample = {
  state: 'ok',
  value: 21.5,
  timestampMs: 1_764_000_000_000,
  quality: 'good',
}

describe('实时点位 provider', () => {
  it('认 opcua 这一种来源', () => {
    const provider = createRealtimeProvider({
      subscribe: () => () => undefined,
    })

    expect(provider.kind).toBe('opcua')
  })

  it('把点位与回调交给注入的订阅函数，值原样透传', () => {
    const received: [string, PointSample][] = []
    const provider = createRealtimeProvider({
      subscribe: (nodeKeys, onValue) => {
        expect([...nodeKeys]).toEqual(['src-1:temp'])
        onValue('src-1:temp', SAMPLE)
        return () => undefined
      },
    })

    provider.subscribe(['src-1:temp'], (nodeKey, sample) => {
      received.push([nodeKey, sample])
    })

    expect(received).toEqual([['src-1:temp', SAMPLE]])
  })

  it('同一个点位绑到多个槽时只往下发一次', () => {
    const asked: string[][] = []
    const provider = createRealtimeProvider({
      subscribe: (nodeKeys) => {
        asked.push([...nodeKeys])
        return () => undefined
      },
    })

    provider.subscribe(['a', 'b', 'a'], () => undefined)

    expect(asked).toEqual([['a', 'b']])
  })

  it('一个点位都没有时不打扰注入的订阅函数', () => {
    const subscribe = vi.fn(() => () => undefined)
    const provider = createRealtimeProvider({ subscribe })

    const stop = provider.subscribe([], () => undefined)
    stop()

    expect(subscribe).not.toHaveBeenCalled()
  })

  it('退订调用两次也只退一次', () => {
    const stopUpstream = vi.fn()
    const provider = createRealtimeProvider({ subscribe: () => stopUpstream })

    const stop = provider.subscribe(['a'], () => undefined)
    stop()
    stop()

    expect(stopUpstream).toHaveBeenCalledTimes(1)
  })

  it('没注入历史取数时读历史一律拒绝', async () => {
    const provider = createRealtimeProvider({
      subscribe: () => () => undefined,
    })

    await expect(provider.readHistory(QUERY)).rejects.toMatchObject({
      code: 'unsupported-history',
    })
  })

  it('注入了历史取数时原样透传结果', async () => {
    const result: HistoryResult = {
      points: [{ t: 1, v: 2 }],
      isTruncated: false,
      isStale: false,
    }
    const provider = createRealtimeProvider({
      subscribe: () => () => undefined,
      readHistory: () => Promise.resolve(result),
    })

    await expect(provider.readHistory(QUERY)).resolves.toBe(result)
  })
})
