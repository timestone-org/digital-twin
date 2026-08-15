/**
 * @fileoverview 点位绑定页签：懒加载、绑齐提示、保存与立刻下发一次。
 *
 * ⚠ 这一组同时是**模板契约测试**：Vue 模板里 prop 名、事件名与组件注册名
 * 写错时，typecheck 与 lint 双双放行（CLAUDE.md 的 TS 风格一节），只有把
 * 组件真挂起来才拦得住。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { AcModelPublication, ModelPublishResult } from '@dt/contracts'
import { useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import * as opcua from '@/api/opcua'
import DetailPage from '@/pages/Hvac/ModelDetail/index.vue'
import { useAuthStore } from '@/stores/auth'
import { STAMP, model, predictionPage } from '@/testing/modelFixtures'

const INSTANCE = 'inst-1'
const REGION = 'node-region'
const NODE_A = 'node-a'
const NODE_B = 'node-b'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({
    path: '/hvac/models/m1',
    params: { modelId: 'm1' },
    query: {},
  }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function signIn(): void {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    role: { id: 'r1', name: 'admin', description: null, is_builtin: true },
    role_permissions: ['ac:view', 'ac:manage'],
    direct_permissions: [],
    permissions: ['ac:view', 'ac:manage'],
  }
  auth.accessToken = 'token'
}

function instancePage() {
  return {
    items: [
      {
        id: INSTANCE,
        name: '卷包线仿真',
        description: null,
        endpoint_path: '/line-1',
        endpoint_url: 'opc.tcp://host:4840/line-1',
        port: 4840,
        namespace_uri: 'urn:test',
        security_policies: ['NoSecurity' as const],
        is_anonymous_allowed: true,
        is_autostart: false,
        desired_state: 'running' as const,
        is_running: true,
        has_pending_restart: false,
        pending_fields: [],
        certificate: { fingerprint: null, subject: null, expires_at: null },
        node_count: 3,
        session_count: 0,
        created_at: STAMP,
        updated_at: STAMP,
      },
    ],
    page: 1,
    size: 100,
    total: 1,
  }
}

function nodePage() {
  const base = {
    instance_id: INSTANCE,
    parent_id: null,
    node_class: 'variable' as const,
    identifier_kind: 'string' as const,
    value_rank: -1,
    array_dimensions: null,
    access_level: 3,
    initial_value: null,
    description: null,
    created_at: STAMP,
    updated_at: STAMP,
  }
  return {
    items: [
      {
        ...base,
        id: REGION,
        identifier: 'Recommend',
        node_id: 'ns=2;s=Recommend',
        browse_name: 'Recommend',
        data_type: 'string' as const,
      },
      {
        ...base,
        id: NODE_A,
        identifier: 'SetA',
        node_id: 'ns=2;s=SetA',
        browse_name: 'SetA',
        data_type: 'double' as const,
      },
      {
        ...base,
        id: NODE_B,
        identifier: 'SetB',
        node_id: 'ns=2;s=SetB',
        browse_name: 'SetB',
        data_type: 'float' as const,
      },
      // 只读的那个：选择器里一个都不许出现
      {
        ...base,
        id: 'node-ro',
        identifier: 'ReadOnly',
        node_id: 'ns=2;s=ReadOnly',
        browse_name: 'ReadOnly',
        data_type: 'double' as const,
        access_level: 1,
      },
    ],
    page: 1,
    size: 200,
    total: 4,
  }
}

function publication(
  over: Partial<AcModelPublication> = {},
): AcModelPublication {
  return {
    model_id: 'm1',
    opcua_instance_id: INSTANCE,
    recommendation_node_id: REGION,
    recommendation_identifier: 'Recommend',
    is_enabled: true,
    is_fully_bound: true,
    unbound_set_keys: [],
    set_bindings: [
      { set_key: 'K11', node_id: NODE_A, identifier: 'SetA', is_serving: true },
      {
        set_key: 'K11+K12',
        node_id: NODE_B,
        identifier: 'SetB',
        is_serving: true,
      },
    ],
    last_published_at: '2026-08-15T09:59:30.000Z',
    last_status: 'ok',
    last_error: null,
    ...over,
  }
}

function publishResult(): ModelPublishResult {
  return {
    model_id: 'm1',
    status: 'ok',
    published_at: '2026-08-15T10:00:00.000Z',
    written_count: 3,
    items: [
      {
        set_key: null,
        identifier: 'Recommend',
        value: 'K11+K12',
        is_written: true,
        error: null,
      },
      {
        set_key: 'K11',
        identifier: 'SetA',
        value: 12.4,
        is_written: true,
        error: null,
      },
      {
        set_key: 'K11+K12',
        identifier: 'SetB',
        value: 0,
        is_written: true,
        error: null,
      },
    ],
    error: null,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  signIn()
  document.body.innerHTML = ''
  useToast().clear()
  vi.spyOn(hvac, 'getAcModel').mockResolvedValue(model())
  vi.spyOn(hvac, 'listModelPredictions').mockResolvedValue(predictionPage([]))
  vi.spyOn(opcua, 'listInstances').mockResolvedValue(instancePage())
  vi.spyOn(opcua, 'listNodes').mockResolvedValue(nodePage())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function openTab() {
  const wrapper = mount(DetailPage, { attachTo: document.body })
  await flushPromises()
  const tab = wrapper
    .findAll('button')
    .find((node) => node.text() === '点位绑定')
  await tab?.trigger('click')
  await flushPromises()
  return wrapper
}

describe('点位绑定页签', () => {
  it('⚠ 不点进去就不打 opcua-server——页签是懒加载的', async () => {
    mount(DetailPage, { attachTo: document.body })
    await flushPromises()
    expect(opcua.listInstances).not.toHaveBeenCalled()
  })

  it('点进去才拉实例与已保存的配置', async () => {
    const read = vi
      .spyOn(hvac, 'getModelPublication')
      .mockResolvedValue(publication())
    await openTab()
    expect(opcua.listInstances).toHaveBeenCalled()
    expect(read).toHaveBeenCalledWith('m1')
  })

  it('绑齐时把「已绑几个」说出来', async () => {
    vi.spyOn(hvac, 'getModelPublication').mockResolvedValue(publication())
    const wrapper = await openTab()
    expect(wrapper.text()).toContain('2 个组合已绑 2 个')
    expect(wrapper.text()).not.toContain('绑齐之前不会自动下发')
  })

  it('⚠ 没绑齐必须明说「不会自动下发」，不能只在后端静默跳过', async () => {
    vi.spyOn(hvac, 'getModelPublication').mockResolvedValue(
      publication({
        is_fully_bound: false,
        unbound_set_keys: ['K11+K12'],
        set_bindings: [
          {
            set_key: 'K11',
            node_id: NODE_A,
            identifier: 'SetA',
            is_serving: true,
          },
        ],
      }),
    )
    const wrapper = await openTab()
    expect(wrapper.text()).toContain('2 个组合已绑 1 个')
    expect(wrapper.text()).toContain('绑齐之前不会自动下发')
  })

  it('还没配过时不报错，只是一份空表单', async () => {
    vi.spyOn(hvac, 'getModelPublication').mockRejectedValue(
      new Error('not found'),
    )
    const wrapper = await openTab()
    expect(wrapper.text()).toContain('还没有下发过')
    expect(wrapper.text()).not.toContain('not found')
  })

  it('上一拍失败时把原因摆出来', async () => {
    vi.spyOn(hvac, 'getModelPublication').mockResolvedValue(
      publication({
        last_status: 'failed',
        last_error: '2 个点位没写进去：SetA（节点已被删除）',
      }),
    )
    const wrapper = await openTab()
    expect(wrapper.text()).toContain('下发失败')
    expect(wrapper.text()).toContain('节点已被删除')
  })

  it('落空的绑定单列一段并标出来，不悄悄消失', async () => {
    vi.spyOn(hvac, 'getModelPublication').mockResolvedValue(
      publication({
        set_bindings: [
          {
            set_key: 'K99',
            node_id: 'gone',
            identifier: 'Old',
            is_serving: false,
          },
        ],
      }),
    )
    const wrapper = await openTab()
    expect(wrapper.text()).toContain('已落空的绑定')
    expect(wrapper.text()).toContain('K99')
  })

  it('实例没在跑时警告——下发会整条失败', async () => {
    const stopped = instancePage()
    stopped.items = stopped.items.map((item) => ({
      ...item,
      is_running: false,
    }))
    vi.spyOn(opcua, 'listInstances').mockResolvedValue(stopped)
    vi.spyOn(hvac, 'getModelPublication').mockResolvedValue(publication())
    const wrapper = await openTab()
    expect(wrapper.text()).toContain('这台实例没在运行')
  })

  it('立刻下发一次：逐点位摆出写进去的值', async () => {
    vi.spyOn(hvac, 'getModelPublication').mockResolvedValue(publication())
    const publish = vi
      .spyOn(hvac, 'publishModelNow')
      .mockResolvedValue(publishResult())
    const wrapper = await openTab()
    const button = wrapper
      .findAll('button')
      .find((node) => node.text() === '立刻下发一次')
    await button?.trigger('click')
    await flushPromises()
    expect(publish).toHaveBeenCalledWith('m1')
    expect(wrapper.text()).toContain('12.4')
    expect(wrapper.text()).toContain('区域推荐')
  })

  it('⚠ 结果区要讲清 -1 不是 0——0 是「多半一开机就达标」', async () => {
    vi.spyOn(hvac, 'getModelPublication').mockResolvedValue(publication())
    vi.spyOn(hvac, 'publishModelNow').mockResolvedValue(publishResult())
    const wrapper = await openTab()
    const button = wrapper
      .findAll('button')
      .find((node) => node.text() === '立刻下发一次')
    await button?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('-1')
    expect(wrapper.text()).toContain('一开机就达标')
  })

  it('没绑齐时按不了「立刻下发一次」', async () => {
    vi.spyOn(hvac, 'getModelPublication').mockResolvedValue(
      publication({ is_fully_bound: false }),
    )
    const wrapper = await openTab()
    const button = wrapper
      .findAll('button')
      .find((node) => node.text() === '立刻下发一次')
    expect(button?.attributes('disabled')).toBeDefined()
  })
})
