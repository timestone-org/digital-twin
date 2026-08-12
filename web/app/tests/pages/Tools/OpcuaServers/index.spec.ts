/**
 * @fileoverview 实例列表页的行为契约。
 *
 * ⚠ 这一页能停掉现场正在被上位机读的服务器。最要紧的两条不是渲染对不对，
 * 而是：停止/重启**必须**先确认且文案说清会断开全部会话；
 * 以及「待重启生效」不能被吞掉——吞掉就等于告诉用户改动已经生效了。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { OpcuaInstance } from '@dt/contracts'

import * as opcuaApi from '@/api/opcua'
import OpcuaServersPage from '@/pages/Tools/OpcuaServers/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/tools/opcua-servers', query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
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
    certificate: { fingerprint: null, subject: null, expires_at: null },
    node_count: 3,
    session_count: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function signIn(permissions: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    role: { name: 'admin' },
    role_permissions: permissions,
    direct_permissions: [],
    permissions,
  } as never
  auth.accessToken = 'token'
}

async function render(rows: OpcuaInstance[]): Promise<VueWrapper> {
  vi.spyOn(opcuaApi, 'listInstances').mockResolvedValue({
    items: rows,
    page: 1,
    size: 20,
    total: rows.length,
  })
  // ⚠ vi.mock('vue-router') 换不掉全局组件解析，RouterLink 要在这里 stub，
  // 否则模板里那个链接根本不渲染，只在控制台留一行 warn
  const wrapper = mount(OpcuaServersPage, {
    global: {
      stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  confirmSpy.mockReset().mockResolvedValue(true)
  signIn(['opcua:view', 'opcua:operate', 'opcua:manage'])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('实例列表', () => {
  it('列出名称、端点与端口', async () => {
    const text = (await render([instance()])).text()
    expect(text).toContain('plant')
    expect(text).toContain('opc.tcp://host:4840/digitaltwin')
    expect(text).toContain('4840')
  })

  it('运行中与已停止分别成一档', async () => {
    const stopped = (await render([instance()])).text()
    expect(stopped).toContain('已停止')
    const running = (
      await render([instance({ is_running: true, desired_state: 'running' })])
    ).text()
    expect(running).toContain('运行中')
  })

  it('⚠ 意图与实况不符时不许显示成运行中', async () => {
    // 按了启动但端口没起来：显示「未就绪」，不能安静地按意图说「运行中」
    const text = (
      await render([instance({ is_running: false, desired_state: 'running' })])
    ).text()
    expect(text).toContain('未就绪')
    expect(text).not.toContain('运行中')
  })

  it('待重启生效要既在行上标记、也在页顶汇总', async () => {
    const text = (
      await render([
        instance({
          has_pending_restart: true,
          pending_fields: ['security_policies'],
        }),
      ])
    ).text()
    expect(text).toContain('待重启生效')
    expect(text).toContain('未生效的改动')
  })

  it('没有待生效改动时不出那条提示', async () => {
    expect((await render([instance()])).text()).not.toContain('未生效的改动')
  })

  it('自启的实例有标记', async () => {
    const text = (await render([instance({ is_autostart: true })])).text()
    expect(text).toContain('自启')
  })

  it('空列表给空态而不是空白', async () => {
    expect((await render([])).text()).toContain('共 0 个实例')
  })
})

describe('起停', () => {
  it('启动不打断任何人，所以不弹确认', async () => {
    const act = vi
      .spyOn(opcuaApi, 'actOnInstance')
      .mockResolvedValue({} as never)
    const wrapper = await render([instance()])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '启动')
      ?.trigger('click')
    await flushPromises()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(act).toHaveBeenCalledWith('i1', 'start')
  })

  it('⚠ 停止必须先确认，且文案报出会被断开的会话数', async () => {
    const act = vi
      .spyOn(opcuaApi, 'actOnInstance')
      .mockResolvedValue({} as never)
    const wrapper = await render([
      instance({
        is_running: true,
        desired_state: 'running',
        session_count: 7,
      }),
    ])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '停止')
      ?.trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const asked = confirmSpy.mock.calls[0]?.[0]
    expect(asked?.message).toContain('7')
    expect(asked?.message).toContain('断开')
    expect(act).toHaveBeenCalledWith('i1', 'stop')
  })

  it('确认被取消时什么都不做', async () => {
    confirmSpy.mockResolvedValue(false)
    const act = vi
      .spyOn(opcuaApi, 'actOnInstance')
      .mockResolvedValue({} as never)
    const wrapper = await render([
      instance({ is_running: true, desired_state: 'running' }),
    ])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '停止')
      ?.trigger('click')
    await flushPromises()
    expect(act).not.toHaveBeenCalled()
  })
})

describe('删除', () => {
  it('确认文案说清会连带删掉节点与凭据、端口退回池中', async () => {
    vi.spyOn(opcuaApi, 'deleteInstance').mockResolvedValue()
    const wrapper = await render([instance({ node_count: 12 })])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除')
      ?.trigger('click')
    await flushPromises()
    const asked = confirmSpy.mock.calls[0]?.[0]
    expect(asked?.message).toContain('12')
    expect(asked?.message).toContain('端口')
  })
})

describe('闸 3 只决定看不看得见', () => {
  it('只有 view 时不出新建、编辑、删除与起停', async () => {
    signIn(['opcua:view'])
    const wrapper = await render([instance()])
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).not.toContain('新建实例')
    expect(labels).not.toContain('编辑')
    expect(labels).not.toContain('删除')
    expect(labels).not.toContain('启动')
  })

  it('有 operate 能起停但改不了配置', async () => {
    signIn(['opcua:view', 'opcua:operate'])
    const wrapper = await render([instance()])
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toContain('启动')
    expect(labels).not.toContain('编辑')
  })
})
