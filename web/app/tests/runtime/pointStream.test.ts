/**
 * @fileoverview 契约：注入给实时 provider 的订阅函数按**大屏主题**订阅，
 * 一帧里是整屏的条目、只把要的那批往下发，退订真的把通道上的订阅摘掉。
 */
import { describe, expect, it, vi } from 'vitest'
import type { PointSample } from '@dt/contracts'

import { createPointSubscribe, type PointChannel } from '@/runtime/pointStream'

/** 记下订过哪些主题的假通道。 */
function fakeChannel() {
  const handlers = new Map<string, (payload: Record<string, unknown>) => void>()
  const unsubscribe = vi.fn()
  const channel: PointChannel = {
    subscribe: (topic, handler) => {
      handlers.set(topic, handler)
      return () => {
        handlers.delete(topic)
        unsubscribe()
      }
    },
  }
  return { channel, handlers, unsubscribe }
}

const FRAME = {
  items: [
    { nodeKey: 's:1', state: 'ok', value: 1, timestampMs: 10, quality: 'good' },
    { nodeKey: 's:2', state: 'ok', value: 2, timestampMs: 11, quality: 'good' },
  ],
}

describe('订阅', () => {
  it('订的是当前大屏的主题', () => {
    const { channel, handlers } = fakeChannel()
    const subscribe = createPointSubscribe(channel, () => 'dashboard:d1')

    subscribe(['s:1'], () => undefined)

    expect([...handlers.keys()]).toEqual(['dashboard:d1'])
  })

  it('只把要的那批点位往下发，整屏其余条目原地丢掉', () => {
    const { channel, handlers } = fakeChannel()
    const seen: [string, PointSample][] = []
    const subscribe = createPointSubscribe(channel, () => 'dashboard:d1')

    subscribe(['s:1'], (nodeKey, sample) => seen.push([nodeKey, sample]))
    handlers.get('dashboard:d1')?.(FRAME)

    expect(seen.map(([key]) => key)).toEqual(['s:1'])
    expect(seen[0]?.[1]).toMatchObject({ state: 'ok', value: 1 })
  })

  it('还没打开任何大屏时不去订', () => {
    const { channel, handlers } = fakeChannel()
    const subscribe = createPointSubscribe(channel, () => null)

    const stop = subscribe(['s:1'], () => undefined)
    stop()

    expect(handlers.size).toBe(0)
  })

  it('一个点位都没有时不打扰通道', () => {
    const { channel, handlers } = fakeChannel()
    const subscribe = createPointSubscribe(channel, () => 'dashboard:d1')

    subscribe([], () => undefined)

    expect(handlers.size).toBe(0)
  })

  it('退订真的把订阅摘掉', () => {
    const { channel, handlers, unsubscribe } = fakeChannel()
    const subscribe = createPointSubscribe(channel, () => 'dashboard:d1')

    const stop = subscribe(['s:1'], () => undefined)
    stop()

    expect(handlers.size).toBe(0)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('形状不对的条目不往下发', () => {
    const { channel, handlers } = fakeChannel()
    const seen: string[] = []
    const subscribe = createPointSubscribe(channel, () => 'dashboard:d1')

    subscribe(['s:1'], (nodeKey) => seen.push(nodeKey))
    handlers.get('dashboard:d1')?.({ items: [{ nodeKey: 's:1', state: 'ok' }] })

    expect(seen).toEqual([])
  })
})
