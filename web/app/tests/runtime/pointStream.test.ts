/**
 * @fileoverview 契约：注入给实时 provider 的订阅函数按**大屏主题**订阅，
 * 一帧里是整屏的条目、只把要的那批往下发，退订真的把通道上的订阅摘掉。
 */
import { describe, expect, it, vi } from 'vitest'
import type { PointSample } from '@dt/contracts'

import {
  clearPointSnapshots,
  resetPointSnapshots,
  createPointSubscribe,
  type PointChannel,
} from '@/runtime/pointStream'
import { createTopicRegistry } from '@/runtime/topicRegistry'

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

function sharedChannel() {
  const topics = createTopicRegistry()
  const requestSnapshot = vi.fn()
  const channel: PointChannel = {
    subscribe(topic, handler) {
      topics.add(topic, handler)
      return () => {
        topics.remove(topic, handler)
      }
    },
    requestSnapshot,
  }
  const push = (topic: string, payload: Record<string, unknown>) => {
    for (const handler of topics.listeners(topic)) handler(payload)
  }
  const subscribe = createPointSubscribe(channel, () => 'dashboard:d1')
  return { channel, topics, push, subscribe, requestSnapshot }
}

const FRAME = {
  items: [
    { nodeKey: 's:1', state: 'ok', value: 1, timestampMs: 10, quality: 'good' },
    { nodeKey: 's:2', state: 'ok', value: 2, timestampMs: 11, quality: 'good' },
  ],
}

