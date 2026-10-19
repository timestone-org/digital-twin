/** @fileoverview 协议页面的真实路由切换、筛选、固定协议表单与旧链接兼容。 */
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { CollectProtocol, CollectSource, Page } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as collect from '@/api/collect'
import { useAuthStore } from '@/stores/auth'
import OpcuaPage from '@/pages/Collect/Opcua/index.vue'
import ModbusPage from '@/pages/Collect/ModbusTcp/index.vue'
import HttpPage from '@/pages/Collect/Http/index.vue'

const subscribe = vi.fn(() => vi.fn())
vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({ isConnected: ref(false), subscribe }),
}))

const CASES = [
  {
    protocol: 'opcua',
    path: '/collect/opcua',
    title: 'OPC UA 采集',
    endpoint: 'opc.tcp://host:4840',
  },
  {
    protocol: 'modbus_tcp',
    path: '/collect/modbus-tcp',
    title: 'Modbus TCP 采集',
    endpoint: 'modbus.tcp://host:502',
  },
  {
    protocol: 'http',
    path: '/collect/http',
    title: 'HTTP / HTTPS 采集',
    endpoint: 'https://api.example.com/metrics',
  },
] satisfies {
  protocol: CollectProtocol
  path: string
  title: string
  endpoint: string
}[]

function source(
  protocol: CollectProtocol,
  id: string = protocol,
): CollectSource {
  return {
    id,
    protocol,
    name: `${id} 数据源`,
    code: id,
    description: null,
    endpoint:
      protocol === 'opcua'
        ? 'opc.tcp://host:4840'
        : protocol === 'http'
          ? 'https://api.example.com/metrics'
          : 'modbus.tcp://host:502',
    username: null,
    has_credential: false,
    options_json: {},
    read_mode: protocol === 'opcua' ? 'subscribe' : 'poll',
    poll_interval_ms: 1000,
    is_enabled: true,
    point_count: 0,
    live_point_limit: 0,
    runtime: {
      state: 'online',
      point_count: 0,
      error_category: null,
      error_detail: null,
      leader_instance: null,
      updated_at: null,
    },
    created_at: '2026-10-15T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
  }
}

function page(
  items: CollectSource[],
  total = items.length,
): Page<CollectSource> {
  return { items, total, page: 1, size: 100 }
}

function signIn(
  permissions = ['collect:view', 'collect:manage', 'collect:operate'],
): void {
  const auth = useAuthStore()
  auth.accessToken = 'token'
  auth.user = {
    id: 'user',
    username: 'operator',
    email: 'operator@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: '2026-10-15T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
    role: {
      id: 'role',
      name: 'operator',
      description: null,
      is_builtin: false,
    },
    role_permissions: permissions,
    direct_permissions: [],
    permissions,
  }
}

