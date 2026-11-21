/**
 * @fileoverview 地址空间这一屏要走通的那条路：找到某个点 → 看它现在多少。
 *
 * 这里守的是「找得到」：搜索三个字段都认、命中的祖先留着、搜索时不许有东西
 * 藏在折叠的分支里、分页截断要如实说。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { OpcuaInstance, OpcuaNode, Page } from '@dt/contracts'
import { DtField, DtInput } from '@dt/ui'

import { BizError } from '@/api/client'
import * as opcuaApi from '@/api/opcua'
import NodeExplorer from '@/pages/Tools/OpcuaServerDetail/components/NodeExplorer.vue'
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

const confirmNode = vi.fn<() => Promise<boolean>>()
const successToast = vi.fn()
const errorToast = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmNode }),
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

const TREE: OpcuaNode[] = [
  node({
    id: 'a',
    browse_name: 'Line1',
    node_class: 'object',
    identifier: 'Line1',
    node_id: 'ns=2;s=Line1',
  }),
  node({
    id: 'a1',
    parent_id: 'a',
    browse_name: 'Temperature',
    identifier: 'Line1.Temp',
    node_id: 'ns=2;s=Line1.Temp',
  }),
  node({
    id: 'a2',
    parent_id: 'a',
    browse_name: 'Pressure',
    identifier: 'Line1.Press',
    node_id: 'ns=2;s=Line1.Press',
  }),
  node({
    id: 'b',
    browse_name: 'Line2',
    node_class: 'object',
    identifier: 'Line2',
    node_id: 'ns=2;s=Line2',
  }),
  node({
    id: 'b1',
    parent_id: 'b',
    browse_name: 'Flow',
    identifier: 'Line2.Flow',
    node_id: 'ns=2;s=Line2.Flow',
  }),
]

async function explorer(rows: OpcuaNode[] = TREE) {
  vi.spyOn(opcuaApi, 'listNodes').mockImplementation((_, query) => {
    const size = query?.size ?? 200
    const page = query?.page ?? 1
    return Promise.resolve({
      items: rows.slice((page - 1) * size, page * size),
      page,
      size,
      total: rows.length,
      revision: 'stable-tree',
    })
  })
  vi.spyOn(opcuaApi, 'readNodeValue').mockResolvedValue({
    node_id: 'ns=2;s=T1',
    identifier: 'T1',
    data_type: 'double',
    value: 21.5,
    is_live: true,
  })
  const wrapper = mount(NodeExplorer, {
    props: { instance: instance() },
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  return wrapper
}

/** 往搜索框里打字。 */
async function search(
  wrapper: Awaited<ReturnType<typeof explorer>>,
  keyword: string,
): Promise<void> {
  await wrapper.find('input[aria-label="搜索节点"]').setValue(keyword)
  await flushPromises()
}

