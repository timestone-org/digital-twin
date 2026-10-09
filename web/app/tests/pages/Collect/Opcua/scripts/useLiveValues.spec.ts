/** @fileoverview 数据源分片帧的完整合并、逐点心跳与换源隔离契约。 */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import {
  useLiveValues,
  type LiveValues,
} from '@/pages/Collect/Opcua/scripts/useLiveValues'

interface Subscription {
  topic: string
  handler: (payload: unknown) => void
  unsubscribe: () => void
}

const subscriptions: Subscription[] = []
const isConnected = ref(true)

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    isConnected,
    subscribe: (topic: string, handler: (payload: unknown) => void) => {
      const unsubscribe = vi.fn()
      subscriptions.push({ topic, handler, unsubscribe })
      return unsubscribe
    },
  }),
}))

function mountLive() {
  const sourceId = ref('s1')
  let state: LiveValues | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useLiveValues(sourceId)
        return () => h('div')
      },
    }),
  )
  if (state === undefined) throw new Error('实时值未初始化')
  return { sourceId, state, wrapper }
}

function pointItem(number: number, sourceId = 's1', value = number) {
  return {
    nodeKey: `${sourceId}:PT${String(number).padStart(4, '0')}`,
    state: 'ok',
    value,
    timestampMs: 1,
    quality: 'good',
  }
}

function sourceItems() {
  return Array.from({ length: 1119 }, (_, index) => pointItem(index + 1))
}

function emit(items: readonly unknown[], topic = 'collect:s1'): void {
  const subscription = subscriptions.find((one) => one.topic === topic)
  if (subscription === undefined) throw new Error(`尚未订阅 ${topic}`)
  subscription.handler({ items })
}

function emitFullSource(): void {
  const items = sourceItems()
  for (let start = 0; start < items.length; start += 500) {
    emit(items.slice(start, start + 500))
  }
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 9, 9, 2))
  subscriptions.length = 0
  isConnected.value = true
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('整源分片实时值', () => {
  it('1119 个点位的多片初帧合并为完整清单', () => {
    const { state } = mountLive()
    emitFullSource()

    expect(state.samples.value.size).toBe(1119)
    expect(state.samples.value.get('s1:PT0001')).toEqual({
      state: 'ok',
      value: 1,
      timestampMs: 1,
      quality: 'good',
    })
    expect(state.samples.value.get('s1:PT1000')).toMatchObject({ value: 1000 })
    expect(state.samples.value.get('s1:PT1001')).toMatchObject({ value: 1001 })
    expect(state.samples.value.get('s1:PT1119')).toMatchObject({ value: 1119 })
    expect(state.staleKeys.value.size).toBe(0)
  })

  it('第 1001 与 1119 个点位的增量更新保留其余点位', () => {
    const { state } = mountLive()
    emitFullSource()
    emit([pointItem(1001, 's1', 40.1), pointItem(1119, 's1', 51.9)])

    expect(state.samples.value.size).toBe(1119)
    expect(state.samples.value.get('s1:PT1001')).toMatchObject({ value: 40.1 })
    expect(state.samples.value.get('s1:PT1119')).toMatchObject({ value: 51.9 })
    expect(state.samples.value.get('s1:PT0001')).toMatchObject({ value: 1 })
  })

  it('15 秒全源心跳使所有未变化读数保持有效', async () => {
    const { state } = mountLive()
    emitFullSource()
    for (let heartbeat = 0; heartbeat < 4; heartbeat += 1) {
      await vi.advanceTimersByTimeAsync(15_000)
      emitFullSource()
      expect(state.staleKeys.value.size).toBe(0)
    }

    expect(state.samples.value.get('s1:PT1119')).toMatchObject({
      timestampMs: 1,
    })
    await vi.advanceTimersByTimeAsync(45_000)
    expect(state.staleKeys.value.size).toBe(1119)
  })

  it('前 1000 个点位的心跳不能把其余点位冒充为最新', async () => {
    const { state } = mountLive()
    emitFullSource()
    const firstThousand = sourceItems().slice(0, 1000)
    for (let heartbeat = 0; heartbeat < 3; heartbeat += 1) {
      await vi.advanceTimersByTimeAsync(15_000)
      emit(firstThousand)
    }

    expect(state.staleKeys.value.size).toBe(119)
    expect(state.staleKeys.value.has('s1:PT1000')).toBe(false)
    expect(state.staleKeys.value.has('s1:PT1001')).toBe(true)
    expect(state.staleKeys.value.has('s1:PT1119')).toBe(true)
  })

  it('断线保留最后值并标陈旧，重连后逐片恢复有效性', async () => {
    const { state } = mountLive()
    emitFullSource()
    isConnected.value = false
    await nextTick()

    expect(state.samples.value.get('s1:PT1119')).toMatchObject({ value: 1119 })
    expect(state.staleKeys.value.size).toBe(1119)
    isConnected.value = true
    await nextTick()
    expect(state.staleKeys.value.size).toBe(1119)
    emit([pointItem(1119, 's1', 25.5)])
    expect(state.staleKeys.value.has('s1:PT1119')).toBe(false)
    expect(state.staleKeys.value.size).toBe(1118)
  })

  it('换源清空旧值并丢弃迟到的旧源帧与混入的新源帧', async () => {
    const { sourceId, state } = mountLive()
    const previous = subscriptions[0]
    if (previous === undefined) throw new Error('原数据源未订阅')
    emitFullSource()
    sourceId.value = 's2'
    await nextTick()

    expect(previous.unsubscribe).toHaveBeenCalledOnce()
    expect(state.samples.value.size).toBe(0)
    expect(state.staleKeys.value.size).toBe(0)
    previous.handler({ items: [pointItem(1119, 's2', 99)] })
    emit([pointItem(1119), pointItem(1119, 's2', 23.5)], 'collect:s2')

    expect(state.samples.value.size).toBe(1)
    expect(state.samples.value.has('s1:PT1119')).toBe(false)
    expect(state.samples.value.get('s2:PT1119')).toMatchObject({ value: 23.5 })
  })
})
