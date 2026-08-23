/**
 * @fileoverview 列配置表的契约：只读账号看得见列与顺序、看不见动作；
 * 「来源详情」一格答得出「这个数是哪种汇总算出来的」；上下移在两端各禁一边。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetColumn } from '@dt/contracts'

import ColumnList from '@/pages/Dataset/TableDetail/components/ColumnList.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/datasets/t1/columns', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const STAMP = '2026-01-01T00:00:00.000Z'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'inflow',
    name: '进水量',
    unit: 'm³',
    decimals: 2,
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

const THREE = [
  column({ id: 'c1', key: 'inflow', name: '进水量', order_index: 0 }),
  column({
    id: 'c2',
    key: 'kwh',
    name: '用电量',
    source: 'point',
    agg: 'delta',
    node_key: 'src1:meter.kwh',
    order_index: 1,
  }),
  column({
    id: 'c3',
    key: 'ratio',
    name: '单耗',
    source: 'formula',
    formula: '{kwh}/{inflow}',
    order_index: 2,
  }),
]

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
})

enableAutoUnmount(afterEach)

async function render(codes: string[], columns = THREE, busy = false) {
  signIn(codes)
  const wrapper = mount(ColumnList, { props: { columns, busy } })
  await flushPromises()
  return wrapper
}

describe('列配置表', () => {
  it('一行里给出名称、标识、类型与单位', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('进水量')
    expect(wrapper.text()).toContain('{inflow}')
    expect(wrapper.text()).toContain('数值')
    expect(wrapper.text()).toContain('m³')
  })

  it('⚠ 点位列先摆聚合口径：不点进弹窗也答得出这个数是怎么算出来的', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('增量')
    expect(wrapper.text()).toContain('src1:meter.kwh')
  })

  it('公式列把公式原文摆在来源详情那一格', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('{kwh}/{inflow}')
  })

  it('必填标记跟着人工录入列走', async () => {
    const wrapper = await render(
      ['dataset:view'],
      [column({ is_required: true })],
    )
    expect(wrapper.text()).toContain('必填')
  })

  it('一列都没有时说清下一步去哪按', async () => {
    const wrapper = await render(['dataset:view'], [])
    expect(wrapper.text()).toContain('这张台账还没有列')
    expect(wrapper.text()).toContain('新增列')
  })
})

describe('闸 3：只读账号', () => {
  it('看得见列，但一个写入口都没有', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('进水量')
    expect(wrapper.find('[aria-label="编辑列"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="删除列"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="上移"]').exists()).toBe(false)
  })

  it('⚠ 顺序那一格照样显示：它就是录入表单的字段序与数据表的列序', async () => {
    const wrapper = await render(['dataset:view'])
    const cells = wrapper.findAll('td')
    expect(cells[0]?.text()).toContain('1')
  })

  it('行内不挂「只读」标签——每行一句是纯噪音', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.findAll('[data-test="perm-readonly"]')).toHaveLength(0)
  })

  it('持 dataset:manage 才出现行内动作与上下移', async () => {
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    expect(wrapper.find('[aria-label="编辑列"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="删除列"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="上移"]').exists()).toBe(true)
  })
})

describe('上下移', () => {
  it('第一行不能上移、最后一行不能下移', async () => {
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    const ups = wrapper.findAll('[aria-label="上移"]')
    const downs = wrapper.findAll('[aria-label="下移"]')
    expect(ups[0]?.attributes('disabled')).toBeDefined()
    expect(ups[1]?.attributes('disabled')).toBeUndefined()
    expect(downs[2]?.attributes('disabled')).toBeDefined()
  })

  it('点一下只上报方向，请求由页面那一层去发', async () => {
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    await wrapper.findAll('[aria-label="下移"]')[0]?.trigger('click')
    expect(wrapper.emitted('move')?.[0]?.[1]).toBe(1)
  })

  it('⚠ 有一次重排在飞时整行禁用：连点会排出一个来回错乱的顺序', async () => {
    const wrapper = await render(
      ['dataset:view', 'dataset:manage'],
      THREE,
      true,
    )
    expect(
      wrapper.findAll('[aria-label="下移"]')[0]?.attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper.find('[aria-label="删除列"]').attributes('disabled'),
    ).toBeDefined()
  })
})
