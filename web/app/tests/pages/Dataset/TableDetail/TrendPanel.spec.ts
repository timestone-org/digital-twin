/**
 * @fileoverview 台账「趋势」分区的行为契约：只有数值列画得出、进来就有曲线、
 * **勾了没重查的列绝不画成空曲线**、截断要说清砍掉的是哪一头、取数失败不画图、
 * 换台账整块重建，以及跳去趋势分析页的深链带着这张台账。
 *
 * ⚠ 折线图打桩打在 DtLineChart 这个组件缝上：图表自己的实例生命周期由
 * `@dt/ui` 的用例守，这里只关心分区往图里喂了什么。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetColumn, DatasetSeries, DatasetTable } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as dataset from '@/api/dataset'
import TrendPanel from '@/pages/Dataset/TableDetail/components/TrendPanel.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/datasets/t1/trend', query: {} }),
  RouterLink: {
    props: ['to'],
    template:
      '<a data-test="deep-link" :data-path="to.path" :data-table="to.query.tableId"><slot /></a>',
  },
}))

function column(key: string, over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: `id-${key}`,
    table_id: 't1',
    key,
    name: key.toUpperCase(),
    unit: 'kW',
    decimals: 2,
    data_type: 'number',
    source: 'point',
    agg: 'avg',
    node_key: `s1:${key}`,
    formula: null,
    formula_deps: null,
    order_index: 0,
    is_required: false,
    default_value: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function table(id = 't1'): DatasetTable {
  return {
    id,
    code: `code-${id}`,
    name: '能耗台账',
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 3_600_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    columns: [],
  }
}

function series(over: Partial<DatasetSeries> = {}): DatasetSeries {
  return {
    series: { a: [{ ts: '2026-08-24T00:00:00.000Z', value: 1 }] },
    is_truncated: false,
    limit: 5000,
    ...over,
  }
}

// ⚠ 真 DtLineChart 会动态 import echarts，而 happy-dom 拿不到 canvas 上下文。
// 把喂进去的系列 key 直接吐到 DOM 上，才断言得出「哪几条真的画了」
const ChartStub = {
  props: { series: { type: Array, default: () => [] } },
  template:
    '<div data-test="chart">{{ series.map((one) => one.key).join(",") }}</div>',
}

const STUBS = { DtLineChart: ChartStub }

const NUMERIC = [column('a'), column('b'), column('c'), column('d')]

beforeEach(() => {
  vi.spyOn(dataset, 'getDatasetSeries').mockResolvedValue(series())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

function render(columns: readonly DatasetColumn[] = NUMERIC, id = 't1') {
  return mount(TrendPanel, {
    props: { table: table(id), columns, busy: false },
    global: { stubs: STUBS },
  })
}

async function open(columns: readonly DatasetColumn[] = NUMERIC, id = 't1') {
  const wrapper = render(columns, id)
  await flushPromises()
  return wrapper
}

function labels(wrapper: ReturnType<typeof render>): string[] {
  return wrapper.findAll('.dt-checkbox__label').map((one) => one.text())
}

function chartKeys(wrapper: ReturnType<typeof render>): string {
  return wrapper.get('[data-test="chart"]').text()
}

describe('画哪些列', () => {
  it('只有数值列进勾选清单：文本列画不出曲线', async () => {
    const wrapper = await open([
      column('a'),
      column('note', { data_type: 'string' }),
    ])
    expect(labels(wrapper)).toEqual(['A（kW）'])
  })

  it('一列数值列都没有时明说画不了，并指路去配列', async () => {
    const wrapper = await open([column('note', { data_type: 'string' })])
    expect(wrapper.text()).toContain('没有可画的量')
    expect(wrapper.text()).toContain('数值类型')
  })

  it('进来就已经勾上前几列并取过数，不是一张空图', async () => {
    await open()
    expect(vi.mocked(dataset.getDatasetSeries)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dataset.getDatasetSeries).mock.calls[0]?.[1]).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('勾选与取数不同步这件事', () => {
  it('⚠ 新勾的列在重查之前不进图——绝不画一条会被读成「没数据」的空曲线', async () => {
    const wrapper = await open()
    await wrapper.findAll('input[type="checkbox"]')[3]?.setValue(true)
    await flushPromises()
    expect(chartKeys(wrapper)).toBe('a')
    expect(chartKeys(wrapper)).not.toContain('d')
  })

  it('新勾的列会明说「点查询刷新曲线」，而不是静悄悄地不画', async () => {
    const wrapper = await open()
    await wrapper.findAll('input[type="checkbox"]')[3]?.setValue(true)
    await flushPromises()
    expect(wrapper.text()).toContain('点「查询」刷新曲线')
  })

  it('重查之后那条提示消失，新列也进了图', async () => {
    const wrapper = await open()
    await wrapper.findAll('input[type="checkbox"]')[3]?.setValue(true)
    vi.mocked(dataset.getDatasetSeries).mockResolvedValue(
      series({ series: { a: [], b: [], c: [], d: [] } }),
    )
    const query = wrapper
      .findAll('button')
      .find((one) => one.text().includes('查询'))
    await query?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('点「查询」刷新曲线')
    expect(chartKeys(wrapper)).toContain('d')
  })
})

describe('截断', () => {
  it('⚠ 触顶时说清砍掉的是**更早**那一段，并给出怎么看到它', async () => {
    vi.mocked(dataset.getDatasetSeries).mockResolvedValue(
      series({ is_truncated: true, limit: 5000 }),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('更早')
    expect(wrapper.text()).toContain('5000')
    expect(wrapper.text()).toContain('缩小')
  })

  it('没触顶时不说这句话', async () => {
    const wrapper = await open()
    expect(wrapper.text()).not.toContain('更早')
  })
})

describe('取数失败', () => {
  it('⚠ 失败时不画图：一张空图与「这段时间确实没数据」长得一模一样', async () => {
    vi.mocked(dataset.getDatasetSeries).mockRejectedValue(
      new BizError(40000, '归档库连不上', 503, 'trace'),
    )
    const wrapper = await open()
    expect(wrapper.find('[data-test="chart"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('归档库连不上')
  })
})

describe('换台账', () => {
  it('⚠ 整块按 tableId 重建：新表重新播种勾选，不留上一张表的曲线', async () => {
    const wrapper = await open()
    await wrapper.setProps({
      table: table('t2'),
      columns: [column('x'), column('y')],
    })
    await flushPromises()
    const calls = vi.mocked(dataset.getDatasetSeries).mock.calls
    expect(calls[calls.length - 1]?.[0]).toBe('t2')
    expect(calls[calls.length - 1]?.[1]).toEqual(['x', 'y'])
  })
})

describe('跳去趋势分析页', () => {
  it('深链带着这张台账，且地址由共用的构造函数产出', async () => {
    const wrapper = await open()
    const link = wrapper.get('[data-test="deep-link"]')
    expect(link.attributes('data-path')).toBe('/trend')
    expect(link.attributes('data-table')).toBe('t1')
  })
})

describe('时间范围', () => {
  it('换一档范围再查，发出去的就是那一档的窗口', async () => {
    const wrapper = await open()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await flushPromises()
    document
      .querySelectorAll('.dt-select-menu__item')[0]
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((one) => one.text().includes('查询'))
      ?.trigger('click')
    await flushPromises()
    const range = vi.mocked(dataset.getDatasetSeries).mock.calls.at(-1)?.[2]
    expect(
      Date.parse(range?.until ?? '') - Date.parse(range?.since ?? ''),
    ).toBe(3_600_000)
  })
})

describe('自定义范围', () => {
  async function pickCustom(wrapper: ReturnType<typeof render>) {
    await wrapper.get('.dt-select__trigger').trigger('click')
    await flushPromises()
    const items = document.querySelectorAll('.dt-select-menu__item')
    items[items.length - 1]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await flushPromises()
  }

  it('两端都填上之后按填的那一段取数', async () => {
    const wrapper = await open()
    await pickCustom(wrapper)
    const fields = wrapper.findAll('input[type="datetime-local"]')
    await fields[0]?.setValue('2026-08-01T00:00')
    await fields[1]?.setValue('2026-08-02T00:00')
    await wrapper
      .findAll('button')
      .find((one) => one.text().includes('查询'))
      ?.trigger('click')
    await flushPromises()
    const range = vi.mocked(dataset.getDatasetSeries).mock.calls.at(-1)?.[2]
    expect(
      Date.parse(range?.until ?? '') - Date.parse(range?.since ?? ''),
    ).toBe(86_400_000)
  })

  it('⚠ 只填了一端时按钮点不动，本地就看得出的错不占一次往返', async () => {
    const wrapper = await open()
    await pickCustom(wrapper)
    await wrapper
      .findAll('input[type="datetime-local"]')[0]
      ?.setValue('2026-08-01T00:00')
    const query = wrapper
      .findAll('button')
      .find((one) => one.text().includes('查询'))
    expect(query?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('开始与结束')
  })
})

describe('台账还没取回来时', () => {
  it('不画图也不给一个指向空 id 的深链', () => {
    const wrapper = mount(TrendPanel, {
      props: { table: null, columns: [], busy: false },
      global: { stubs: STUBS },
    })
    expect(wrapper.find('[data-test="chart"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="deep-link"]').exists()).toBe(false)
  })
})
