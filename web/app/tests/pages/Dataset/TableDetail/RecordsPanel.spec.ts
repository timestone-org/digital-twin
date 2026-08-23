/**
 * @fileoverview 数据分区的契约：**「下游过期」的横幅所有人可见、只有重算按钮
 * 挂码**；三颗写动作各挂各的码；删行与撤销修正都要二次确认，且撤销的那句话里
 * 不许出现一个具体的数。
 *
 * ⚠ 横幅那条是产品判断不是长相：过期是这个人改历史行造成的**事实**，把横幅
 * 一起藏掉，他就永远不知道自己该去找谁重算。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type {
  CursorPage,
  DatasetColumn,
  DatasetRecord,
  DatasetTable,
} from '@dt/contracts'

import * as dataset from '@/api/dataset'
import RecordsPanel from '@/pages/Dataset/TableDetail/components/RecordsPanel.vue'
import { useAuthStore } from '@/stores/auth'

interface ConfirmAsk {
  title?: string
  message: string
  confirmText?: string
  danger?: boolean
}

const confirmSpy = vi.fn<(request: ConfirmAsk) => Promise<boolean>>()
const toastSuccess = vi.fn<(message: string) => void>()
const toastInfo = vi.fn<(message: string) => void>()
const toastWarning = vi.fn<(message: string) => void>()
const toastError = vi.fn<(message: string) => void>()

vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({
      success: toastSuccess,
      info: toastInfo,
      warning: toastWarning,
      error: toastError,
    }),
  }
})

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
    unit: null,
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

const COLUMNS = [
  column(),
  column({ id: 'c2', key: 'ratio', name: '单耗', source: 'formula' }),
]

function record(over: Partial<DatasetRecord> = {}): DatasetRecord {
  return {
    row_id: 'r1',
    ts: STAMP,
    values: { kwh: 12 },
    overrides: {
      kwh: { value: 12, by: 'u9', by_name: '张工', at: STAMP, reason: null },
    },
    samples: null,
    computed: { ratio: 1 },
    compute_error: null,
    source: 'collect',
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function page(items: DatasetRecord[] = [record()]): CursorPage<DatasetRecord> {
  return { items, next: null, has_more: false }
}

function table(): DatasetTable {
  return {
    id: 't1',
    code: 'energy',
    name: '能耗台账',
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 3_600_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 2,
    created_at: STAMP,
    updated_at: STAMP,
    columns: COLUMNS,
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
  confirmSpy.mockReset().mockResolvedValue(true)
  toastSuccess.mockReset()
  toastInfo.mockReset()
  toastWarning.mockReset()
  toastError.mockReset()
  vi.spyOn(dataset, 'listDatasetRecords').mockResolvedValue(page())
  vi.spyOn(dataset, 'deleteDatasetRecord').mockResolvedValue({
    deleted_row_id: 'r1',
    has_stale_downstream: false,
  })
  vi.spyOn(dataset, 'clearDatasetRecordOverrides').mockResolvedValue({
    record: record({ overrides: null }),
    has_stale_downstream: false,
    cleared: ['kwh'],
  })
  vi.spyOn(dataset, 'recomputeDatasetTable').mockResolvedValue({
    recomputed: 12,
    failed: 0,
    is_truncated: false,
    limit: 5000,
  })
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function render(codes: string[], columns = COLUMNS) {
  signIn(codes)
  const wrapper = mount(RecordsPanel, {
    props: { table: table(), columns, busy: false },
  })
  await flushPromises()
  return wrapper
}

function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((one) => one.text().trim() === text)
}

describe('取数', () => {
  it('挂载就取第一页，按游标不按页码', async () => {
    await render(['dataset:view'])
    expect(dataset.listDatasetRecords).toHaveBeenCalledWith('t1', {
      limit: 50,
    })
  })

  it('本页的修正总数摆在工具条上：角标散在表里数不过来', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('本页有 1 格人工修正')
  })

  it('迁移带进来的那一批单列一句，免得以为有人在动数据', async () => {
    vi.mocked(dataset.listDatasetRecords).mockResolvedValue(
      page([
        record({
          overrides: {
            kwh: { value: 1, by: null, by_name: null, at: STAMP, reason: null },
          },
        }),
      ]),
    )
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('数据迁移带进来')
  })
})

describe('闸 3：三颗写动作各挂各的码', () => {
  it('只读账号一个写入口都没有', async () => {
    const wrapper = await render(['dataset:view'])
    expect(button(wrapper, '录入数据')).toBeUndefined()
    expect(button(wrapper, '批量撤销修正')).toBeUndefined()
    expect(button(wrapper, '重算公式列')).toBeUndefined()
  })

  it('录入要 dataset:record:write，批量撤销要 dataset:override', async () => {
    const write = await render(['dataset:view', 'dataset:record:write'])
    expect(button(write, '录入数据')).toBeDefined()
    expect(button(write, '批量撤销修正')).toBeUndefined()
    const override = await render(['dataset:view', 'dataset:override'])
    expect(button(override, '批量撤销修正')).toBeDefined()
  })

  it('重算与回填同码，且没有公式列就不摆这颗', async () => {
    const wrapper = await render(['dataset:view', 'dataset:backfill'])
    expect(button(wrapper, '重算公式列')).toBeDefined()
    const noFormula = await render(
      ['dataset:view', 'dataset:backfill'],
      [column()],
    )
    expect(button(noFormula, '重算公式列')).toBeUndefined()
  })

  it('一列都没有时指路去列配置，并把录入按钮禁掉', async () => {
    const wrapper = await render(['dataset:view', 'dataset:record:write'], [])
    expect(wrapper.text()).toContain('还没有列')
    expect(button(wrapper, '录入数据')?.attributes('disabled')).toBeDefined()
  })
})

describe('下游过期', () => {
  it('⚠ 横幅所有人可见，只有「立即重算」挂码', async () => {
    vi.mocked(dataset.deleteDatasetRecord).mockResolvedValue({
      deleted_row_id: 'r1',
      has_stale_downstream: true,
    })
    const wrapper = await render(['dataset:view', 'dataset:record:write'])
    await wrapper.find('[aria-label="删除数据行"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('仍是按旧数据算的')
    expect(button(wrapper, '立即重算')).toBeUndefined()
  })

  it('有重算权限的人才看得到那颗按钮', async () => {
    vi.mocked(dataset.deleteDatasetRecord).mockResolvedValue({
      deleted_row_id: 'r1',
      has_stale_downstream: true,
    })
    const wrapper = await render([
      'dataset:view',
      'dataset:record:write',
      'dataset:backfill',
    ])
    await wrapper.find('[aria-label="删除数据行"]').trigger('click')
    await flushPromises()
    expect(button(wrapper, '立即重算')).toBeDefined()
  })

  it('算干净了才放下横幅', async () => {
    vi.mocked(dataset.deleteDatasetRecord).mockResolvedValue({
      deleted_row_id: 'r1',
      has_stale_downstream: true,
    })
    const wrapper = await render([
      'dataset:view',
      'dataset:record:write',
      'dataset:backfill',
    ])
    await wrapper.find('[aria-label="删除数据行"]').trigger('click')
    await flushPromises()
    await button(wrapper, '立即重算')?.trigger('click')
    await flushPromises()
    expect(toastSuccess).toHaveBeenCalledWith('已重算 12 行')
    expect(wrapper.text()).not.toContain('仍是按旧数据算的')
  })

  it('⚠ 触顶那一次不放下横幅：没算完却收起提示等于说已经算好了', async () => {
    vi.mocked(dataset.deleteDatasetRecord).mockResolvedValue({
      deleted_row_id: 'r1',
      has_stale_downstream: true,
    })
    vi.mocked(dataset.recomputeDatasetTable).mockResolvedValue({
      recomputed: 5000,
      failed: 0,
      is_truncated: true,
      limit: 5000,
    })
    const wrapper = await render([
      'dataset:view',
      'dataset:record:write',
      'dataset:backfill',
    ])
    await wrapper.find('[aria-label="删除数据行"]').trigger('click')
    await flushPromises()
    await button(wrapper, '立即重算')?.trigger('click')
    await flushPromises()
    expect(toastWarning).toHaveBeenCalled()
    expect(wrapper.text()).toContain('仍是按旧数据算的')
  })
})

describe('删行', () => {
  it('二次确认点名是哪一刻的数据，且带上分区键 ts', async () => {
    const wrapper = await render(['dataset:view', 'dataset:record:write'])
    await wrapper.find('[aria-label="删除数据行"]').trigger('click')
    await flushPromises()
    expect(confirmSpy.mock.calls[0]?.[0].danger).toBe(true)
    expect(dataset.deleteDatasetRecord).toHaveBeenCalledWith({
      tableId: 't1',
      rowId: 'r1',
      ts: STAMP,
    })
  })

  it('点了取消就什么都不发', async () => {
    confirmSpy.mockResolvedValue(false)
    const wrapper = await render(['dataset:view', 'dataset:record:write'])
    await wrapper.find('[aria-label="删除数据行"]').trigger('click')
    await flushPromises()
    expect(dataset.deleteDatasetRecord).not.toHaveBeenCalled()
  })
})

describe('撤销单格修正', () => {
  it('⚠ 确认里不许承诺撤销后是哪个数——自动值不在任何一个响应里', async () => {
    const wrapper = await render(['dataset:view', 'dataset:override'])
    await wrapper.find('[aria-label="撤销人工修正：用电量"]').trigger('click')
    await flushPromises()
    const asked = confirmSpy.mock.calls[0]?.[0].message ?? ''
    expect(asked).toContain('可能与现在不同')
    expect(asked).toContain('会变成空')
    expect(asked).not.toContain('12')
  })

  it('撤成功后只撤那一列，并原地重取当前页', async () => {
    const wrapper = await render(['dataset:view', 'dataset:override'])
    await wrapper.find('[aria-label="撤销人工修正：用电量"]').trigger('click')
    await flushPromises()
    expect(dataset.clearDatasetRecordOverrides).toHaveBeenCalledWith(
      { tableId: 't1', rowId: 'r1', ts: STAMP },
      ['kwh'],
    )
    expect(dataset.listDatasetRecords).toHaveBeenCalledTimes(2)
  })

  it('⚠ 回执里一格都没撤不是失败：那一格早就没有修正了', async () => {
    vi.mocked(dataset.clearDatasetRecordOverrides).mockResolvedValue({
      record: record({ overrides: null }),
      has_stale_downstream: false,
      cleared: [],
    })
    const wrapper = await render(['dataset:view', 'dataset:override'])
    await wrapper.find('[aria-label="撤销人工修正：用电量"]').trigger('click')
    await flushPromises()
    expect(toastInfo).toHaveBeenCalledWith('这一格已经没有人工修正了')
    expect(toastError).not.toHaveBeenCalled()
  })
})
