/**
 * @fileoverview 锁住一格的三条规矩：计算失败盖过取值、样本标记与取值互不冒充、
 * 角标分得清人改的与迁移带进来的且只作标记。
 *
 * ⚠ 气泡的 `side="bottom"` 只能在这里守：写成别的名字（比如参考实现的
 * `placement`）typecheck 与 lint 双双放行，向上的气泡贴着滚动容器上沿，
 * 第一行的失败原因于是永远读不到。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type {
  DatasetColumn,
  DatasetOverride,
  DatasetRecord,
} from '@dt/contracts'
import { DtTooltip } from '@dt/ui'

import RecordCell from '@/pages/Dataset/TableDetail/components/RecordCell.vue'
import {
  toRecordRows,
  type RecordRow,
} from '@/pages/Dataset/TableDetail/scripts/recordView'
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
    key: 'kwh',
    name: '用电量',
    unit: 'kWh',
    decimals: null,
    data_type: 'number',
    source: 'point',
    agg: 'avg',
    node_key: 'src1:meter.kwh',
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

function record(over: Partial<DatasetRecord> = {}): DatasetRecord {
  return {
    row_id: 'r1',
    ts: STAMP,
    values: { kwh: 12 },
    overrides: null,
    samples: null,
    computed: {},
    compute_error: null,
    source: 'collect',
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

/** 一行 → 表格行。取不到就当场喊出来，别让 `undefined` 流进挂载。 */
function oneRow(row: DatasetRecord): RecordRow {
  const made = toRecordRows([row])[0]
  if (made === undefined) throw new Error('这一行没能转成表格行')
  return made
}

function override(over: Partial<DatasetOverride> = {}): DatasetOverride {
  return {
    value: 99,
    by: 'u1',
    by_name: '张工',
    at: STAMP,
    reason: null,
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
  one: DatasetColumn,
  row: DatasetRecord,
  median: number | null = null,
) {
  signIn(codes)
  const wrapper = mount(RecordCell, {
    props: { column: one, row: oneRow(row), median, busy: false },
  })
  await flushPromises()
  return wrapper
}

describe('第一层：计算失败', () => {
  it('求值出错的格子说「计算失败」，原因挂在悬停里', async () => {
    const wrapper = await render(
      ['dataset:view'],
      column({ key: 'ratio', source: 'formula' }),
      record({ computed: { ratio: 5 }, compute_error: { ratio: '除数为零' } }),
    )
    expect(wrapper.text()).toContain('计算失败')
    expect(wrapper.text()).not.toContain('5')
    expect(wrapper.findComponent(DtTooltip).props('content')).toBe('除数为零')
  })

  it('⚠ 表格里的气泡一律向下开：向上会被滚动容器的上边缘整个裁掉', async () => {
    const wrapper = await render(
      ['dataset:view'],
      column({ key: 'ratio', source: 'formula' }),
      record({ compute_error: { ratio: '除数为零' } }),
    )
    expect(wrapper.findComponent(DtTooltip).props('side')).toBe('bottom')
  })
})

describe('第二层：取值', () => {
  it('公式列读 computed，其余读 values', async () => {
    const values = await render(['dataset:view'], column(), record())
    expect(values.text()).toContain('12')
    const computed = await render(
      ['dataset:view'],
      column({ key: 'ratio', source: 'formula' }),
      record({ computed: { ratio: 3.5 } }),
    )
    expect(computed.text()).toContain('3.5')
  })

  it('⚠ 修正过的格子显示的是 values 里那个生效值，不再叠一次 overrides', async () => {
    const wrapper = await render(
      ['dataset:view'],
      column(),
      record({
        values: { kwh: 12 },
        overrides: { kwh: override({ value: 99 }) },
      }),
    )
    expect(wrapper.text()).toContain('12')
    expect(wrapper.text()).not.toContain('99')
  })
})

describe('第三层：样本数标记', () => {
  it('一条都没采到的格子调灰并说清「没有数据」不是「值是空的」', async () => {
    const wrapper = await render(
      ['dataset:view'],
      column(),
      record({ values: { kwh: null }, samples: { kwh: 0 } }),
    )
    const marked = wrapper.find('[data-sample="empty"]')
    expect(marked.exists()).toBe(true)
    expect(marked.classes()).toContain('decoration-dotted')
    expect(wrapper.findComponent(DtTooltip).props('content')).toContain(
      '一条样本都没采到',
    )
  })

  it('样本充足的格子不挂任何标记，免得一屏虚线', async () => {
    const wrapper = await render(
      ['dataset:view'],
      column(),
      record({ samples: { kwh: 120 } }),
      100,
    )
    expect(wrapper.find('[data-sample]').exists()).toBe(false)
  })
})

describe('人工修正角标', () => {
  it('人改的与迁移带进来的用不同的角标', async () => {
    const human = await render(
      ['dataset:view'],
      column(),
      record({ overrides: { kwh: override() } }),
    )
    expect(human.find('[data-override="human"]').exists()).toBe(true)
    const migrated = await render(
      ['dataset:view'],
      column(),
      record({ overrides: { kwh: override({ by: null, by_name: null }) } }),
    )
    expect(migrated.find('[data-override="migration"]').exists()).toBe(true)
  })

  it('⚠ 没有撤销权限的人照样看得见角标：看不见就会以为这个数是采出来的', async () => {
    const wrapper = await render(
      ['dataset:view'],
      column(),
      record({ overrides: { kwh: override() } }),
    )
    expect(wrapper.find('[data-override="human"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="撤销人工修正：用电量"]').exists()).toBe(
      false,
    )
  })

  it('持 dataset:override 才点得动那颗撤销键，点一下只上报不发请求', async () => {
    const wrapper = await render(
      ['dataset:view', 'dataset:override'],
      column(),
      record({ overrides: { kwh: override() } }),
    )
    const button = wrapper.find('[aria-label="撤销人工修正：用电量"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.emitted('revoke')).toHaveLength(1)
  })

  it('没有修正的格子不挂角标', async () => {
    const wrapper = await render(['dataset:view'], column(), record())
    expect(wrapper.find('[data-override]').exists()).toBe(false)
  })
})
