/**
 * @fileoverview 趋势分析页的行为契约：两个数据源各按各的读码出现、深链预选、
 * 深链指向的台账没了时只说一句而不是把整页判成失败、点位那面取数失败绝不
 * 画成一张空图，以及两面的截断提示说的是相反的那一头。
 *
 * ⚠ 「两个源的读码互不蕴含」是产品判断：只有一个码的账号该看得到自己那一半。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type {
  CollectPoint,
  DatasetSeries,
  DatasetTable,
  DatasetTableSummary,
  HistoryResult,
  Page,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as collect from '@/api/collect'
import * as dataset from '@/api/dataset'
import * as histories from '@/api/pointHistories'
import TrendPage from '@/pages/Trend/index.vue'
import { useAuthStore } from '@/stores/auth'

const query = vi.hoisted(() => {
  const holder: { value: Record<string, unknown> } = { value: {} }
  return holder
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/trend', query: query.value }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const ChartStub = {
  props: { series: { type: Array, default: () => [] } },
  template:
    '<div data-test="chart">{{ series.map((one) => one.key).join(",") }}</div>',
}

const STUBS = { DtLineChart: ChartStub }

function summary(id: string, name = '能耗台账'): DatasetTableSummary {
  return {
    id,
    code: `code-${id}`,
    name,
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 3_600_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 1,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}

function detail(id: string): DatasetTable {
  return {
    ...summary(id),
    columns: [
      {
        id: 'c1',
        table_id: id,
        key: 'power',
        name: '有功功率',
        unit: 'kW',
        decimals: 2,
        data_type: 'number',
        source: 'point',
        agg: 'avg',
        node_key: 's1:p1',
        formula: null,
        formula_deps: null,
        order_index: 0,
        is_required: false,
        default_value: null,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],
  }
}

function tablePage(items: DatasetTableSummary[]): Page<DatasetTableSummary> {
  return { items, total: items.length, page: 1, size: 200 }
}

function point(over: Partial<CollectPoint> = {}): CollectPoint {
  return {
    id: 'p1',
    source_id: 's1',
    node_key: 's1:p1',
    code: 'p1',
    name: '车间温度',
    address: 'ns=2;s=T1',
    data_type: 'float',
    unit: '℃',
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60_000,
    archive_retention_days: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function pointPage(items: CollectPoint[]): Page<CollectPoint> {
  return { items, total: items.length, page: 1, size: 50 }
}

function history(over: Partial<HistoryResult> = {}): HistoryResult {
  return {
    points: [{ t: Date.parse('2026-08-24T00:00:00.000Z'), v: 21 }],
    isTruncated: false,
    isStale: false,
    ...over,
  }
}

function series(over: Partial<DatasetSeries> = {}): DatasetSeries {
  return { series: { power: [] }, is_truncated: false, limit: 5000, ...over }
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = { permissions: codes } as never
}

beforeEach(() => {
  setActivePinia(createPinia())
  query.value = {}
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue(
    tablePage([summary('t1'), summary('t2', '水耗台账')]),
  )
  vi.spyOn(dataset, 'getDatasetTable').mockResolvedValue(detail('t1'))
  vi.spyOn(dataset, 'getDatasetSeries').mockResolvedValue(series())
  vi.spyOn(collect, 'listPoints').mockResolvedValue(pointPage([point()]))
  vi.spyOn(histories, 'fetchPointHistory').mockResolvedValue(history())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function open() {
  const wrapper = mount(TrendPage, { global: { stubs: STUBS } })
  await flushPromises()
  return wrapper
}

describe('两个数据源各按各的读码', () => {
  it('两个码都有时给出两面可切', async () => {
    signIn([PERMISSION_CODES.collectView, PERMISSION_CODES.datasetView])
    const wrapper = await open()
    expect(wrapper.text()).toContain('点位历史')
    expect(wrapper.text()).toContain('数据台账')
  })

  it('⚠ 只有采集读码时不去打台账的接口，也不摆一个点不进去的页签', async () => {
    signIn([PERMISSION_CODES.collectView])
    const wrapper = await open()
    expect(vi.mocked(dataset.listDatasetTables)).not.toHaveBeenCalled()
    expect(wrapper.find('[role="group"]').exists()).toBe(false)
  })

  it('⚠ 只有台账读码时直接落在台账那一面，不去打点位的接口', async () => {
    signIn([PERMISSION_CODES.datasetView])
    await open()
    expect(vi.mocked(collect.listPoints)).not.toHaveBeenCalled()
    expect(vi.mocked(dataset.listDatasetTables)).toHaveBeenCalledTimes(1)
  })

  it('一个码都没有时说清缺什么，而不是白页', async () => {
    signIn([])
    const wrapper = await open()
    expect(wrapper.text()).toContain('没有可看的数据源')
  })
})

describe('换数据源', () => {
  it('点另一个页签就换到那一面，并把那一面要的东西拉起来', async () => {
    signIn([PERMISSION_CODES.collectView, PERMISSION_CODES.datasetView])
    const wrapper = await open()
    expect(vi.mocked(dataset.listDatasetTables)).not.toHaveBeenCalled()
    await wrapper
      .findAll('[role="group"] button')
      .find((one) => one.text().includes('数据台账'))
      ?.trigger('click')
    await flushPromises()
    expect(vi.mocked(dataset.listDatasetTables)).toHaveBeenCalledTimes(1)
  })
})

describe('深链', () => {
  it('带着台账进来时直接落在台账那一面，并预选那一张', async () => {
    signIn([PERMISSION_CODES.collectView, PERMISSION_CODES.datasetView])
    query.value = { source: 'dataset', tableId: 't2' }
    vi.mocked(dataset.getDatasetTable).mockResolvedValue(detail('t2'))
    await open()
    expect(vi.mocked(dataset.getDatasetTable)).toHaveBeenCalledWith('t2')
  })

  it('⚠ 链接里的台账没了时只说一句，既不静默改选第一张也不判成加载失败', async () => {
    signIn([PERMISSION_CODES.datasetView])
    query.value = { source: 'dataset', tableId: 'gone' }
    const wrapper = await open()
    expect(vi.mocked(dataset.getDatasetTable)).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('不存在或已被删除')
    expect(wrapper.text()).not.toContain('加载失败')
  })

  it('没带深链时落到第一张台账，进来就有东西看', async () => {
    signIn([PERMISSION_CODES.datasetView])
    await open()
    expect(vi.mocked(dataset.getDatasetTable)).toHaveBeenCalledWith('t1')
  })

  it('深链要台账那一面但账号没有台账读码时，回落到看得见的那一面', async () => {
    signIn([PERMISSION_CODES.collectView])
    query.value = { source: 'dataset', tableId: 't1' }
    await open()
    expect(vi.mocked(dataset.listDatasetTables)).not.toHaveBeenCalled()
    expect(vi.mocked(collect.listPoints)).toHaveBeenCalledTimes(1)
  })
})

describe('点位历史那一面', () => {
  it('搜出来的点位进勾选清单，没开归档的当场标出来', async () => {
    signIn([PERMISSION_CODES.collectView])
    vi.mocked(collect.listPoints).mockResolvedValue(
      pointPage([point({ archive_enabled: false })]),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('未记录历史')
  })

  it('一条都没勾时不发请求，也不画一张会被读成「没数据」的空图', async () => {
    signIn([PERMISSION_CODES.collectView])
    const wrapper = await open()
    expect(vi.mocked(histories.fetchPointHistory)).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="chart"]').exists()).toBe(false)
  })

  it('勾一个点位再查询就画得出曲线', async () => {
    signIn([PERMISSION_CODES.collectView])
    const wrapper = await open()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper
      .findAll('button')
      .find((one) => one.text().includes('查询'))
      ?.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="chart"]').text()).toBe('s1:p1')
  })

  it('⚠ 取数失败时不画图：空图与「这段时间没采到数」长得一模一样', async () => {
    signIn([PERMISSION_CODES.collectView])
    vi.mocked(histories.fetchPointHistory).mockRejectedValue(
      new BizError(40000, '归档库连不上', 503, 'trace'),
    )
    const wrapper = await open()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper
      .findAll('button')
      .find((one) => one.text().includes('查询'))
      ?.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="chart"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('归档库连不上')
  })

  it('⚠ 触顶时说的是**更晚**那一段没画——与台账那一面正好相反', async () => {
    signIn([PERMISSION_CODES.collectView])
    vi.mocked(histories.fetchPointHistory).mockResolvedValue(
      history({ isTruncated: true }),
    )
    const wrapper = await open()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper
      .findAll('button')
      .find((one) => one.text().includes('查询'))
      ?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('更晚')
    expect(wrapper.text()).not.toContain('更早')
  })
})

describe('台账那一面的选表', () => {
  it('换一张表就取它的列，图跟着整块重建', async () => {
    signIn([PERMISSION_CODES.datasetView])
    const wrapper = await open()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await flushPromises()
    const items = document.querySelectorAll('.dt-select-menu__item')
    items[items.length - 1]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await flushPromises()
    expect(vi.mocked(dataset.getDatasetTable)).toHaveBeenLastCalledWith('t2')
  })
})

describe('点位那一面的搜索', () => {
  it('点搜索按当前关键字重搜一遍', async () => {
    signIn([PERMISSION_CODES.collectView])
    const wrapper = await open()
    await wrapper.get('input[type="text"]').setValue('温度')
    await wrapper
      .findAll('button')
      .find((one) => one.text().includes('搜索'))
      ?.trigger('click')
    await flushPromises()
    expect(vi.mocked(collect.listPoints).mock.calls.at(-1)?.[0]?.q).toBe('温度')
  })
})
