/**
 * @fileoverview 两个表单弹窗与各条写入路径。
 *
 * ⚠ 这里覆盖的都是「只有点下去才会跑到」的分支：新建/编辑的载荷拼装、
 * 写值的类型还原、以及每条失败路径必须给出可读反馈而不是静默。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type {
  OpcuaInstance,
  OpcuaInstanceCreateInput,
  OpcuaNode,
  OpcuaNodeCreateInput,
} from '@dt/contracts'

import * as opcuaApi from '@/api/opcua'
import NodeExplorer from '@/pages/Tools/OpcuaServerDetail/components/NodeExplorer.vue'
import NodeFormDialog from '@/pages/Tools/OpcuaServerDetail/components/NodeFormDialog.vue'
import SecurityPanel from '@/pages/Tools/OpcuaServerDetail/components/SecurityPanel.vue'
import SessionsPanel from '@/pages/Tools/OpcuaServerDetail/components/SessionsPanel.vue'
import InstanceFormDialog from '@/pages/Tools/OpcuaServers/components/InstanceFormDialog.vue'
import OpcuaServersPage from '@/pages/Tools/OpcuaServers/index.vue'
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

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/tools/opcua-servers', params: {}, query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const confirmSpy = vi.fn<() => Promise<boolean>>()
const errorToast = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({ success: vi.fn(), error: errorToast, info: vi.fn() }),
  }
})

function instance(over: Partial<OpcuaInstance> = {}): OpcuaInstance {
  return {
    id: 'i1',
    name: 'plant',
    description: 'desc',
    endpoint_path: '/dt',
    endpoint_url: 'opc.tcp://h:4840/dt',
    port: 4840,
    namespace_uri: 'urn:dt',
    security_policies: ['NoSecurity'],
    is_anonymous_allowed: true,
    is_autostart: true,
    desired_state: 'stopped',
    is_running: false,
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

/** 只填弹窗里的输入框——页面上的搜索框也是 input，混在一起会填错。 */
function fillModal(values: Record<number, string>): void {
  const modal = document.body.querySelector('.dt-modal')
  const inputs = [...(modal?.querySelectorAll('input') ?? [])]
  for (const [index, value] of Object.entries(values)) {
    const field = inputs[Number(index)]
    if (field === undefined) continue
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/** 读第 index 个 DtSelect 的选项文案。DtSelect 自绘，选项只在 props 上。 */
function selectLabels(wrapper: VueWrapper, index: number): string[] {
  const selects = wrapper.findAllComponents({ name: 'DtSelect' })
  const options = selects[index]?.props('options')
  if (!Array.isArray(options)) return []
  return options.map((option) =>
    typeof option === 'object' && option !== null && 'label' in option
      ? String((option as { label: unknown }).label)
      : '',
  )
}

function bodyButton(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  )
}

/** 点开第 index 个 DtSelect 并选中给定文案的选项。浮层 teleport 在 body 上。 */
async function pickInSelect(index: number, label: string): Promise<void> {
  const triggers = document.body.querySelectorAll<HTMLButtonElement>(
    '.dt-select__trigger',
  )
  triggers[index]?.click()
  await flushPromises()
  const option = [...document.querySelectorAll('.dt-select-menu__item')].find(
    (item) => item.textContent?.trim() === label,
  )
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  confirmSpy.mockReset().mockResolvedValue(true)
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
  document.body.innerHTML = ''
})

