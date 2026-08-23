/**
 * @fileoverview 台账详情页外壳的契约：身份条一眼说清这是哪张表、
 * 「只读」整页只摆一处、新增入口按写码门控、分区页签是真链接。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetColumn, DatasetTable } from '@dt/contracts'

import { TransportError } from '@/api/client'
import * as dataset from '@/api/dataset'
import DetailPage from '@/pages/Dataset/TableDetail/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({
    path: '/datasets/t1/columns',
    name: 'dataset-table-columns',
    params: { tableId: 't1' },
    query: {},
  }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  // 分区是子路由，详情页只留一个出口；出口里放什么由分区自己的用例去验
  RouterView: { template: '<div data-test="router-view" />' },
}))

const STAMP = '2026-01-01T00:00:00.000Z'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'inflow',
    name: '进水量',
    unit: null,
    decimals: null,
    data_type: 'number',
    source: 'manual',
    agg: 'avg',
    node_key: null,
    formula: null,
    formula_deps: null,
    order_index: 0,
    is_required: false,
    default_value: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function table(over: Partial<DatasetTable> = {}): DatasetTable {
  return {
    id: 't1',
    code: 'energy_log',
    name: '一号机组能耗台账',
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 3_600_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 2,
    created_at: STAMP,
    updated_at: STAMP,
    columns: [column(), column({ id: 'c2', key: 'kwh', order_index: 1 })],
    ...over,
  }
}

function signIn(codes: string[]): void {
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
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  }
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.spyOn(dataset, 'getDatasetTable').mockResolvedValue(table())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

// ⚠ AppTabNav 里的 `<RouterLink>` 是**全局组件**，靠 `app.use(router)` 注册：
// 只 mock vue-router 的具名导出，它在模板里解析不到，页签会渲染成空壳
const ROUTER_LINK = { props: ['to'], template: '<a :href="to"><slot /></a>' }

async function render(codes: string[]) {
  signIn(codes)
  const wrapper = mount(DetailPage, {
    global: { components: { RouterLink: ROUTER_LINK } },
  })
  await flushPromises()
  return wrapper
}

describe('身份条', () => {
  it('一眼说清这是哪张表：名称、编码、启用状态与列数', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('一号机组能耗台账')
    expect(wrapper.text()).toContain('energy_log')
    expect(wrapper.text()).toContain('启用')
    expect(wrapper.text()).toContain('2 列')
  })

  it('停用的台账在身份条上就看得出来', async () => {
    vi.mocked(dataset.getDatasetTable).mockResolvedValue(
      table({ is_enabled: false }),
    )
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('停用')
  })

  it('取数方式也摆出来：人工录入的表不会自己长出数据行', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('自动采集 · 每 1 小时')
  })

  it('列数跟着手上这份列走，不读列表页那份可能已经过期的 column_count', async () => {
    vi.mocked(dataset.getDatasetTable).mockResolvedValue(
      table({ column_count: 99, columns: [column()] }),
    )
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('1 列')
    expect(wrapper.text()).not.toContain('99 列')
  })
})

describe('闸 3：写入口', () => {
  it('⚠ 只读账号看到「只读」，且整页只摆这一处——每行一句是纯噪音', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).not.toContain('新增列')
    expect(wrapper.findAll('[data-test="perm-readonly"]')).toHaveLength(1)
  })

  it('持 dataset:manage 才出现新增列，且不再摆「只读」', async () => {
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    expect(wrapper.text()).toContain('新增列')
    expect(wrapper.findAll('[data-test="perm-readonly"]')).toHaveLength(0)
  })
})

describe('分区页签', () => {
  it('页签是真链接：可收藏、可中键新开、后退可用', async () => {
    const wrapper = await render(['dataset:view'])
    const tab = wrapper.find('[aria-label="台账详情分区"] a')
    expect(tab.attributes('href')).toBe('/datasets/t1/columns')
    expect(tab.text()).toContain('列配置')
  })

  it('分区出口只有一个，内容由子路由决定', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.findAll('[data-test="router-view"]')).toHaveLength(1)
  })
})

describe('取不到台账时', () => {
  it('说「台账不存在」而不是摆一张空壳', async () => {
    vi.mocked(dataset.getDatasetTable).mockRejectedValue(
      new TransportError(404, '台账不存在'),
    )
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('台账不存在')
  })

  it('取数失败给得出重试，重试真的再取一次', async () => {
    vi.mocked(dataset.getDatasetTable).mockRejectedValue(
      new TransportError(0, '无法连接服务器，请检查网络'),
    )
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('无法连接服务器')

    vi.mocked(dataset.getDatasetTable).mockResolvedValue(table())
    const retry = wrapper
      .findAll('button')
      .find((one) => one.text().trim() === '重试')
    await retry?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('一号机组能耗台账')
  })

  it('⚠ 台账没取回来时不摆新增列：那个按钮点下去没有可挂列的表', async () => {
    vi.mocked(dataset.getDatasetTable).mockRejectedValue(
      new TransportError(404, '台账不存在'),
    )
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    expect(wrapper.text()).not.toContain('新增列')
  })
})