async function render(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/collect/opcua', component: OpcuaPage },
      { path: '/collect/modbus-tcp', component: ModbusPage },
      { path: '/collect/http', component: HttpPage },
      { path: '/:pathMatch(.*)*', component: { render: () => null } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(
    defineComponent({ components: { RouterView }, template: '<RouterView />' }),
    {
      attachTo: document.body,
      global: { plugins: [router], stubs: { Teleport: true } },
    },
  )
  await flushPromises()
  return { wrapper, router }
}

async function click(wrapper: VueWrapper, text: string): Promise<void> {
  const button = wrapper.findAll('button').find((one) => one.text() === text)
  if (button === undefined) throw new Error(`没有按钮 ${text}`)
  await button.trigger('click')
  await flushPromises()
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return {
    promise,
    resolve: (value: T) => {
      if (resolve === undefined) throw new Error('deferred 尚未初始化')
      resolve(value)
    },
  }
}

enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  setActivePinia(createPinia())
  signIn()
  subscribe.mockClear()
  vi.spyOn(collect, 'listSources').mockImplementation((query) =>
    Promise.resolve(
      page(
        CASES.filter((one) => one.protocol === query?.protocol).map((one) =>
          source(one.protocol),
        ),
      ),
    ),
  )
  vi.spyOn(collect, 'getSource').mockRejectedValue(
    new BizError(41101, '不存在', 404, 'trace'),
  )
  vi.spyOn(collect, 'listPoints').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 20,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('协议页面隔离', () => {
  it.each(
    CASES.flatMap((one) => [
      { ...one, path: `${one.path}/` },
      { ...one, path: one.path.toUpperCase() },
    ]),
  )('$path 首航仍加载匹配协议的数据源', async ({ protocol, path }) => {
    vi.mocked(collect.listSources).mockResolvedValue(
      page([source(protocol), source(protocol, 'second')]),
    )
    const { wrapper, router } = await render(path)
    expect(collect.listSources).toHaveBeenCalledWith(
      expect.objectContaining({ protocol }),
    )
    expect(router.currentRoute.value.query.source).toBe(protocol)
    expect(wrapper.get('[data-test="active-source-name"]').text()).toBe(
      `${protocol} 数据源`,
    )
    await wrapper.get('[title="second 数据源"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.source).toBe('second')
    await router.push({ query: { source: protocol } })
    await flushPromises()
    expect(wrapper.get('[data-test="active-source-name"]').text()).toBe(
      `${protocol} 数据源`,
    )
  })

  it.each(CASES)(
    '$title 只查询本协议并显示对应点位功能',
    async ({ protocol, path, title }) => {
      const { wrapper, router } = await render(path)
      expect(wrapper.find('h1').text()).toBe(title)
      expect(collect.listSources).toHaveBeenCalledWith({
        protocol,
        page: 1,
        size: 100,
        q: undefined,
      })
      expect(wrapper.find('main aside').text()).toContain(`${protocol} 数据源`)
      for (const other of CASES.filter((one) => one.protocol !== protocol)) {
        expect(wrapper.find('main aside').text()).not.toContain(
          `${other.protocol} 数据源`,
        )
      }
      expect(router.currentRoute.value.query.source).toBe(protocol)
      expect(collect.listPoints).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: protocol }),
      )
      expect(wrapper.text().includes('浏览并导入点位')).toBe(
        protocol === 'opcua',
      )
      expect(wrapper.text().includes('从 JSON 生成点位')).toBe(
        protocol === 'http',
      )
      if (protocol !== 'opcua')
        expect(wrapper.find('main').text()).not.toContain('浏览树')
    },
  )

  it.each(CASES)(
    '$title 的新建表单固定协议并保留安全默认值',
    async ({ protocol, path, endpoint }) => {
      const create = vi
        .spyOn(collect, 'createSource')
        .mockResolvedValue(source(protocol))
      const { wrapper } = await render(path)
      await click(wrapper, '新增数据源')
      const dialog = () => wrapper.get('[role="dialog"]')
      expect(
        dialog().get('[role="combobox"]').attributes('disabled'),
      ).toBeDefined()
      await dialog()
        .get('input[placeholder="如：1号生产线 PLC"]')
        .setValue('新数据源')
      await dialog()
        .get('input[placeholder="如：plant1_plc"]')
        .setValue('new_source')
      await dialog().get(`input[placeholder="${endpoint}"]`).setValue(endpoint)
      const submit = dialog()
        .findAll('button')
        .find((one) => one.text() === '创建')
      expect(submit).toBeDefined()
      await submit?.trigger('click')
      await flushPromises()
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          protocol,
          read_mode: protocol === 'opcua' ? 'subscribe' : 'poll',
          is_enabled: protocol !== 'modbus_tcp',
        }),
      )
      if (protocol === 'http')
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({
            options_json: expect.objectContaining({
              method: 'GET',
              auth_type: 'none',
            }),
          }),
        )
    },
  )

  it.each(CASES)(
    '$title 的空态只引导创建当前协议的数据源',
    async ({ path, title }) => {
      vi.mocked(collect.listSources).mockResolvedValue(page([]))
      const { wrapper } = await render(path)
      expect(wrapper.find('main aside').text()).toContain(
        `新增 ${title.replace(' 采集', '')} 数据源`,
      )
      expect(wrapper.find('main').text()).toContain('选择一个数据源')
    },
  )

  it.each(CASES)(
    '$title 的只读账号没有新增、编辑和 JSON 导入入口',
    async ({ path }) => {
      signIn(['collect:view'])
      const { wrapper } = await render(path)
      expect(wrapper.findAll('button').map((one) => one.text())).not.toContain(
        '新增数据源',
      )
      expect(wrapper.find('button[aria-label="编辑"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('从 JSON 生成点位')
    },
  )

  it('查找、翻页和周期刷新都保留协议条件', async () => {
    vi.mocked(collect.listSources).mockResolvedValue(
      page([source('http')], 101),
    )
    const { wrapper } = await render('/collect/http')
    await click(wrapper, '下一页')
    expect(collect.listSources).toHaveBeenLastCalledWith(
      expect.objectContaining({ protocol: 'http', page: 2 }),
    )
    await wrapper
      .get('input[placeholder="搜索数据源名称或编码"]')
      .setValue('  能源  ')
    await click(wrapper, '查找')
    expect(collect.listSources).toHaveBeenLastCalledWith(
      expect.objectContaining({ protocol: 'http', page: 1, q: '能源' }),
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(collect.listSources).toHaveBeenLastCalledWith(
      expect.objectContaining({ protocol: 'http', page: 1, q: '能源' }),
    )
  })

  it('切换协议页清空筛选、关闭原表单并退订原数据源', async () => {
    const { wrapper, router } = await render('/collect/opcua')
    const unsubscribe = subscribe.mock.results[0]?.value
    await wrapper
      .get('input[placeholder="搜索数据源名称或编码"]')
      .setValue('PLC')
    await click(wrapper, '新增数据源')
    await router.push('/collect/http')
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(
      wrapper.get('input[placeholder="搜索数据源名称或编码"]').element,
    ).toHaveProperty('value', '')
    expect(router.currentRoute.value.query.source).toBe('http')
    expect(unsubscribe).toHaveBeenCalledOnce()
    vi.mocked(collect.listSources).mockClear()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(collect.listSources).toHaveBeenCalledTimes(1)
    expect(collect.listSources).toHaveBeenLastCalledWith(
      expect.objectContaining({ protocol: 'http', page: 1 }),
    )
  })
})

describe('选中源与链接', () => {
  it.each([
    ['http', '/collect/http'],
    ['modbus_tcp', '/collect/modbus-tcp'],
  ] satisfies [CollectProtocol, string][])(
    '旧 OPC UA 地址里的 %s 源跳到对应页面',
    async (protocol, path) => {
      vi.mocked(collect.getSource).mockResolvedValue(source(protocol))
      const { router, wrapper } = await render(
        `/collect/opcua?source=${protocol}&theme=light&embed=1#points`,
      )
      await flushPromises()
      expect(router.currentRoute.value.path).toBe(path)
      expect(router.currentRoute.value.query).toEqual({
        source: protocol,
        theme: 'light',
        embed: '1',
      })
      expect(router.currentRoute.value.hash).toBe('#points')
      expect(wrapper.get('[data-test="active-source-name"]').text()).toBe(
        `${protocol} 数据源`,
      )
    },
  )

  it('链接指向本协议的其他分页数据源时保留选择', async () => {
    vi.mocked(collect.getSource).mockResolvedValue(source('http', 'offpage'))
    const { wrapper, router } = await render('/collect/http?source=offpage')
    expect(wrapper.get('[data-test="active-source-name"]').text()).toBe(
      'offpage 数据源',
    )
    expect(router.currentRoute.value.query.source).toBe('offpage')
  })

  it('已删除的链接回落到当前协议第一个数据源', async () => {
    const { router } = await render('/collect/http?source=gone')
    expect(router.currentRoute.value.query.source).toBe('http')
  })

  it('源详情读取失败保留链接并显示重试入口', async () => {
    vi.mocked(collect.getSource).mockRejectedValue(new Error('暂时不可用'))
    const { wrapper, router } = await render('/collect/http?source=offpage')
    expect(wrapper.text()).toContain('加载数据源失败')
    expect(router.currentRoute.value.query.source).toBe('offpage')
    vi.mocked(collect.getSource).mockResolvedValue(source('http', 'offpage'))
    await click(wrapper, '重试')
    expect(wrapper.get('[data-test="active-source-name"]').text()).toBe(
      'offpage 数据源',
    )
  })

  it('切页前发出的慢请求返回后不能污染新页面或改写地址', async () => {
    const slow = deferred<Page<CollectSource>>()
    vi.mocked(collect.listSources).mockImplementationOnce(() => slow.promise)
    const { wrapper, router } = await render('/collect/opcua')
    await router.push('/collect/http')
    await flushPromises()
    slow.resolve(page([source('opcua')]))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/collect/http')
    expect(router.currentRoute.value.query.source).toBe('http')
    expect(wrapper.get('[data-test="active-source-name"]').text()).toBe(
      'http 数据源',
    )
  })

  it('同页快速查询只应用最后一次结果', async () => {
    const { wrapper } = await render('/collect/http')
    const slow = deferred<Page<CollectSource>>()
    vi.mocked(collect.listSources).mockImplementationOnce(() => slow.promise)
    await click(wrapper, '查找')
    vi.mocked(collect.listSources).mockResolvedValue(
      page([source('http', 'new')]),
    )
    vi.mocked(collect.getSource).mockResolvedValue(source('http'))
    await wrapper
      .get('input[placeholder="搜索数据源名称或编码"]')
      .setValue('new')
    await click(wrapper, '查找')
    slow.resolve(page([source('http', 'old')]))
    await flushPromises()
    expect(wrapper.find('main aside').text()).toContain('new 数据源')
    expect(wrapper.find('main aside').text()).not.toContain('old 数据源')
  })
})
