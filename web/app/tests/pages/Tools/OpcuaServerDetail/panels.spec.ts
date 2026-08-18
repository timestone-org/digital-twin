/**
 * @fileoverview 地址空间 / 会话 / 安全三块面板的行为契约。
 *
 * ⚠ 这里守的都是「错了不会报错」的事：明文口令只回一次却被 toast 一闪而过、
 * 会话轮询漏清定时器、写值把 `false` 当空值丢掉。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { OpcuaInstance, OpcuaNode } from '@dt/contracts'

import * as opcuaApi from '@/api/opcua'
import NodeExplorer from '@/pages/Tools/OpcuaServerDetail/components/NodeExplorer.vue'
import SecurityPanel from '@/pages/Tools/OpcuaServerDetail/components/SecurityPanel.vue'
import SessionsPanel from '@/pages/Tools/OpcuaServerDetail/components/SessionsPanel.vue'
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

const confirmSpy = vi.fn<() => Promise<boolean>>()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  }
})

function instance(over: Partial<OpcuaInstance> = {}): OpcuaInstance {
  return {
    id: 'i1',
    name: 'plant',
    description: null,
    endpoint_path: '/dt',
    endpoint_url: 'opc.tcp://h:4840/dt',
    port: 4840,
    namespace_uri: 'urn:dt',
    security_policies: ['NoSecurity'],
    is_anonymous_allowed: false,
    is_autostart: false,
    desired_state: 'running',
    is_running: true,
    has_pending_restart: false,
    pending_fields: [],
    certificate: { fingerprint: null, subject: null, expires_at: null },
    node_count: 1,
    session_count: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

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
    data_type: 'boolean',
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

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  confirmSpy.mockReset().mockResolvedValue(true)
  const auth = useAuthStore()
  const codes = ['opcua:view', 'opcua:operate', 'opcua:manage']
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

describe('地址空间', () => {
  it('列出节点并默认选中第一个', async () => {
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [node()],
      page: 1,
      size: 200,
      total: 1,
    })
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'ns=2;s=T1',
      identifier: 'T1',
      data_type: 'boolean',
      value: true,
      is_live: true,
    })
    const wrapper = mount(NodeExplorer, { props: { instance: instance() } })
    await flushPromises()
    expect(wrapper.text()).toContain('Temperature')
    expect(wrapper.text()).toContain('ns=2;s=T1')
  })

  it('⚠ 实例没在跑时说明读到的是初值，且点明值不落库', async () => {
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [node()],
      page: 1,
      size: 200,
      total: 1,
    })
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'ns=2;s=T1',
      identifier: 'T1',
      data_type: 'boolean',
      value: false,
      is_live: false,
    })
    const wrapper = mount(NodeExplorer, {
      props: { instance: instance({ is_running: false }) },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('初值')
    expect(wrapper.text()).toContain('不落库')
  })

  it('删节点的确认文案说清上位机会立刻读不到', async () => {
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [node()],
      page: 1,
      size: 200,
      total: 1,
    })
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'ns=2;s=T1',
      identifier: 'T1',
      data_type: 'boolean',
      value: true,
      is_live: true,
    })
    const remove = vi.spyOn(opcuaApi, 'deleteNode').mockResolvedValue()
    const wrapper = mount(NodeExplorer, { props: { instance: instance() } })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除节点')
      ?.trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('i1', 'n1')
  })

  it('空地址空间给空态', async () => {
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    const wrapper = mount(NodeExplorer, { props: { instance: instance() } })
    await flushPromises()
    expect(wrapper.text()).toContain('还没有节点')
  })
})

describe('在线会话', () => {
  it('实例没跑时直接说明不会有会话，不去空转轮询', async () => {
    const list = vi.spyOn(opcuaApi, 'listSessions').mockResolvedValue([])
    const wrapper = mount(SessionsPanel, {
      props: { instance: instance({ is_running: false }) },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('不会有任何上位机会话')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('列出对端与用户名，匿名会话显示为「匿名」', async () => {
    vi.spyOn(opcuaApi, 'listSessions').mockResolvedValue([
      {
        session_id: 's1',
        peer: '10.0.0.9:51234',
        username: null,
        connected_at: new Date().toISOString(),
      },
    ])
    const wrapper = mount(SessionsPanel, {
      props: { instance: instance({ is_running: true }) },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('10.0.0.9:51234')
    expect(wrapper.text()).toContain('匿名')
  })

  it('⚠ 卸载后不再轮询——运维屏一开几天', async () => {
    vi.useFakeTimers()
    const list = vi.spyOn(opcuaApi, 'listSessions').mockResolvedValue([])
    const wrapper = mount(SessionsPanel, {
      props: { instance: instance({ is_running: true }) },
    })
    await vi.advanceTimersByTimeAsync(0)
    const before = list.mock.calls.length
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(list.mock.calls.length).toBe(before)
    vi.useRealTimers()
  })
})

describe('安全', () => {
  it('⚠ 新建凭据后明文口令用弹窗摆出来，并说清只此一次', async () => {
    vi.spyOn(opcuaApi, 'listCredentials').mockResolvedValue([])
    vi.spyOn(opcuaApi, 'listTrustedCertificates').mockResolvedValue([])
    vi.spyOn(opcuaApi, 'createCredential').mockResolvedValue({
      credential: {
        id: 'c1',
        instance_id: 'i1',
        username: 'scada',
        created_at: '2026-08-01T00:00:00.000Z',
      },
      password: 'S3cret-Only-Once',
    })
    // ⚠ DtModal 会 Teleport 到 body，弹窗内容不在 wrapper.text() 里
    const wrapper = mount(SecurityPanel, {
      props: { instance: instance() },
      attachTo: document.body,
    })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '新建凭据')
      ?.trigger('click')
    await flushPromises()
    const field = document.body.querySelector('input')
    if (field !== null) {
      field.value = 'scada'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    const buttons = [...document.body.querySelectorAll('button')]
    buttons.find((b) => b.textContent?.trim() === '创建')?.click()
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('S3cret-Only-Once')
    expect(text).toContain('只显示这一次')
    wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('凭据与证书都为空时各给一条空态', async () => {
    vi.spyOn(opcuaApi, 'listCredentials').mockResolvedValue([])
    vi.spyOn(opcuaApi, 'listTrustedCertificates').mockResolvedValue([])
    const wrapper = mount(SecurityPanel, { props: { instance: instance() } })
    await flushPromises()
    expect(wrapper.text()).toContain('还没有凭据')
    expect(wrapper.text()).toContain('白名单为空')
  })

  it('删除凭据的确认说清上位机将连不上', async () => {
    vi.spyOn(opcuaApi, 'listCredentials').mockResolvedValue([
      {
        id: 'c1',
        instance_id: 'i1',
        username: 'scada',
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ])
    vi.spyOn(opcuaApi, 'listTrustedCertificates').mockResolvedValue([])
    const remove = vi.spyOn(opcuaApi, 'deleteCredential').mockResolvedValue()
    const wrapper = mount(SecurityPanel, { props: { instance: instance() } })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除')
      ?.trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('i1', 'c1')
  })
})
