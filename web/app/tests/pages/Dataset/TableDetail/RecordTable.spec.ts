/**
 * @fileoverview 锁住**动态**列与它们的单元格插槽一一对应。
 *
 * ⚠ 这条只能自己写：`data-view-slots.contract.spec.ts` 只认 `const XXX_COLUMNS`
 * 形式的静态常量，数据表的中间那段列是 computed 出来的，那道闸扫不到。少一个
 * 插槽的表现是那一列静静渲染成 `—`，typecheck 与 lint 双双放行。
 * ⚠ 列标识由用户自定，正好起名叫 `ts` / `author` / `actions` 时不许把固定列挤掉。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetColumn, DatasetRecord } from '@dt/contracts'
import { DtCursorPager } from '@dt/ui'

import RecordCell from '@/pages/Dataset/TableDetail/components/RecordCell.vue'
import RecordTable from '@/pages/Dataset/TableDetail/components/RecordTable.vue'
import { toRecordRows } from '@/pages/Dataset/TableDetail/scripts/recordView'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/datasets/t1/records', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
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

const THREE = [
  column({ id: 'c1', key: 'inflow', name: '进水量', unit: 'm³' }),
  column({ id: 'c2', key: 'kwh', name: '用电量', source: 'point' }),
  column({ id: 'c3', key: 'ratio', name: '单耗', source: 'formula' }),
]

function record(over: Partial<DatasetRecord> = {}): DatasetRecord {
  return {
    row_id: 'r1',
    ts: STAMP,
    values: { inflow: 12, kwh: 34 },
    overrides: null,
    samples: null,
    computed: { ratio: 2.8 },
    compute_error: null,
    source: 'collect',
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
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
    role: { id: 'r1', name: 'ops', description: null, is_builtin: true },
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

async function render(
  codes: string[],
  columns = THREE,
  records = [record()],
  over: Record<string, unknown> = {},
) {
  signIn(codes)
  const wrapper = mount(RecordTable, {
    props: {
      rows: toRecordRows(records),
      columns,
      loading: false,
      error: null,
      page: 1,
      hasPrev: false,
      hasNext: false,
      busy: false,
      ...over,
    },
  })
  await flushPromises()
  return wrapper
}

describe('动态列 ⇄ 单元格插槽', () => {
  it('每一列都真的渲染出一格，没有哪一列静静掉成占位符', async () => {
    const wrapper = await render(['dataset:view'])
    const keys = wrapper
      .findAll('[data-column]')
      .map((one) => one.attributes('data-column'))
    expect(keys).toEqual(['inflow', 'kwh', 'ratio'])
  })

  it('表头按列配置的顺序铺开，并带上单位', async () => {
    const wrapper = await render(['dataset:view'])
    const headers = wrapper.findAll('th').map((one) => one.text())
    expect(headers).toEqual([
      '数据时间',
      '进水量（m³）',
      '用电量',
      '单耗',
      '录入者',
      '操作',
    ])
  })

  it('加一列就多一格，不必改任何插槽名', async () => {
    const wrapper = await render(
      ['dataset:view'],
      [...THREE, column({ id: 'c4', key: 'cod', name: 'COD' })],
    )
    expect(wrapper.findAllComponents(RecordCell)).toHaveLength(4)
    expect(wrapper.findAll('th').map((one) => one.text())).toContain('COD')
  })

  it('⚠ 列标识撞上固定列的名字时，固定列不许被挤掉', async () => {
    const wrapper = await render(
      ['dataset:view'],
      [
        column({ id: 'c9', key: 'ts', name: '班次时刻' }),
        column({ id: 'c8', key: 'actions', name: '处置动作' }),
      ],
    )
    const headers = wrapper.findAll('th').map((one) => one.text())
    expect(headers).toEqual([
      '数据时间',
      '班次时刻',
      '处置动作',
      '录入者',
      '操作',
    ])
    expect(wrapper.findAllComponents(RecordCell)).toHaveLength(2)
  })
})

describe('固定的三列', () => {
  it('数据时间按本地时展示', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.findAll('td')[0]?.text()).not.toBe('—')
  })

  it('自动采集的行说「自动采集」而不是一个破折号', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('自动采集')
  })

  it('人工录入的行署名录入者', async () => {
    const wrapper = await render(['dataset:view'], THREE, [
      record({ source: 'manual', created_by_name: '张工' }),
    ])
    expect(wrapper.text()).toContain('张工')
  })
})

describe('闸 3：只读账号', () => {
  it('看得见每一格的数，看不见编辑与删除', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('12')
    expect(wrapper.find('[aria-label="编辑数据行"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="删除数据行"]').exists()).toBe(false)
  })

  it('持 dataset:record:write 才出现行内动作，点一下只上报', async () => {
    const wrapper = await render(['dataset:view', 'dataset:record:write'])
    await wrapper.find('[aria-label="编辑数据行"]').trigger('click')
    await wrapper.find('[aria-label="删除数据行"]').trigger('click')
    expect(wrapper.emitted('edit')).toHaveLength(1)
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })

  it('⚠ 有一次写在飞时行内动作全禁：连点会拿着已经删掉的那一行再发一次', async () => {
    const wrapper = await render(
      ['dataset:view', 'dataset:record:write'],
      THREE,
      [record()],
      { busy: true },
    )
    expect(
      wrapper.find('[aria-label="删除数据行"]').attributes('disabled'),
    ).toBeDefined()
  })
})

describe('游标翻页', () => {
  it('只报页序与本页条数——这个端点根本给不出总数', async () => {
    const wrapper = await render(['dataset:view'], THREE, [record()], {
      page: 3,
      hasPrev: true,
      hasNext: true,
    })
    const pager = wrapper.findComponent(DtCursorPager)
    expect(pager.props('page')).toBe(3)
    expect(pager.props('count')).toBe(1)
    expect(wrapper.text()).not.toContain('共')
  })

  it('翻页只上报，请求由分区那一层去发', async () => {
    const wrapper = await render(['dataset:view'], THREE, [record()], {
      hasNext: true,
    })
    wrapper.findComponent(DtCursorPager).vm.$emit('next')
    await flushPromises()
    expect(wrapper.emitted('next')).toHaveLength(1)
  })
})

describe('空态', () => {
  it('一行都没有时说清下一步去哪按，以及自动采集要等一个周期', async () => {
    const wrapper = await render(['dataset:view'], THREE, [])
    expect(wrapper.text()).toContain('这张台账还没有数据')
    expect(wrapper.text()).toContain('录入数据')
    expect(wrapper.text()).toContain('一个周期')
  })
})
