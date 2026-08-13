/**
 * @fileoverview 实例详情页的行为契约。
 *
 * ⚠ 最要紧的一条：`pending_fields` 必须**照实列出来**。吞掉它，用户会以为
 * 改动已经生效，而上位机读到的还是旧值——界面上一切正常，故障却在现场。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { OpcuaInstance } from '@dt/contracts'

import * as opcuaApi from '@/api/opcua'
import DetailPage from '@/pages/Tools/OpcuaServerDetail/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({
    path: '/tools/opcua-servers/i1',
    params: { instanceId: 'i1' },
    query: {},
  }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  // 分区是子路由，详情页只留一个出口；出口里放什么由各分区自己的用例去验
  RouterView: { template: '<div data-test="router-view" />' },
}))

interface ConfirmAsk {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}
const confirmSpy = vi.fn<(request: ConfirmAsk) => Promise<boolean>>()
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
    endpoint_path: '/digitaltwin',
    endpoint_url: 'opc.tcp://host:4840/digitaltwin',
    port: 4840,
    namespace_uri: 'urn:dt:plant',
    security_policies: ['Basic256Sha256_SignAndEncrypt'],
    is_anonymous_allowed: false,
    is_autostart: false,
    desired_state: 'stopped',
    is_running: false,
    has_pending_restart: false,
    pending_fields: [],
    certificate: {
      fingerprint: 'ab:cd',
      subject: 'CN=plant',
      expires_at: '2027-01-01T00:00:00.000Z',
    },
    node_count: 0,
    session_count: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

async function render(over: Partial<OpcuaInstance> = {}): Promise<VueWrapper> {
  vi.spyOn(opcuaApi, 'getInstance').mockResolvedValue(instance(over))
  vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
    items: [],
    page: 1,
    size: 200,
    total: 0,
  })
  const wrapper = mount(DetailPage, {
    global: {
      stubs: {
        // 保留 href：分区页签是不是真链接，就靠它验
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  confirmSpy.mockReset().mockResolvedValue(true)
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    role: { name: 'admin' },
    role_permissions: ['opcua:view', 'opcua:operate', 'opcua:manage'],
    direct_permissions: [],
    permissions: ['opcua:view', 'opcua:operate', 'opcua:manage'],
  } as never
  auth.accessToken = 'token'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('详情页', () => {
  it('铺出名称、端点与安全策略', async () => {
    const text = (await render()).text()
    expect(text).toContain('plant')
    expect(text).toContain('opc.tcp://host:4840/digitaltwin')
    expect(text).toContain('Basic256Sha256_SignAndEncrypt')
  })

  it('⚠ 未生效的字段逐个列出来，不许只说一句「有改动」', async () => {
    const text = (
      await render({
        has_pending_restart: true,
        pending_fields: ['security_policies', 'namespace_uri'],
      })
    ).text()
    expect(text).toContain('安全策略')
    expect(text).toContain('命名空间 URI')
    expect(text).toContain('重启')
  })

  it('没有未生效字段时不出那条提示', async () => {
    expect((await render()).text()).not.toContain('尚未生效')
  })

  it('允许匿名时明确标出来——那是个安全相关的取值', async () => {
    const text = (await render({ is_anonymous_allowed: true })).text()
    expect(text).toContain('允许匿名')
  })

  it('还没有证书时提示会自签，并说明私钥不入库', async () => {
    const text = (
      await render({
        certificate: { fingerprint: null, subject: null, expires_at: null },
      })
    ).text()
    expect(text).toContain('自签')
    expect(text).toContain('不入库')
  })
})

describe('起停', () => {
  it('停止先确认并报出会话数', async () => {
    const act = vi
      .spyOn(opcuaApi, 'actOnInstance')
      .mockResolvedValue({} as never)
    const wrapper = await render({
      is_running: true,
      desired_state: 'running',
      session_count: 4,
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '停止')
      ?.trigger('click')
    await flushPromises()
    expect(confirmSpy.mock.calls[0]?.[0]?.message).toContain('4')
    expect(act).toHaveBeenCalledWith('i1', 'stop')
  })

  it('重启同样要确认——它一样会断开全部会话', async () => {
    vi.spyOn(opcuaApi, 'actOnInstance').mockResolvedValue({} as never)
    const wrapper = await render({ is_running: true, desired_state: 'running' })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '重启')
      ?.trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0]?.[0]?.message).toContain('断开')
  })

  it('启动不弹确认', async () => {
    const act = vi
      .spyOn(opcuaApi, 'actOnInstance')
      .mockResolvedValue({} as never)
    const wrapper = await render()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '启动')
      ?.trigger('click')
    await flushPromises()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(act).toHaveBeenCalledWith('i1', 'start')
  })
})

describe('取实例失败', () => {
  it('给出错误与重试入口，而不是空白页', async () => {
    vi.spyOn(opcuaApi, 'getInstance').mockRejectedValue(new Error('boom'))
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    const wrapper = mount(DetailPage, {
      global: {
        stubs: {
          // 保留 href：分区页签是不是真链接，就靠它验
          RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('重试')
  })
})
