/**
 * @fileoverview 列配置分区的契约：人工录入的台账里配了点位列时必须明说那几列
 * 不会自己有值，自动采集的台账则说清多久汇总一次；行内动作原样往上传。
 *
 * ⚠ 「人工录入 + 点位列」后端并不拦，那几列会永远是空的，而界面上它们与别的
 * 列长得一模一样——不说这一句，用户只会以为采集坏了。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetColumn, DatasetTable } from '@dt/contracts'

import ColumnsPanel from '@/pages/Dataset/TableDetail/components/ColumnsPanel.vue'
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

const POINT = column({
  id: 'c2',
  key: 'kwh',
  name: '用电量',
  source: 'point',
  node_key: 'src1:meter.kwh',
  order_index: 1,
})

function table(over: Partial<DatasetTable> = {}): DatasetTable {
  return {
    id: 't1',
    code: 'energy_log',
    name: '能耗台账',
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 3_600_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 1,
    created_at: STAMP,
    updated_at: STAMP,
    columns: [],
    ...over,
  }
}

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
    role_permissions: ['dataset:view', 'dataset:manage'],
    direct_permissions: [],
    permissions: ['dataset:view', 'dataset:manage'],
  }
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  signIn()
})

enableAutoUnmount(afterEach)

async function render(
  current: DatasetTable | null,
  columns: DatasetColumn[] = [POINT],
) {
  const wrapper = mount(ColumnsPanel, {
    props: { table: current, columns, busy: false },
  })
  await flushPromises()
  return wrapper
}

describe('取数方式与列来源对不上时', () => {
  it('⚠ 人工录入的台账里配了点位列，必须明说那几列不会自己有值', async () => {
    const wrapper = await render(table({ collect_mode: 'manual' }))
    expect(wrapper.text()).toContain('不会自己有值')
  })

  it('人工录入的台账里没有点位列就不摆这句——那是正常配置', async () => {
    const wrapper = await render(table({ collect_mode: 'manual' }), [column()])
    expect(wrapper.text()).not.toContain('不会自己有值')
  })

  it('自动采集的台账说清多久汇总一次', async () => {
    const wrapper = await render(table())
    expect(wrapper.text()).toContain('每 1 小时')
  })

  it('自动采集但一根点位列都没有时也不摆周期——没有列会用到它', async () => {
    const wrapper = await render(table(), [column()])
    expect(wrapper.text()).not.toContain('每 1 小时')
  })

  it('台账还没取回来时一句都不说，不猜', async () => {
    const wrapper = await render(null)
    expect(wrapper.text()).not.toContain('不会自己有值')
    expect(wrapper.text()).not.toContain('每 1 小时')
  })
})

describe('分区只往上传，自己不动手', () => {
  it('编辑 / 删除 / 上下移都原样冒到详情页那一层', async () => {
    const wrapper = await render(table(), [column(), POINT])

    await wrapper.find('[aria-label="编辑列"]').trigger('click')
    await wrapper.find('[aria-label="删除列"]').trigger('click')
    await wrapper.findAll('[aria-label="下移"]')[0]?.trigger('click')

    expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({ id: 'c1' })
    expect(wrapper.emitted('remove')?.[0]?.[0]).toMatchObject({ id: 'c1' })
    expect(wrapper.emitted('move')?.[0]).toEqual([
      expect.objectContaining({ id: 'c1' }),
      1,
    ])
  })
})