describe('订阅', () => {
  it('同一画布再次打开时立即读到当前点位，不等待数值变化', () => {
    const { channel, push } = sharedChannel()
    const first = createPointSubscribe(channel, () => 'dashboard:d1')
    const stopFirst = first(['s:1'], () => undefined)
    push('dashboard:d1', FRAME)
    const seen: [string, PointSample][] = []
    const second = createPointSubscribe(channel, () => 'dashboard:d1')
    const stopSecond = second(['s:1'], (key, sample) => {
      seen.push([key, sample])
    })

    expect(seen).toEqual([
      ['s:1', { state: 'ok', value: 1, timestampMs: 10, quality: 'good' }],
    ])
    stopSecond()
    stopFirst()
  })

  it('跨视图按点位合并分片和增量，保留未变化的点位', () => {
    const { channel, subscribe, push, requestSnapshot } = sharedChannel()
    subscribe(['s:1'], () => undefined)
    push('dashboard:d1', { items: [FRAME.items[0]] })
    push('dashboard:d1', { items: [FRAME.items[1]] })
    push('dashboard:d1', {
      items: [
        {
          nodeKey: 's:1',
          state: 'ok',
          value: 0,
          timestampMs: 12,
          quality: 'good',
        },
      ],
    })
    const seen = vi.fn()
    createPointSubscribe({ ...channel }, () => 'dashboard:d1')(
      ['s:1', 's:2'],
      seen,
    )

    expect(seen.mock.calls).toEqual([
      ['s:1', { state: 'ok', value: 0, timestampMs: 12, quality: 'good' }],
      ['s:2', { state: 'ok', value: 2, timestampMs: 11, quality: 'good' }],
    ])
    expect(requestSnapshot).not.toHaveBeenCalled()
  })

  it('首个视图由正常订阅取初值，后开的视图缺值时只请求一次补发', () => {
    const { subscribe, push, requestSnapshot } = sharedChannel()
    subscribe(['s:1'], () => undefined)
    expect(requestSnapshot).not.toHaveBeenCalled()
    const seen = vi.fn()
    subscribe(['s:2'], seen)
    subscribe(['s:2'], () => undefined)
    expect(seen).not.toHaveBeenCalled()
    expect(requestSnapshot.mock.calls).toEqual([['dashboard:d1']])

    push('dashboard:d1', FRAME)
    expect(seen).toHaveBeenCalledWith('s:2', {
      state: 'ok',
      value: 2,
      timestampMs: 11,
      quality: 'good',
    })
    subscribe(['s:3'], () => undefined)
    expect(requestSnapshot).toHaveBeenCalledTimes(2)
  })

  it('新视图同时收到已知值和后续推送，不把缺值补成零', () => {
    const { subscribe, push, requestSnapshot } = sharedChannel()
    const first = vi.fn()
    subscribe(['s:1'], first)
    push('dashboard:d1', { items: [FRAME.items[0]] })
    const seen = vi.fn()
    subscribe(['s:1', 's:2'], seen)
    expect(seen.mock.calls).toEqual([
      [
        's:1',
        {
          state: 'ok',
          value: 1,
          timestampMs: 10,
          quality: 'good',
        },
      ],
    ])
    expect(requestSnapshot).toHaveBeenCalledWith('dashboard:d1')

    push('dashboard:d1', FRAME)
    expect(first).toHaveBeenCalledTimes(2)
    expect(seen).toHaveBeenLastCalledWith('s:2', {
      state: 'ok',
      value: 2,
      timestampMs: 11,
      quality: 'good',
    })
  })

  it('取不到值的状态也能作为初值展示', () => {
    const { subscribe, push } = sharedChannel()
    subscribe(['s:1'], () => undefined)
    push('dashboard:d1', {
      items: [{ nodeKey: 's:1', state: 'error', errorMessage: '采集源离线' }],
    })
    const seen = vi.fn()
    subscribe(['s:1'], seen)
    expect(seen).toHaveBeenCalledWith('s:1', {
      state: 'error',
      errorMessage: '采集源离线',
    })
  })

  it('不同画布和连接不会共享初值', () => {
    const { channel, subscribe, push } = sharedChannel()
    subscribe(['s:1'], () => undefined)
    push('dashboard:d1', FRAME)
    const seen = vi.fn()
    createPointSubscribe(channel, () => 'dashboard:d2')(['s:1'], seen)
    const other = sharedChannel()
    other.subscribe(['s:1'], seen)
    expect(seen).not.toHaveBeenCalled()
  })

  it('最后一个视图离开后清除快照，重复退订不影响其余视图', () => {
    const { subscribe, push, topics } = sharedChannel()
    const first = subscribe(['s:1'], () => undefined)
    const second = subscribe(['s:1'], () => undefined)
    push('dashboard:d1', FRAME)
    first()
    first()
    const seen = vi.fn()
    const third = subscribe(['s:1'], seen)
    expect(seen).toHaveBeenCalledOnce()
    second()
    third()
    expect(topics.topics()).toEqual([])

    seen.mockClear()
    subscribe(['s:1'], seen)
    expect(seen).not.toHaveBeenCalled()
  })

  it('连接失效清空初值，重连后可以重新记录并补发', () => {
    const { channel, subscribe, push, requestSnapshot } = sharedChannel()
    subscribe(['s:1'], () => undefined)
    push('dashboard:d1', FRAME)
    subscribe(['s:3'], () => undefined)
    clearPointSnapshots(channel.subscribe)
    const seen = vi.fn()
    subscribe(['s:1'], seen)
    expect(seen).not.toHaveBeenCalled()
    expect(requestSnapshot).toHaveBeenCalledTimes(2)

    push('dashboard:d1', FRAME)
    expect(seen).toHaveBeenCalledWith('s:1', {
      state: 'ok',
      value: 1,
      timestampMs: 10,
      quality: 'good',
    })
    clearPointSnapshots(() => () => undefined)
  })

  it('权限撤回后清空快照并将现有视图标为取不到值', () => {
    const { subscribe, push, topics } = sharedChannel()
    const first = vi.fn()
    subscribe(['s:1'], first)
    push('dashboard:d1', FRAME)
    topics.forget('dashboard:d1')
    expect(first).toHaveBeenLastCalledWith('s:1', {
      state: 'error',
      errorMessage: '实时订阅已被撤回，请检查查看权限',
    })

    const seen = vi.fn()
    subscribe(['s:1'], seen)
    expect(seen).not.toHaveBeenCalled()
  })

  it('上一会话的视图迟到卸载不能清除新会话的快照', () => {
    const { channel, subscribe, push, topics } = sharedChannel()
    const old = subscribe(['s:1'], vi.fn())
    push('dashboard:d1', FRAME)
    topics.clear()
    resetPointSnapshots(channel.subscribe)
    subscribe(['s:1'], vi.fn())
    push('dashboard:d1', FRAME)
    old()
    const seen = vi.fn()
    subscribe(['s:1'], seen)
    expect(seen).toHaveBeenCalledWith('s:1', {
      state: 'ok',
      value: 1,
      timestampMs: 10,
      quality: 'good',
    })
  })

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