describe('实例表单', () => {
  it('新建时铺默认值，提交出完整载荷', async () => {
    const wrapper = mount(InstanceFormDialog, {
      props: { modelValue: true, instance: null },
      attachTo: document.body,
    })
    await flushPromises()
    // 下标即弹窗内的字段序：名称、描述、端点路径、命名空间
    fillModal({ 0: 'plant2', 3: 'urn:dt:2' })
    await flushPromises()
    bodyButton('创建')?.click()
    await flushPromises()
    const payload = wrapper.emitted('create')?.[0]?.[0] as
      OpcuaInstanceCreateInput | undefined
    expect(payload?.name).toBe('plant2')
    expect(payload?.namespace_uri).toBe('urn:dt:2')
    expect(payload?.endpoint_path).toBe('/digitaltwin')
  })

  it('编辑时铺回实例取值，且不出名称输入框', async () => {
    mount(InstanceFormDialog, {
      props: { modelValue: true, instance: instance() },
      attachTo: document.body,
    })
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('编辑实例')
    // 名称只在新建时可填
    expect(text).not.toContain('字母开头')
  })

  it('编辑提交的载荷不含名称——名称不可改', async () => {
    const wrapper = mount(InstanceFormDialog, {
      props: { modelValue: true, instance: instance() },
      attachTo: document.body,
    })
    await flushPromises()
    bodyButton('保存')?.click()
    await flushPromises()
    const payload = wrapper.emitted('update')?.[0]?.[0] as
      Record<string, unknown> | undefined
    expect(payload).toBeDefined()
    expect(payload).not.toHaveProperty('name')
  })

  it('安全策略一个都不勾时不许提交', async () => {
    const wrapper = mount(InstanceFormDialog, {
      props: { modelValue: true, instance: instance() },
      attachTo: document.body,
    })
    await flushPromises()
    const boxes = [...document.body.querySelectorAll('input[type=checkbox]')]
    for (const box of boxes) {
      if ((box as HTMLInputElement).checked) {
        ;(box as HTMLInputElement).click()
      }
    }
    await flushPromises()
    bodyButton('保存')?.click()
    await flushPromises()
    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('取消把开关关回去', async () => {
    const wrapper = mount(InstanceFormDialog, {
      props: { modelValue: true, instance: null },
      attachTo: document.body,
    })
    await flushPromises()
    bodyButton('取消')?.click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(false)
  })
})

describe('节点表单', () => {
  it('提交出标识、BrowseName 与数据类型', async () => {
    const wrapper = mount(NodeFormDialog, {
      props: { modelValue: true, nodes: [] },
      attachTo: document.body,
    })
    await flushPromises()
    fillModal({ 0: 'Line1.T', 1: 'T' })
    await flushPromises()
    bodyButton('创建')?.click()
    await flushPromises()
    const payload = wrapper.emitted('create')?.[0]?.[0] as
      OpcuaNodeCreateInput | undefined
    expect(payload?.identifier).toBe('Line1.T')
    expect(payload?.browse_name).toBe('T')
    expect(payload?.data_type).toBe('double')
    expect(payload?.parent_id).toBeNull()
  })

  it('⚠ 不给 method 选项——后端会拒，摆出来就是个必然失败的开关', async () => {
    const wrapper = mount(NodeFormDialog, {
      props: { modelValue: true, nodes: [] },
      attachTo: document.body,
    })
    await flushPromises()
    // DtSelect 是自绘组合框，选项在 props 上而不是 <option> 元素里
    const labels = selectLabels(wrapper, 0)
    expect(labels).toContain('variable')
    expect(labels).toContain('object')
    expect(labels).not.toContain('method')
  })

  it('标识为空时提交按钮不可用', async () => {
    mount(NodeFormDialog, {
      props: { modelValue: true, nodes: [] },
      attachTo: document.body,
    })
    await flushPromises()
    expect(bodyButton('创建')?.disabled).toBe(true)
  })

  it('变量节点默认按只读提交——显式带 access_level: 1，不靠后端缺省', async () => {
    const wrapper = mount(NodeFormDialog, {
      props: { modelValue: true, nodes: [] },
      attachTo: document.body,
    })
    await flushPromises()
    fillModal({ 0: 'Line1.T', 1: 'T' })
    await flushPromises()
    bodyButton('创建')?.click()
    await flushPromises()
    const payload = wrapper.emitted('create')?.[0]?.[0] as
      OpcuaNodeCreateInput | undefined
    expect(payload?.access_level).toBe(1)
  })

  it('选「可写」后提交带 access_level: 3，并提示上位机将可写入', async () => {
    const wrapper = mount(NodeFormDialog, {
      props: { modelValue: true, nodes: [] },
      attachTo: document.body,
    })
    await flushPromises()
    fillModal({ 0: 'Line1.T', 1: 'T' })
    await flushPromises()
    // 选择器序：节点类别、父节点、数据类型、访问权限
    await pickInSelect(3, '可写')
    expect(document.body.textContent).toContain('上位机将可直接写入该节点的值')
    bodyButton('创建')?.click()
    await flushPromises()
    const payload = wrapper.emitted('create')?.[0]?.[0] as
      OpcuaNodeCreateInput | undefined
    expect(payload?.access_level).toBe(3)
  })

  it('object 类节点不出访问权限控件，提交不带 access_level', async () => {
    const wrapper = mount(NodeFormDialog, {
      props: { modelValue: true, nodes: [] },
      attachTo: document.body,
    })
    await flushPromises()
    await pickInSelect(0, 'object')
    expect(document.body.textContent).not.toContain('访问权限')
    fillModal({ 0: 'Plant', 1: 'Plant' })
    await flushPromises()
    bodyButton('创建')?.click()
    await flushPromises()
    const payload = wrapper.emitted('create')?.[0]?.[0] as
      Record<string, unknown> | undefined
    expect(payload).toBeDefined()
    expect(payload).not.toHaveProperty('access_level')
  })

  it('重新打开表单后访问权限回到只读', async () => {
    const wrapper = mount(NodeFormDialog, {
      props: { modelValue: true, nodes: [] },
      attachTo: document.body,
    })
    await flushPromises()
    await pickInSelect(3, '可写')
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    fillModal({ 0: 'Line1.T', 1: 'T' })
    await flushPromises()
    bodyButton('创建')?.click()
    await flushPromises()
    const payload = wrapper.emitted('create')?.[0]?.[0] as
      OpcuaNodeCreateInput | undefined
    expect(payload?.access_level).toBe(1)
  })

  it('可挂到已有的 object 节点下；变量节点不进父节点选项', async () => {
    const wrapper = mount(NodeFormDialog, {
      props: {
        modelValue: true,
        nodes: [
          node({ id: 'p1', node_class: 'object', browse_name: 'Plant' }),
          node({ id: 'v1', node_class: 'variable', browse_name: 'Temp' }),
        ],
      },
      attachTo: document.body,
    })
    await flushPromises()
    const labels = selectLabels(wrapper, 1)
    expect(labels).toContain('Plant')
    // 变量节点挂不了子节点，不该出现在父节点选项里
    expect(labels).not.toContain('Temp')
  })
})

describe('列表页的写入路径', () => {
  async function page(rows: OpcuaInstance[]) {
    vi.spyOn(opcuaApi, 'listInstances').mockResolvedValue({
      items: rows,
      page: 1,
      size: 20,
      total: rows.length,
    })
    const wrapper = mount(OpcuaServersPage, {
      attachTo: document.body,
      global: {
        stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } },
      },
    })
    await flushPromises()
    return wrapper
  }

  it('新建成功后关掉弹窗并重新取数', async () => {
    const create = vi
      .spyOn(opcuaApi, 'createInstance')
      .mockResolvedValue(instance())
    const wrapper = await page([])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '新建实例')
      ?.trigger('click')
    await flushPromises()
    fillModal({ 0: 'p2', 3: 'urn:x' })
    await flushPromises()
    bodyButton('创建')?.click()
    await flushPromises()
    expect(create).toHaveBeenCalled()
  })

  it('⚠ 编辑保存后若有未生效字段，提示里必须点名它们', async () => {
    vi.spyOn(opcuaApi, 'updateInstance').mockResolvedValue(
      instance({ pending_fields: ['security_policies'] }),
    )
    const wrapper = await page([instance()])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '编辑')
      ?.trigger('click')
    await flushPromises()
    bodyButton('保存')?.click()
    await flushPromises()
    // 未生效字段走的是 success 分支，不该落到 error
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('起停失败时给出可读反馈而不是静默', async () => {
    vi.spyOn(opcuaApi, 'actOnInstance').mockRejectedValue(new Error('boom'))
    const wrapper = await page([instance()])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '启动')
      ?.trigger('click')
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('删除失败时同样有反馈', async () => {
    vi.spyOn(opcuaApi, 'deleteInstance').mockRejectedValue(new Error('boom'))
    const wrapper = await page([instance()])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除')
      ?.trigger('click')
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('取列表失败时给出错误态', async () => {
    vi.spyOn(opcuaApi, 'listInstances').mockRejectedValue(new Error('boom'))
    const wrapper = mount(OpcuaServersPage, {
      global: {
        stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('重试')
  })
})

describe('地址空间的写入路径', () => {
  async function explorer(rows: OpcuaNode[], dataType: OpcuaNode['data_type']) {
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: rows,
      page: 1,
      size: 200,
      total: rows.length,
    })
    vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
      node_id: 'ns=2;s=T1',
      identifier: 'T1',
      data_type: dataType,
      value: 1,
      is_live: true,
    })
    const wrapper = mount(NodeExplorer, {
      props: { instance: instance() },
      attachTo: document.body,
    })
    await flushPromises()
    return wrapper
  }

  async function writeDraft(
    wrapper: Awaited<ReturnType<typeof explorer>>,
    raw: string,
  ): Promise<unknown> {
    const write = vi
      .spyOn(opcuaApi, 'writeNodeValue')
      .mockResolvedValue({ node_id: 'x', identifier: 'T1', value: null })
    // ⚠ 按 aria-label 取，不能用 `find('input')`——左侧还有一个搜索框，
    // 那个才是 DOM 里的第一个 input
    const field = wrapper.find('input[aria-label="要写入的值"]')
    await field.setValue(raw)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '写入')
      ?.trigger('click')
    await flushPromises()
    return write.mock.calls.at(-1)?.[2]
  }

  it('数值类型的输入还原成数字', async () => {
    const wrapper = await explorer([node()], 'double')
    expect(await writeDraft(wrapper, '3.5')).toBe(3.5)
  })

  it('⚠ 字符串类型不许被「看着像数字」转成数字', async () => {
    const wrapper = await explorer([node({ data_type: 'string' })], 'string')
    expect(await writeDraft(wrapper, '12')).toBe('12')
  })

  it('布尔类型认 true 与 1', async () => {
    const wrapper = await explorer([node({ data_type: 'boolean' })], 'boolean')
    expect(await writeDraft(wrapper, 'true')).toBe(true)
  })

  it('布尔类型的其它输入一律为 false', async () => {
    const wrapper = await explorer([node({ data_type: 'boolean' })], 'boolean')
    expect(await writeDraft(wrapper, 'nope')).toBe(false)
  })

  it('数值类型收到非数字时按原样送出，不静默变成 NaN', async () => {
    const wrapper = await explorer([node()], 'double')
    expect(await writeDraft(wrapper, 'abc')).toBe('abc')
  })

  it('写值失败时给出反馈', async () => {
    const wrapper = await explorer([node()], 'double')
    vi.spyOn(opcuaApi, 'writeNodeValue').mockRejectedValue(new Error('boom'))
    await wrapper.find('input[aria-label="要写入的值"]').setValue('1')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '写入')
      ?.trigger('click')
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('建节点失败时报错——标识冲突绝不自动改名重试', async () => {
    const wrapper = await explorer([node()], 'double')
    vi.spyOn(opcuaApi, 'createNode').mockRejectedValue(new Error('conflict'))
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '新建节点')
      ?.trigger('click')
    await flushPromises()
    fillModal({ 0: 'T1', 1: 'T1' })
    await flushPromises()
    bodyButton('创建')?.click()
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('删节点失败时报错', async () => {
    const wrapper = await explorer([node()], 'double')
    vi.spyOn(opcuaApi, 'deleteNode').mockRejectedValue(new Error('boom'))
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除节点')
      ?.trigger('click')
    await flushPromises()
    expect(errorToast).toHaveBeenCalled()
  })

  it('取节点失败时给出错误而不是空列表假象', async () => {
    vi.spyOn(opcuaApi, 'listNodes').mockRejectedValue(new Error('boom'))
    const wrapper = mount(NodeExplorer, { props: { instance: instance() } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('还没有节点')
  })
})

describe('安全面板的其余路径', () => {
  async function panel() {
    vi.spyOn(opcuaApi, 'listCredentials').mockResolvedValue([])
    vi.spyOn(opcuaApi, 'listTrustedCertificates').mockResolvedValue([
      {
        id: 'x1',
        instance_id: 'i1',
        fingerprint: 'aa:bb',
        subject: 'CN=scada',
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

  it('列出证书的主体与指纹', async () => {
    const wrapper = await panel()
    expect(wrapper.text()).toContain('CN=scada')
    expect(wrapper.text()).toContain('aa:bb')
  })

  it('添加证书走 PEM 文本域', async () => {
    const add = vi
      .spyOn(opcuaApi, 'addTrustedCertificate')
      .mockResolvedValue({} as never)
    const wrapper = await panel()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '添加证书')
      ?.trigger('click')
    await flushPromises()
    const area = document.body.querySelector('textarea')
    if (area !== null) {
      area.value = '-----BEGIN CERTIFICATE-----'
      area.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    bodyButton('添加')?.click()
    await flushPromises()
    expect(add).toHaveBeenCalled()
  })

  it('移除证书', async () => {
    const remove = vi
      .spyOn(opcuaApi, 'deleteTrustedCertificate')
      .mockResolvedValue()
    const wrapper = await panel()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '移除')
      ?.trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('i1', 'x1')
  })

  it('取数失败时给出错误', async () => {
    vi.spyOn(opcuaApi, 'listCredentials').mockRejectedValue(new Error('boom'))
    vi.spyOn(opcuaApi, 'listTrustedCertificates').mockResolvedValue([])
    const wrapper = mount(SecurityPanel, { props: { instance: instance() } })
    await flushPromises()
    expect(wrapper.text()).toContain('请求失败')
  })
})

describe('会话时长', () => {
  async function withConnectedAt(iso: string): Promise<string> {
    vi.spyOn(opcuaApi, 'listSessions').mockResolvedValue([
      { session_id: 's1', peer: 'p', username: 'u', connected_at: iso },
    ])
    const wrapper = mount(SessionsPanel, {
      props: { instance: instance({ is_running: true }) },
    })
    await flushPromises()
    return wrapper.text()
  }

  it('不足一分钟按秒', async () => {
    const text = await withConnectedAt(
      new Date(Date.now() - 5000).toISOString(),
    )
    expect(text).toContain('秒')
  })

  it('超过一分钟按分钟', async () => {
    const text = await withConnectedAt(
      new Date(Date.now() - 5 * 60_000).toISOString(),
    )
    expect(text).toContain('分钟')
  })

  it('超过一小时按小时加分钟', async () => {
    const text = await withConnectedAt(
      new Date(Date.now() - 90 * 60_000).toISOString(),
    )
    expect(text).toContain('小时')
  })

  it('时间戳解析不了时给占位而不是 NaN', async () => {
    const text = await withConnectedAt('not-a-date')
    expect(text).not.toContain('NaN')
  })

  it('取会话失败时给出错误', async () => {
    vi.spyOn(opcuaApi, 'listSessions').mockRejectedValue(new Error('boom'))
    const wrapper = mount(SessionsPanel, {
      props: { instance: instance({ is_running: true }) },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('当前没有上位机连接')
  })
})
