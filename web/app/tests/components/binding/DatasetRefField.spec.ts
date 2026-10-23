/** @fileoverview 台账绑定的表列选择、受控写回与异步列清单契约。 */
import type {
  BindingPayload,
  DatasetColumn,
  DatasetTableSummary,
} from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as dataset from '@/api/dataset'
import BindingSourceEditor from '@/components/binding/BindingSourceEditor.vue'

const STAMP = '2026-01-01T00:00:00Z'

function table(over: Partial<DatasetTableSummary> = {}): DatasetTableSummary {
  return {
    id: 't1',
    code: 'energy',
    name: '能源台账',
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 300_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 1,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'heat',
    name: '热量',
    unit: 'kWh',
    decimals: 2,
    data_type: 'number',
    source: 'manual',
    agg: 'last',
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

function binding(datasetKey = ''): BindingPayload {
  return {
    id: 'b1',
    nodeId: 'n1',
    fieldKey: 'value',
    sourceKind: 'dataset',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    detailJson: { datasetKey, range: { lastWindow: '7d' } },
    transformJson: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  }
}

function mountEditor(datasetKey = '') {
  const current = ref(binding(datasetKey))
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(BindingSourceEditor, {
          spec: { key: 'value', label: '数值', dataType: 'number' },
          binding: current.value,
          siblingKeys: [],
          onWrite: (next: BindingPayload) => {
            current.value = next
          },
        }),
    }),
    { global: { stubs: { teleport: true } } },
  )
  return { wrapper, current }
}

enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
    items: [table()],
    page: 1,
    size: 200,
    total: 1,
  })
  vi.spyOn(dataset, 'listDatasetColumns').mockResolvedValue([column()])
})

describe('台账表列选择', () => {
  it('从空绑定选表后显示所选表和列，选列后保留相对窗', async () => {
    const { wrapper, current } = mountEditor()
    await flushPromises()

    await wrapper
      .getComponent(DtSelect)
      .get('button[role="combobox"]')
      .trigger('click')
    await wrapper.get('[role="option"]').trigger('click')
    await flushPromises()

    expect(wrapper.getComponent(DtSelect).props('modelValue')).toBe('energy')
    const columnSelect = wrapper.findAllComponents(DtSelect).at(1)
    expect(columnSelect?.props('options')).toEqual([
      { value: 'heat', label: '热量（kWh）' },
    ])
    await columnSelect?.get('button[role="combobox"]').trigger('click')
    await wrapper.get('[role="option"]').trigger('click')
    await flushPromises()

    expect(current.value.detailJson).toEqual({
      datasetKey: 'ds:energy:heat',
      range: { lastWindow: '7d' },
    })
  })

  it('已有完整绑定回显表、列，并按台账 id 加载列', async () => {
    const { wrapper } = mountEditor('ds:energy:heat')
    await flushPromises()

    expect(
      wrapper
        .findAllComponents(DtSelect)
        .map((select) => select.props('modelValue')),
    ).toEqual(['energy', 'heat'])
    expect(wrapper.text()).toContain('热量（kWh）')
    expect(dataset.listDatasetColumns).toHaveBeenCalledWith('t1')
  })

  it('回显仅选表的草稿后仍可加载列', async () => {
    const { wrapper } = mountEditor('ds:energy:')
    await flushPromises()

    expect(wrapper.getComponent(DtSelect).props('modelValue')).toBe('energy')
    expect(wrapper.findAllComponents(DtSelect).at(1)?.props('options')).toEqual(
      [{ value: 'heat', label: '热量（kWh）' }],
    )
  })

  it('换表时立即清掉旧列，等待新表的列清单', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue({
      items: [table(), table({ id: 't2', code: 'water', name: '用水台账' })],
      page: 1,
      size: 200,
      total: 2,
    })
    const { wrapper, current } = mountEditor('ds:energy:heat')
    await flushPromises()
    let finish: ((columns: DatasetColumn[]) => void) | undefined
    vi.mocked(dataset.listDatasetColumns).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )

    wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'water')
    await flushPromises()

    expect(current.value.detailJson).toEqual({
      datasetKey: 'ds:water:',
      range: { lastWindow: '7d' },
    })
    expect(wrapper.findAllComponents(DtSelect).at(1)?.props('options')).toEqual(
      [],
    )
    finish?.([
      column({ table_id: 't2', key: 'volume', name: '水量', unit: null }),
    ])
    await flushPromises()
    expect(wrapper.findAllComponents(DtSelect).at(1)?.props('options')).toEqual(
      [{ value: 'volume', label: '水量' }],
    )
  })

  it('快速切换表时丢弃后返回的旧表列', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue({
      items: [table(), table({ id: 't2', code: 'water', name: '用水台账' })],
      page: 1,
      size: 200,
      total: 2,
    })
    let finish: ((columns: DatasetColumn[]) => void) | undefined
    vi.mocked(dataset.listDatasetColumns)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValueOnce([
        column({ table_id: 't2', key: 'volume', name: '水量', unit: null }),
      ])
    const { wrapper } = mountEditor('ds:energy:heat')
    await flushPromises()

    wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'water')
    await flushPromises()
    finish?.([column()])
    await flushPromises()

    expect(wrapper.findAllComponents(DtSelect).at(1)?.props('options')).toEqual(
      [{ value: 'volume', label: '水量' }],
    )
  })

  it('清空绑定后丢弃在途列响应', async () => {
    let finish: ((columns: DatasetColumn[]) => void) | undefined
    vi.mocked(dataset.listDatasetColumns).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { wrapper, current } = mountEditor('ds:energy:heat')
    await flushPromises()

    current.value = binding()
    await flushPromises()
    finish?.([column()])
    await flushPromises()

    expect(wrapper.findAllComponents(DtSelect).at(1)?.props('options')).toEqual(
      [],
    )
  })

  it('台账列表失败时提示错误并保留原绑定', async () => {
    vi.mocked(dataset.listDatasetTables).mockRejectedValueOnce(
      new Error('台账列表不可用'),
    )
    const { wrapper, current } = mountEditor('ds:energy:heat')
    await flushPromises()

    expect(wrapper.text()).toContain('台账清单没取到：请求失败，请重试。')
    expect(current.value.detailJson).toEqual({
      datasetKey: 'ds:energy:heat',
      range: { lastWindow: '7d' },
    })
  })

  it('列清单失败时提示错误并保留原绑定', async () => {
    vi.mocked(dataset.listDatasetColumns).mockRejectedValueOnce(
      new Error('列清单不可用'),
    )
    const { wrapper, current } = mountEditor('ds:energy:heat')
    await flushPromises()

    expect(wrapper.text()).toContain('台账清单没取到：请求失败，请重试。')
    expect(current.value.detailJson).toEqual({
      datasetKey: 'ds:energy:heat',
      range: { lastWindow: '7d' },
    })
  })

  it('空台账列表不加载列且不修改绑定', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValueOnce({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    const { wrapper, current } = mountEditor()
    await flushPromises()

    expect(wrapper.getComponent(DtSelect).props('options')).toEqual([])
    expect(dataset.listDatasetColumns).not.toHaveBeenCalled()
    expect(current.value).toEqual(binding())
  })
})
