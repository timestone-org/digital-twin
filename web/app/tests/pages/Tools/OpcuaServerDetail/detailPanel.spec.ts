/**
 * @fileoverview 选中节点那一栏。
 *
 * 三条语义必须**照实说**，不许美化：
 * 1. 实例没跑时显示的是库里的初值，不是现场值；
 * 2. 节点值不落库，重启回到初值——这是定义好的语义，不是「数据丢了」；
 * 3. 写值立刻改变上位系统读到的东西。
 * 把哪一条说圆了，现场就会有人按错误的前提做判断。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { OpcuaNode } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as opcuaApi from '@/api/opcua'
import NodeDetailPanel from '@/pages/Tools/OpcuaServerDetail/components/NodeDetailPanel.vue'
import { useAuthStore } from '@/stores/auth'
import type * as RealtimeChannel from '@/composables/useRealtimeChannel'

// ⚠ 通道必须打桩：不桩的话挂载就真的开一条 WebSocket，它排下的重连定时器
// 会在测试环境拆掉之后到点，整轮 vitest 因此报一条未处理异常（见 testing/realtimeChannel）
vi.mock('@/composables/useRealtimeChannel', async () => {
  const actual = await vi.importActual<typeof RealtimeChannel>(
    '@/composables/useRealtimeChannel',
  )
  const { fakeRealtimeChannel } = await import('@/testing/realtimeChannel')
  const channel = fakeRealtimeChannel()
  return { ...actual, useRealtimeChannel: () => channel }
})

interface ConfirmAsk {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}
const confirmSpy = vi.fn<(request: ConfirmAsk) => Promise<boolean>>()
const successToast = vi.fn()
const errorToast = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({
      success: successToast,
      error: errorToast,
      info: vi.fn(),
    }),
  }
})

const copySpy = vi.fn<(text: string) => Promise<boolean>>()
vi.mock('@/utils/clipboard', () => ({
  copyText: (text: string) => copySpy(text),
}))

function node(over: Partial<OpcuaNode> = {}): OpcuaNode {
  return {
    id: 'n1',
    instance_id: 'i1',
    parent_id: null,
    node_class: 'variable',
    identifier: 'T1',
    identifier_kind: 'string',
    node_id: 'ns=2;s=T1',
    browse_name: 'Temperature',
    data_type: 'double',
    value_rank: -1,
    array_dimensions: null,
    access_level: 3,
    initial_value: null,
    description: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

async function panel(
  over: Partial<OpcuaNode> = {},
  live: Partial<{ value: unknown; is_live: boolean }> = {},
) {
  vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
    node_id: 'ns=2;s=T1',
    identifier: 'T1',
    data_type: 'double',
    value: live.value ?? 21.5,
    is_live: live.is_live ?? true,
  })
  const wrapper = mount(NodeDetailPanel, {
    props: { instanceId: 'i1', node: node(over), parentName: null },
  })
  await flushPromises()
  return wrapper
}

function button(
  wrapper: Awaited<ReturnType<typeof panel>>,
  text: string,
): ReturnType<typeof wrapper.findAll>[number] | undefined {
  return wrapper.findAll('button').find((item) => item.text() === text)
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  confirmSpy.mockReset().mockResolvedValue(true)
  copySpy.mockReset().mockResolvedValue(true)
  successToast.mockReset()
  errorToast.mockReset()
  const codes = ['opcua:view', 'opcua:operate', 'opcua:manage']
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    role: { name: 'admin' },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  } as never
  auth.accessToken = 'token'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('先看值', () => {
  it('当前值摆在最上面，且是取回来的实时值', async () => {
    expect((await panel()).text()).toContain('21.5')
  })

  it('⚠ 实例没跑时说清这是库里的初值，且节点值不落库', async () => {
    const text = (await panel({}, { is_live: false })).text()
    expect(text).toContain('实例未运行')
    expect(text).toContain('库里的初值')
    expect(text).toContain('重启后回到初值')
  })

  it('实例在跑时不出那条提示', async () => {
    expect((await panel()).text()).not.toContain('库里的初值')
  })

  it('取值失败时把后端的话原样摆在值的位置，而不是显示一个假的「—」', async () => {
    vi.spyOn(opcuaApi, 'readNodeValue').mockRejectedValue(
      new BizError(42101, '实例未运行', 409, 'trace-1'),
    )
    const wrapper = mount(NodeDetailPanel, {
      props: { instanceId: 'i1', node: node(), parentName: null },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('实例未运行')
  })

  it('手动刷新立刻再取一次，不用等下一个轮询周期', async () => {
    const wrapper = await panel()
    const read = vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'ns=2;s=T1',
      identifier: 'T1',
      data_type: 'double',
      value: 22,
      is_live: true,
    })
    await button(wrapper, '刷新')?.trigger('click')
    await flushPromises()
    expect(read).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('22')
  })
})

describe('NodeId 一键可取', () => {
  it('复制的是完整 NodeId——上位机组态里要粘的就是这一段', async () => {
    const wrapper = await panel()
    await wrapper.find('button[aria-label="复制 NodeId"]').trigger('click')
    await flushPromises()
    expect(copySpy).toHaveBeenCalledWith('ns=2;s=T1')
    expect(successToast).toHaveBeenCalledWith('NodeId 已复制')
  })

  it('复制不了时告诉人手动选中，而不是假装成功了', async () => {
    copySpy.mockResolvedValue(false)
    const wrapper = await panel()
    await wrapper.find('button[aria-label="复制 NodeId"]').trigger('click')
    await flushPromises()
    expect(errorToast).toHaveBeenCalledWith(expect.stringContaining('手动选中'))
  })
})

describe('写值', () => {
  it('⚠ 写之前必须确认，并把「上位机下一次采样就会拿到新值」说出来', async () => {
    const write = vi
      .spyOn(opcuaApi, 'writeNodeValue')
      .mockResolvedValue({ node_id: 'x', identifier: 'T1', value: null })
    const wrapper = await panel()
    await wrapper.find('input[aria-label="要写入的值"]').setValue('30')
    await button(wrapper, '写入')?.trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0]?.[0]?.message).toContain('30')
    expect(confirmSpy.mock.calls[0]?.[0]?.message).toContain('上位机')
    expect(write).toHaveBeenCalledWith('i1', 'n1', 30)
  })

  it('确认框里被取消时不写', async () => {
    confirmSpy.mockResolvedValue(false)
    const write = vi
      .spyOn(opcuaApi, 'writeNodeValue')
      .mockResolvedValue({ node_id: 'x', identifier: 'T1', value: null })
    const wrapper = await panel()
    await wrapper.find('input[aria-label="要写入的值"]').setValue('30')
    await button(wrapper, '写入')?.trigger('click')
    await flushPromises()
    expect(write).not.toHaveBeenCalled()
  })

  it('写完立刻重取一次，让人当场确认上位机读到的是新值', async () => {
    vi.spyOn(opcuaApi, 'writeNodeValue').mockResolvedValue({
      node_id: 'x',
      identifier: 'T1',
      value: null,
    })
    const wrapper = await panel()
    const read = vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'ns=2;s=T1',
      identifier: 'T1',
      data_type: 'double',
      value: 30,
      is_live: true,
    })
    await wrapper.find('input[aria-label="要写入的值"]').setValue('30')
    await button(wrapper, '写入')?.trigger('click')
    await flushPromises()
    expect(read).toHaveBeenCalled()
    expect(wrapper.text()).toContain('30')
  })

  it('⚠ 写值区旁边写明会立刻改变上位系统读到的现场数据', async () => {
    expect((await panel()).text()).toContain('写值会立刻改变上位系统读到的')
  })

  it('⚠ 访问级别不含可写时整个写值区不出现，并说明原因', async () => {
    const wrapper = await panel({ access_level: 1 })
    expect(wrapper.find('input[aria-label="要写入的值"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('不含「可写」')
  })

  it('对象节点没有值可写，也不提「不可写」这种无关的话', async () => {
    const wrapper = await panel({ node_class: 'object', access_level: 0 })
    expect(wrapper.find('input[aria-label="要写入的值"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('不含「可写」')
  })

  it('⚠ 换节点时清掉上一个节点的草稿，A 的输入不许被写进 B', async () => {
    const write = vi
      .spyOn(opcuaApi, 'writeNodeValue')
      .mockResolvedValue({ node_id: 'x', identifier: 'T1', value: null })
    const wrapper = await panel()
    await wrapper.find('input[aria-label="要写入的值"]').setValue('30')
    await wrapper.setProps({ node: node({ id: 'n2', browse_name: 'Other' }) })
    await flushPromises()
    expect(
      (
        wrapper.find('input[aria-label="要写入的值"]')
          .element as HTMLInputElement
      ).value,
    ).toBe('')
    await button(wrapper, '写入')?.trigger('click')
    await flushPromises()
    expect(write).not.toHaveBeenCalled()
  })

  it('⚠ 空输入不许下发——数值类型下那会静默变成一次「写 0」', async () => {
    const write = vi
      .spyOn(opcuaApi, 'writeNodeValue')
      .mockResolvedValue({ node_id: 'x', identifier: 'T1', value: null })
    const wrapper = await panel()
    expect(button(wrapper, '写入')?.attributes('disabled')).toBeDefined()
    await button(wrapper, '写入')?.trigger('click')
    await flushPromises()
    expect(write).not.toHaveBeenCalled()
  })

  it('⚠ 写 0 本身是合法的，不能被「空值防线」一起挡掉', async () => {
    const write = vi
      .spyOn(opcuaApi, 'writeNodeValue')
      .mockResolvedValue({ node_id: 'x', identifier: 'T1', value: null })
    const wrapper = await panel()
    await wrapper.find('input[aria-label="要写入的值"]').setValue('0')
    await button(wrapper, '写入')?.trigger('click')
    await flushPromises()
    expect(write).toHaveBeenCalledWith('i1', 'n1', 0)
  })

  it('写值失败时把后端的话原样报出来', async () => {
    vi.spyOn(opcuaApi, 'writeNodeValue').mockRejectedValue(
      new BizError(42111, '该节点不可写', 409, 'trace-2'),
    )
    const wrapper = await panel()
    await wrapper.find('input[aria-label="要写入的值"]').setValue('1')
    await button(wrapper, '写入')?.trigger('click')
    await flushPromises()
    expect(errorToast).toHaveBeenCalledWith('该节点不可写')
  })
})

describe('元数据', () => {
  it('把裸编码翻成人话，而不是把 3 和 -1 直接摆出来', async () => {
    const text = (await panel()).text()
    expect(text).toContain('可读 · 可写')
    expect(text).toContain('标量')
  })

  it('父节点名字给出来；根节点如实说是根', async () => {
    expect((await panel()).text()).toContain('（根）')
  })

  it('有父节点时显示父的 BrowseName', async () => {
    const wrapper = mount(NodeDetailPanel, {
      props: { instanceId: 'i1', node: node(), parentName: 'Line1' },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Line1')
  })

  it('数组维长与初值都摆出来', async () => {
    const wrapper = await panel({
      value_rank: 1,
      array_dimensions: [3, 4],
      initial_value: 7,
    })
    expect(wrapper.text()).toContain('3 × 4')
    expect(wrapper.text()).toContain('一维数组')
  })

  it('对象节点不摆值维度这些与它无关的字段', async () => {
    const wrapper = await panel({ node_class: 'object', data_type: null })
    expect(wrapper.text()).not.toContain('值维度')
  })

  it('有描述就显示描述', async () => {
    expect((await panel({ description: '一号线出口温度' })).text()).toContain(
      '一号线出口温度',
    )
  })
})

describe('删除', () => {
  it('删除按钮把节点原样交回上层去确认，自己不发请求', async () => {
    const wrapper = await panel()
    await button(wrapper, '删除节点')?.trigger('click')
    expect(wrapper.emitted('remove')?.[0]?.[0]).toMatchObject({ id: 'n1' })
  })
})
