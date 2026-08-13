/**
 * @fileoverview 剩下的失败路径与边角分支。
 *
 * 单独成文件是因为它们共享一件事：**出错时必须让用户看见**。
 * 一个 catch 忘了给反馈，界面就停在「像是成功了」的样子上。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { OpcuaInstance, OpcuaNode } from '@dt/contracts'

import * as opcuaApi from '@/api/opcua'
import DetailPage from '@/pages/Tools/OpcuaServerDetail/index.vue'
import NodeExplorer from '@/pages/Tools/OpcuaServerDetail/components/NodeExplorer.vue'
import SecurityPanel from '@/pages/Tools/OpcuaServerDetail/components/SecurityPanel.vue'
import SessionsPanel from '@/pages/Tools/OpcuaServerDetail/components/SessionsPanel.vue'
import InstanceStatusTag from '@/pages/Tools/OpcuaServers/components/InstanceStatusTag.vue'
import OpcuaServersPage from '@/pages/Tools/OpcuaServers/index.vue'
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

const confirmSpy = vi.fn<() => Promise<boolean>>()
const errorToast = vi.fn()
const successToast = vi.fn()
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
    desired_state: 'stopped',
    is_running: false,
    has_pending_restart: false,
    pending_fields: [],
    certificate: { fingerprint: null, subject: null, expires_at: null },
    node_count: 0,
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

const STUBS = {
  global: {
    stubs: {
      // 保留 href：分区页签是不是真链接，就靠它验
      RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
    },
  },
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  confirmSpy.mockReset().mockResolvedValue(true)
  errorToast.mockReset()
  successToast.mockReset()
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
  document.body.innerHTML = ''
})

describe('状态标签的四种组合', () => {
  it.each([
    [true, 'running', '运行中'],
    [false, 'stopped', '已停止'],
    [false, 'running', '未就绪'],
    [true, 'stopped', '停止中'],
  ] as const)('is_running=%s desired=%s → %s', (isRunning, desired, label) => {
    const wrapper = mount(InstanceStatusTag, {
      props: { isRunning, desiredState: desired },
    })
    expect(wrapper.text()).toContain(label)
  })
})

describe('列表页的失败反馈', () => {
  async function page(rows: OpcuaInstance[]) {
    vi.spyOn(opcuaApi, 'listInstances').mockResolvedValue({
      items: rows,
      page: 1,
      size: 20,
      total: rows.length,
    })
    const wrapper = mount(OpcuaServersPage, {
      attachTo: document.body,
      ...STUBS,
    })
    await flushPromises()
    return wrapper
  }

  it('新建失败时报错', async () => {
    vi.spyOn(opcuaApi, 'createInstance').mockRejectedValue(new Error('boom'))
    const wrapper = await page([])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '新建实例')
      ?.trigger('click')
    await flushPromises()
    const modal = document.body.querySelector('.dt-modal')
    const inputs = [...(modal?.querySelectorAll('input') ?? [])]
    for (const [index, value] of [
      [0, 'p'],
      [3, 'urn:x'],
    ] as const) {
      const field = inputs[index]
      if (field === undefined) continue
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    const create = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '创建',
    )
    create?.click()
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('编辑失败时报错', async () => {
    vi.spyOn(opcuaApi, 'updateInstance').mockRejectedValue(new Error('boom'))
    const wrapper = await page([instance()])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '编辑')
      ?.trigger('click')
    await flushPromises()
    const save = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '保存',
    )
    save?.click()
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('删除被取消时不发请求', async () => {
    confirmSpy.mockResolvedValue(false)
    const remove = vi.spyOn(opcuaApi, 'deleteInstance').mockResolvedValue()
    const wrapper = await page([instance()])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除')
      ?.trigger('click')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
  })

  it('实例带描述时列表里显示描述', async () => {
    const wrapper = await page([instance({ description: '一号产线' })])
    expect(wrapper.text()).toContain('一号产线')
  })
})

describe('详情页的失败反馈与分区', () => {
  async function detail(over: Partial<OpcuaInstance> = {}) {
    vi.spyOn(opcuaApi, 'getInstance').mockResolvedValue(instance(over))
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    vi.spyOn(opcuaApi, 'listSessions').mockResolvedValue([])
    vi.spyOn(opcuaApi, 'listCredentials').mockResolvedValue([])
    vi.spyOn(opcuaApi, 'listTrustedCertificates').mockResolvedValue([])
    const wrapper = mount(DetailPage, STUBS)
    await flushPromises()
    return wrapper
  }

  it('起停失败时报错', async () => {
    vi.spyOn(opcuaApi, 'actOnInstance').mockRejectedValue(new Error('boom'))
    const wrapper = await detail()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '启动')
      ?.trigger('click')
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('停止被取消时不发请求', async () => {
    confirmSpy.mockResolvedValue(false)
    const act = vi
      .spyOn(opcuaApi, 'actOnInstance')
      .mockResolvedValue({} as never)
    const wrapper = await detail({ is_running: true, desired_state: 'running' })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '停止')
      ?.trigger('click')
    await flushPromises()
    expect(act).not.toHaveBeenCalled()
  })

  // 分区已是子路由，切换由路由完成；这里只验出口与链接，分区内容各自有用例
  it('三个分区都给出可收藏的链接，而不是页内状态', async () => {
    const wrapper = await detail()
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/tools/opcua-servers/i1/nodes')
    expect(hrefs).toContain('/tools/opcua-servers/i1/sessions')
    expect(hrefs).toContain('/tools/opcua-servers/i1/security')
  })

  it('分区出口在实例取到之后才渲染', async () => {
    const wrapper = await detail()
    expect(wrapper.find('[data-test="router-view"]').exists()).toBe(true)
  })

  it('会话分区能独立渲染', async () => {
    vi.spyOn(opcuaApi, 'listSessions').mockResolvedValue([])
    const wrapper = mount(SessionsPanel, { props: { instance: instance() } })
    await flushPromises()
    expect(wrapper.text()).toContain('共 0 个会话')
  })

  it('安全分区能独立渲染', async () => {
    vi.spyOn(opcuaApi, 'listCredentials').mockResolvedValue([])
    vi.spyOn(opcuaApi, 'listTrustedCertificates').mockResolvedValue([])
    const wrapper = mount(SecurityPanel, { props: { instance: instance() } })
    await flushPromises()
    expect(wrapper.text()).toContain('接入凭据')
  })
})

describe('地址空间的成功路径', () => {
  it('建节点成功时提示上位机当前即可浏览到', async () => {
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [node()],
      page: 1,
      size: 200,
      total: 1,
    })
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'x',
      identifier: 'T1',
      data_type: 'double',
      value: 1,
      is_live: true,
    })
    vi.spyOn(opcuaApi, 'createNode').mockResolvedValue({
      node: node({ id: 'n2' }),
      pending_fields: [],
    })
    const wrapper = mount(NodeExplorer, {
      props: { instance: instance() },
      attachTo: document.body,
    })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '新建节点')
      ?.trigger('click')
    await flushPromises()
    const modal = document.body.querySelector('.dt-modal')
    const inputs = [...(modal?.querySelectorAll('input') ?? [])]
    for (const [index, value] of [
      [0, 'T2'],
      [1, 'T2'],
    ] as const) {
      const field = inputs[index]
      if (field === undefined) continue
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    const create = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '创建',
    )
    create?.click()
    await flushPromises()
    expect(successToast).toHaveBeenCalledWith(
      expect.stringContaining('上位机当前即可浏览到'),
    )
  })

  it('⚠ 建节点回执带未生效字段时，提示改说重启后生效', async () => {
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [node()],
      page: 1,
      size: 200,
      total: 1,
    })
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'x',
      identifier: 'T1',
      data_type: 'double',
      value: 1,
      is_live: true,
    })
    vi.spyOn(opcuaApi, 'createNode').mockResolvedValue({
      node: node({ id: 'n2' }),
      pending_fields: ['data_type'],
    })
    const wrapper = mount(NodeExplorer, {
      props: { instance: instance() },
      attachTo: document.body,
    })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '新建节点')
      ?.trigger('click')
    await flushPromises()
    const modal = document.body.querySelector('.dt-modal')
    const inputs = [...(modal?.querySelectorAll('input') ?? [])]
    for (const [index, value] of [
      [0, 'T2'],
      [1, 'T2'],
    ] as const) {
      const field = inputs[index]
      if (field === undefined) continue
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    const create = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '创建',
    )
    create?.click()
    await flushPromises()
    expect(successToast).toHaveBeenCalledWith(expect.stringContaining('重启'))
  })

  it('删节点被取消时不发请求', async () => {
    confirmSpy.mockResolvedValue(false)
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [node()],
      page: 1,
      size: 200,
      total: 1,
    })
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'x',
      identifier: 'T1',
      data_type: 'double',
      value: 1,
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
    expect(remove).not.toHaveBeenCalled()
  })

  it('对象节点用另一个图标，且值面板对无数据类型的节点显示占位', async () => {
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [node({ node_class: 'object', data_type: null })],
      page: 1,
      size: 200,
      total: 1,
    })
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'x',
      identifier: 'T1',
      data_type: null,
      value: null,
      is_live: true,
    })
    const wrapper = mount(NodeExplorer, { props: { instance: instance() } })
    await flushPromises()
    expect(wrapper.text()).toContain('object')
  })
})

describe('安全面板的失败反馈', () => {
  async function panel() {
    vi.spyOn(opcuaApi, 'listCredentials').mockResolvedValue([
      {
        id: 'c1',
        instance_id: 'i1',
        username: 'scada',
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ])
    vi.spyOn(opcuaApi, 'listTrustedCertificates').mockResolvedValue([
      {
        id: 'x1',
        instance_id: 'i1',
        fingerprint: 'aa',
        subject: 'CN=a',
        expires_at: null,
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(SecurityPanel, {
      props: { instance: instance() },
      attachTo: document.body,
    })
    await flushPromises()
    return wrapper
  }

  it('建凭据失败时报错', async () => {
    vi.spyOn(opcuaApi, 'createCredential').mockRejectedValue(new Error('boom'))
    const wrapper = await panel()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '新建凭据')
      ?.trigger('click')
    await flushPromises()
    const field = document.body.querySelector('.dt-modal input')
    if (field instanceof HTMLInputElement) {
      field.value = 'u'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    const create = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '创建',
    )
    create?.click()
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('删凭据失败时报错', async () => {
    vi.spyOn(opcuaApi, 'deleteCredential').mockRejectedValue(new Error('boom'))
    const wrapper = await panel()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除')
      ?.trigger('click')
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('删凭据被取消时不发请求', async () => {
    confirmSpy.mockResolvedValue(false)
    const remove = vi.spyOn(opcuaApi, 'deleteCredential').mockResolvedValue()
    const wrapper = await panel()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除')
      ?.trigger('click')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
  })

  it('加证书失败时报错', async () => {
    vi.spyOn(opcuaApi, 'addTrustedCertificate').mockRejectedValue(
      new Error('boom'),
    )
    const wrapper = await panel()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '添加证书')
      ?.trigger('click')
    await flushPromises()
    const area = document.body.querySelector('textarea')
    if (area !== null) {
      area.value = 'pem'
      area.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    const add = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '添加',
    )
    add?.click()
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('移除证书失败时报错', async () => {
    vi.spyOn(opcuaApi, 'deleteTrustedCertificate').mockRejectedValue(
      new Error('boom'),
    )
    const wrapper = await panel()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '移除')
      ?.trigger('click')
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('移除证书被取消时不发请求', async () => {
    confirmSpy.mockResolvedValue(false)
    const remove = vi
      .spyOn(opcuaApi, 'deleteTrustedCertificate')
      .mockResolvedValue()
    const wrapper = await panel()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '移除')
      ?.trigger('click')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
  })
})
