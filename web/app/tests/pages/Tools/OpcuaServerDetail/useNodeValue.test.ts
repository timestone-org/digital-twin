/**
 * @fileoverview 取值源的行为契约。
 *
 * 这个文件守的是三条**只有在现场才会暴露**的事：
 * 1. 卸载后定时器不许继续跑——运维屏一开几天，漏一个就持续累积并持续发请求。
 * 2. 换节点时慢的那次不许覆盖快的那次，否则显示的是上一个节点的值且不报错。
 * 3. 换节点的瞬间旧值必须先清掉，否则新节点还没回来时界面在说谎。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import type { Ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { OpcuaNodeValue } from '@dt/contracts'

import * as opcuaApi from '@/api/opcua'
import { useNodeValue } from '@/pages/Tools/OpcuaServerDetail/useNodeValue'

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

/** 把 composable 装进一个真实组件里，才能验证 onBeforeUnmount。 */
function harness(nodeId: Ref<string | null>) {
  const source: { current: ReturnType<typeof useNodeValue> | null } = {
    current: null,
  }
  const wrapper = mount(
    defineComponent({
      setup() {
        source.current = useNodeValue(ref('i1'), nodeId, 1000)
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
  it('节点为 null 时不发请求也不起定时器', async () => {
    const read = vi.spyOn(opcuaApi, 'readNodeValue')
    const { wrapper } = harness(ref<string | null>(null))
    await nextTick()
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('选中节点后立刻取一次，并按间隔继续取', async () => {
    const read = vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue(value())
    const { wrapper } = harness(ref<string | null>('n1'))
    await nextTick()
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(read).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('⚠ 卸载后定时器不许再触发', async () => {
    const read = vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue(value())
    const { wrapper } = harness(ref<string | null>('n1'))
    await nextTick()
    const before = read.mock.calls.length
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(read).toHaveBeenCalledTimes(before)
  })

  it('⚠ 换节点时先清空旧值，别让界面显示上一个节点的读数', async () => {
    // 第二次故意挂着不返回，才能观察到「已清空、新值未到」那个中间态
    vi.spyOn(opcuaApi, 'readNodeValue')
      .mockResolvedValueOnce(value({ identifier: 'OLD' }))
      .mockImplementation(() => new Promise<OpcuaNodeValue>(() => {}))
    const nodeId = ref<string | null>('n1')
    const { wrapper, source } = harness(nodeId)
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.value.value?.identifier).toBe('OLD')
    nodeId.value = 'n2'
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.value.value).toBeNull()
    wrapper.unmount()
  })

  it('⚠ 慢的那次不许覆盖快的那次', async () => {
    // 用一个容器持有 resolve：直接赋给局部变量时 TS 会把它窄化成 never
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
    const { wrapper, source } = harness(nodeId)
    await nextTick()
    nodeId.value = 'fast'
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.value.value?.identifier).toBe('FAST')

    // 迟到的第一次现在才回来，它必须被丢弃
    slow.resolve?.(value({ identifier: 'SLOW', value: 1 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.value.value?.identifier).toBe('FAST')
    wrapper.unmount()
  })

  it('取值失败时给出可读错误并清掉旧值', async () => {
    vi.spyOn(opcuaApi, 'readNodeValue').mockRejectedValue(new Error('boom'))
    const { wrapper, source } = harness(ref<string | null>('n1'))
    await vi.advanceTimersByTimeAsync(0)
    expect(source.current?.error.value).not.toBeNull()
    expect(source.current?.value.value).toBeNull()
    wrapper.unmount()
  })

  it('refresh 能在两次轮询之间手动取一次', async () => {
    const read = vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue(value())
    const { wrapper, source } = harness(ref<string | null>('n1'))
    await vi.advanceTimersByTimeAsync(0)
    const before = read.mock.calls.length
    await source.current?.refresh()
    expect(read.mock.calls.length).toBe(before + 1)
    wrapper.unmount()
  })
})
