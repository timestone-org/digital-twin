/**
 * @fileoverview 取值源的行为契约（推送版）。
 *
 * 这个文件守的是四条**只有在现场才会暴露**的事：
 * 1. 卸载后必须退订——不退的话，切走的页面仍在收消息并更新已经不在的状态。
 * 2. 换节点时慢的那次不许覆盖快的那次，否则显示的是上一个节点的值且不报错。
 * 3. 换节点的瞬间旧值必须先清掉，否则新节点还没回来时界面在说谎。
 * 4. **别的节点的推送不许抹掉当前值**——一个主题推的是整台实例的值。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import type { Ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { OpcuaNodeValue } from '@dt/contracts'

import * as opcuaApi from '@/api/opcua'
import * as channel from '@/composables/useRealtimeChannel'
import { useNodeValue } from '@/pages/Tools/OpcuaServerDetail/scripts/useNodeValue'

type Handler = (payload: Record<string, unknown>) => void

function value(over: Partial<OpcuaNodeValue> = {}): OpcuaNodeValue {
  return {
    node_id: 'ns=2;s=T1',
    identifier: 'T1',
    data_type: 'double',
    value: 1,
    is_live: true,
    ...over,
  }
}

/** 装一个假通道，返回当前订阅者与退订次数。 */
function fakeChannel(): {
  push: (payload: Record<string, unknown>) => void
  unsubscribed: () => number
} {
  const state = { handler: null as Handler | null, offCount: 0 }
  vi.spyOn(channel, 'useRealtimeChannel').mockReturnValue({
    isConnected: ref(true),
    subscribe: (_topic: string, handler: Handler) => {
      state.handler = handler
      return () => {
        state.offCount += 1
        state.handler = null
      }
    },
  })
  return {
    push: (payload) => state.handler?.(payload),
    unsubscribed: () => state.offCount,
  }
}

/** 把 composable 装进一个真实组件里，才能验证 onBeforeUnmount。 */
function harness(nodeId: Ref<string | null>, identifier: Ref<string | null>) {
  const source: { current: ReturnType<typeof useNodeValue> | null } = {
    current: null,
  }
  const wrapper = mount(
    defineComponent({
      setup() {
        source.current = useNodeValue(ref('i1'), nodeId, identifier)
        return () => null
      },
    }),
  )
  return { wrapper, source }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('取值源', () => {
  it('节点为 null 时不读也不订', async () => {
    fakeChannel()
    const read = vi.spyOn(opcuaApi, 'readNodeValue')
    const { wrapper } = harness(
      ref<string | null>(null),
      ref<string | null>(null),
    )
    await nextTick()
    expect(read).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('选中节点后读一次初值——hub 只推变化，不会凭空给当前值', async () => {
    fakeChannel()
    const read = vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue(value())
    const { wrapper } = harness(ref<string | null>('n1'), ref('T1'))
    await nextTick()
    expect(read).toHaveBeenCalledTimes(1)
    // 此后不再轮询：又过了 10 秒也还是那一次
    await vi.advanceTimersByTimeAsync(10_000)
    expect(read).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('推送到达时就地更新，不再发请求', async () => {
    const live = fakeChannel()
    const read = vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue(value())
    const { wrapper, source } = harness(ref<string | null>('n1'), ref('T1'))
    await vi.advanceTimersByTimeAsync(0)
    live.push({ items: [{ identifier: 'T1', value: 42 }] })
    await nextTick()
    expect(source.current?.value.value?.value).toBe(42)
    expect(read).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('⚠ 别的节点的推送不许抹掉当前值', async () => {
    const live = fakeChannel()
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue(value({ value: 7 }))
    const { wrapper, source } = harness(ref<string | null>('n1'), ref('T1'))
    await vi.advanceTimersByTimeAsync(0)
    live.push({ items: [{ identifier: 'OTHER', value: 999 }] })
    await nextTick()
    expect(source.current?.value.value?.value).toBe(7)
    wrapper.unmount()
  })

  it('⚠ 卸载后必须退订', async () => {
    const live = fakeChannel()
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue(value())
    const { wrapper } = harness(ref<string | null>('n1'), ref('T1'))
    await nextTick()
    wrapper.unmount()
    expect(live.unsubscribed()).toBeGreaterThan(0)
  })

  it('⚠ 换节点时先清空旧值，别让界面显示上一个节点的读数', async () => {
    fakeChannel()
    vi.spyOn(opcuaApi, 'readNodeValue')
      .mockResolvedValueOnce(value({ identifier: 'OLD' }))
      .mockImplementation(() => new Promise<OpcuaNodeValue>(() => {}))
    const nodeId = ref<string | null>('n1')
    const identifier = ref<string | null>('OLD')
    const { wrapper, source } = harness(nodeId, identifier)
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.value.value?.identifier).toBe('OLD')
    nodeId.value = 'n2'
    identifier.value = 'NEW'
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.value.value).toBeNull()
    wrapper.unmount()
  })

  it('⚠ 慢的那次不许覆盖快的那次', async () => {
    fakeChannel()
    const slow: { resolve: ((result: OpcuaNodeValue) => void) | null } = {
      resolve: null,
    }
    vi.spyOn(opcuaApi, 'readNodeValue')
      .mockImplementationOnce(
        () =>
          new Promise<OpcuaNodeValue>((resolve) => {
            slow.resolve = resolve
          }),
      )
      .mockResolvedValue(value({ identifier: 'FAST', value: 2 }))

    const nodeId = ref<string | null>('slow')
    const identifier = ref<string | null>('SLOW')
    const { wrapper, source } = harness(nodeId, identifier)
    await nextTick()
    nodeId.value = 'fast'
    identifier.value = 'FAST'
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.value.value?.identifier).toBe('FAST')

    slow.resolve?.(value({ identifier: 'SLOW', value: 1 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.value.value?.identifier).toBe('FAST')
    wrapper.unmount()
  })

  it('⚠ 载荷形状不对时按「这批里没有它」处理，不抹掉当前值', async () => {
    // items 不是数组、条目不是对象——都来自另一个服务，形状变了不能连累显示
    const live = fakeChannel()
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue(value({ value: 5 }))
    const { wrapper, source } = harness(ref<string | null>('n1'), ref('T1'))
    await vi.advanceTimersByTimeAsync(0)
    live.push({ items: 'not a list' })
    live.push({ items: [null, 'nope'] })
    await nextTick()
    expect(source.current?.value.value?.value).toBe(5)
    wrapper.unmount()
  })

  it('还没读到初值时，推送不凭空拼出一个值', async () => {
    // 没有初值就没有 data_type 等字段，凭一条推送拼不出完整的 OpcuaNodeValue
    const live = fakeChannel()
    vi.spyOn(opcuaApi, 'readNodeValue').mockRejectedValue(new Error('boom'))
    const { wrapper, source } = harness(ref<string | null>('n1'), ref('T1'))
    await vi.advanceTimersByTimeAsync(0)
    live.push({ items: [{ identifier: 'T1', value: 9 }] })
    await nextTick()
    expect(source.current?.value.value).toBeNull()
    wrapper.unmount()
  })

  it('取值失败时给出可读错误并清掉旧值', async () => {
    fakeChannel()
    vi.spyOn(opcuaApi, 'readNodeValue').mockRejectedValue(new Error('boom'))
    const { wrapper, source } = harness(ref<string | null>('n1'), ref('T1'))
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.error.value).toBeTruthy()
    expect(source.current?.value.value).toBeNull()
    wrapper.unmount()
  })
})