function labels(wrapper: Awaited<ReturnType<typeof explorer>>): string[] {
  return wrapper
    .findAll('[role="treeitem"]')
    .map((row) => row.text().replace('父节点不在本页', '').trim())
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  confirmNode.mockReset().mockResolvedValue(true)
  successToast.mockClear()
  errorToast.mockClear()
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

describe('进来先看见全貌', () => {
  it('默认整棵树展开，不用一层层点开才知道有什么', async () => {
    expect(labels(await explorer())).toEqual([
      'Line1',
      'Temperature',
      'Pressure',
      'Line2',
      'Flow',
    ])
  })

  it('默认选中第一个节点，右侧不是一片空白', async () => {
    const wrapper = await explorer()
    expect(
      wrapper.get('[role="separator"]').attributes('aria-label'),
    ).toContain('地址空间')
    expect(wrapper.text()).toContain('ns=2;s=Line1')
  })

  it('一个节点都没有时说清楚下一步做什么', async () => {
    const wrapper = await explorer([])
    expect(wrapper.text()).toContain('还没有节点')
    expect(wrapper.text()).toContain('上位机就能读到它')
  })

  it('报出节点总数', async () => {
    expect((await explorer()).text()).toContain('共 5 个节点')
  })
})

describe('搜索', () => {
  it('按 BrowseName 搜得到', async () => {
    const wrapper = await explorer()
    await search(wrapper, 'Flow')
    expect(labels(wrapper)).toEqual(['Line2', 'Flow'])
  })

  it('⚠ 按 NodeId 也搜得到——现场手里往往只有组态里那一串', async () => {
    const wrapper = await explorer()
    await search(wrapper, 'ns=2;s=Line1.Press')
    expect(labels(wrapper)).toEqual(['Line1', 'Pressure'])
  })

  it('按标识搜得到，且大小写不敏感', async () => {
    const wrapper = await explorer()
    await search(wrapper, 'line2.flow')
    expect(labels(wrapper)).toEqual(['Line2', 'Flow'])
  })

  it('⚠ 命中的祖先留着——同名的 Temperature 常常有好几个，没有上下文分不出', async () => {
    const wrapper = await explorer()
    await search(wrapper, 'Temperature')
    expect(labels(wrapper)).toEqual(['Line1', 'Temperature'])
  })

  it('⚠ 搜索时整棵树临时全展开，命中的东西不许藏在折叠的分支里', async () => {
    const wrapper = await explorer()
    await wrapper.find('button[aria-label="全部折叠"]').trigger('click')
    await flushPromises()
    expect(labels(wrapper)).toEqual(['Line1', 'Line2'])
    await search(wrapper, 'Flow')
    expect(labels(wrapper)).toEqual(['Line2', 'Flow'])
  })

  it('报出命中数与总数，而不是只剩一个孤零零的列表', async () => {
    const wrapper = await explorer()
    await search(wrapper, 'Line1')
    expect(wrapper.text()).toContain('命中 3 / 5 个节点')
  })

  it('一个都没命中时给出改搜法的提示，而不是「还没有节点」', async () => {
    const wrapper = await explorer()
    await search(wrapper, 'zzz')
    expect(wrapper.text()).toContain('没有匹配的节点')
    expect(wrapper.text()).not.toContain('还没有节点')
  })

  it('清空关键词回到折叠状态本来的样子', async () => {
    const wrapper = await explorer()
    await wrapper.find('button[aria-label="全部折叠"]').trigger('click')
    await search(wrapper, 'Flow')
    await search(wrapper, '')
    expect(labels(wrapper)).toEqual(['Line1', 'Line2'])
  })
})

describe('展开与折叠', () => {
  it('一键全部折叠只剩根', async () => {
    const wrapper = await explorer()
    await wrapper.find('button[aria-label="全部折叠"]').trigger('click')
    expect(labels(wrapper)).toEqual(['Line1', 'Line2'])
  })

  it('一键全部展开', async () => {
    const wrapper = await explorer()
    await wrapper.find('button[aria-label="全部折叠"]').trigger('click')
    await wrapper.find('button[aria-label="全部展开"]').trigger('click')
    expect(labels(wrapper)).toHaveLength(5)
  })

  it('点折叠钮收起单个分支', async () => {
    const wrapper = await explorer()
    await wrapper.findAll('.node-caret')[0]?.trigger('click')
    expect(labels(wrapper)).toEqual(['Line1', 'Line2', 'Flow'])
  })

  it('再点一次又打开', async () => {
    const wrapper = await explorer()
    await wrapper.findAll('.node-caret')[0]?.trigger('click')
    await wrapper.findAll('.node-caret')[0]?.trigger('click')
    expect(labels(wrapper)).toHaveLength(5)
  })

  it('键盘的 collapse / expand 与折叠钮走同一条路', async () => {
    const wrapper = await explorer()
    const rows = () => wrapper.findAll('[role="treeitem"]')
    await rows()[0]?.trigger('keydown', { key: 'ArrowLeft' })
    expect(labels(wrapper)).toEqual(['Line1', 'Line2', 'Flow'])
    await rows()[0]?.trigger('keydown', { key: 'ArrowRight' })
    expect(labels(wrapper)).toHaveLength(5)
  })

  it('⚠ 选中折叠分支里的节点时，把这条路展开——否则选中了却看不见在哪', async () => {
    const wrapper = await explorer()
    await wrapper.find('button[aria-label="全部折叠"]').trigger('click')
    expect(labels(wrapper)).toEqual(['Line1', 'Line2'])
    await search(wrapper, 'Flow')
    await wrapper.findAll('[role="treeitem"]')[1]?.trigger('click')
    await search(wrapper, '')
    expect(labels(wrapper)).toEqual(['Line1', 'Line2', 'Flow'])
  })
})

describe('完整地址空间', () => {
  it('可搜索和编辑后续页的节点', async () => {
    const many = Array.from({ length: 201 }, (_, index) =>
      node({ id: `n${index}`, browse_name: `N${index}` }),
    )
    const wrapper = await explorer(many)
    await search(wrapper, 'N200')
    expect(labels(wrapper)).toEqual(['N200'])
    await wrapper.get('[role="treeitem"]').trigger('click')
    await clickButton(wrapper, '编辑配置')
    expect(wrapper.get('[role="dialog"]').text()).toContain('编辑节点配置')
  })

  it('换实例之后，旧实例的分页结果不能覆盖新地址空间', async () => {
    const wrapper = await explorer()
    let finish: (result: Page<OpcuaNode>) => void = () => {}
    const slow = new Promise<Page<OpcuaNode>>((resolve) => (finish = resolve))
    const old = node({ browse_name: '旧实例节点' })
    const next = node({
      id: 'n2',
      instance_id: 'i3',
      browse_name: '新实例节点',
    })
    vi.spyOn(opcuaApi, 'listNodes')
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce({ items: [next], page: 1, size: 200, total: 1 })
    await wrapper.setProps({ instance: instance({ id: 'i2' }) })
    await wrapper.setProps({ instance: instance({ id: 'i3' }) })
    finish({ items: [old], page: 1, size: 200, total: 1 })
    await flushPromises()
    expect(labels(wrapper)).toEqual(['新实例节点'])
  })
})

async function clickButton(
  wrapper: Awaited<ReturnType<typeof explorer>>,
  label: string,
): Promise<void> {
  const button = wrapper.findAll('button').find((one) => one.text() === label)
  if (button === undefined) throw new Error(`缺少按钮 ${label}`)
  await button.trigger('click')
}

async function renameFirstNode(
  wrapper: Awaited<ReturnType<typeof explorer>>,
  name: string,
): Promise<void> {
  await clickButton(wrapper, '编辑配置')
  const field = wrapper
    .findAllComponents(DtField)
    .find((one) => one.props('label') === 'BrowseName')
  if (field === undefined) throw new Error('缺少 BrowseName 字段')
  field.getComponent(DtInput).vm.$emit('update:modelValue', name)
  await flushPromises()
  await clickButton(wrapper, '保存')
  await flushPromises()
}

describe('节点配置更新', () => {
  it('改名保留 NodeId 与选中位置，并按回执提示重启', async () => {
    const first = node({ id: 'a', node_class: 'object', browse_name: 'Line1' })
    const save = vi.spyOn(opcuaApi, 'updateNode').mockResolvedValue({
      node: { ...first, browse_name: '生产线' },
      pending_fields: ['browse_name'],
    })
    const wrapper = await explorer([first])
    await renameFirstNode(wrapper, '生产线')
    expect(save).toHaveBeenCalledWith('i1', 'a', { browse_name: '生产线' })
    expect(labels(wrapper)).toEqual(['生产线'])
    expect(wrapper.get('[role="treeitem"]').attributes('aria-selected')).toBe(
      'true',
    )
    expect(wrapper.text()).toContain(first.node_id)
    expect(successToast).toHaveBeenCalledWith(
      'BrowseName 已保存，重启实例后生效',
    )
    expect(wrapper.emitted('configuration-changed')).toHaveLength(1)
  })

  it('保存失败保留编辑草稿，并显示服务端错误', async () => {
    vi.spyOn(opcuaApi, 'updateNode').mockRejectedValue(
      new BizError(42111, '保存失败', 409, 'trace-update'),
    )
    const wrapper = await explorer()
    await renameFirstNode(wrapper, '生产线')
    expect(wrapper.get('[role="dialog"]').text()).toContain('编辑节点配置')
    expect(
      wrapper
        .findAll('input')
        .some((input) => input.element.value === '生产线'),
    ).toBe(true)
    expect(errorToast).toHaveBeenCalledWith('保存失败')
    expect(wrapper.emitted('configuration-changed')).toBeUndefined()
  })

  it('没有管理权限时不显示配置变更操作', async () => {
    const user = useAuthStore().user
    if (user === null) throw new Error('需要登录用户')
    user.permissions = ['opcua:view']
    const wrapper = await explorer()
    expect(wrapper.text()).not.toContain('编辑配置')
    expect(wrapper.text()).not.toContain('删除节点')
  })
})

describe('选中与删除的联动', () => {
  it('删掉当前选中的节点后右侧回到空态，而不是停在已经没了的节点上', async () => {
    const wrapper = await explorer()
    const remove = vi.spyOn(opcuaApi, 'deleteNode').mockResolvedValue()
    vi.spyOn(opcuaApi, 'listNodes').mockResolvedValue({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    await clickButton(wrapper, '删除节点')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('i1', 'a')
    expect(wrapper.text()).toContain('还没有节点')
    expect(wrapper.emitted('configuration-changed')).toHaveLength(1)
  })

  it('取消删除后仍保留当前节点', async () => {
    confirmNode.mockResolvedValue(false)
    const remove = vi.spyOn(opcuaApi, 'deleteNode')
    const wrapper = await explorer()
    await clickButton(wrapper, '删除节点')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
    expect(labels(wrapper)).toContain('Line1')
  })

  it('删除失败时保留节点并显示错误', async () => {
    vi.spyOn(opcuaApi, 'deleteNode').mockRejectedValue(
      new BizError(42101, '删除失败', 409, 'trace-delete'),
    )
    const wrapper = await explorer()
    await clickButton(wrapper, '删除节点')
    await flushPromises()
    expect(labels(wrapper)).toContain('Line1')
    expect(errorToast).toHaveBeenCalledWith('删除失败')
    expect(wrapper.emitted('configuration-changed')).toBeUndefined()
  })
})

describe('地址空间的一致性', () => {
  it('读取期间发生变更时提示重试，保留整树语义', async () => {
    const wrapper = await explorer()
    const first = Array.from({ length: 200 }, (_, i) =>
      node({ id: `n${i}`, browse_name: `N${i}` }),
    )
    const page1 = {
      page: 1,
      size: 200,
      total: 201,
      revision: 'before',
      items: first,
    }
    const page2 = {
      page: 2,
      size: 200,
      total: 201,
      revision: 'after',
      items: [node({ id: 'new' })],
    }
    vi.mocked(opcuaApi.listNodes)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
    await wrapper.setProps({ instance: instance({ id: 'concurrent' }) })
    await flushPromises()
    expect(wrapper.text()).toContain('节点列表在读取期间发生变化')
    expect(wrapper.text()).not.toContain('共 0 个节点')
    expect(labels(wrapper)).toEqual([])
  })
})
