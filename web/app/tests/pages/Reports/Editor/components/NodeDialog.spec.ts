/** @fileoverview 数据内容弹窗：直接选台账或 API 来源与字段，横轴与展示选项进入节点属性。 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  DtButton,
  DtCheckbox,
  DtInput,
  DtModal,
  DtSegmented,
  DtSelect,
} from '@dt/ui'
import type {
  DatasetColumn,
  DatasetTableSummary,
  ReportBody,
} from '@dt/contracts'
import * as dataset from '@/api/dataset'
import NodeDialog from '@/pages/Reports/Editor/components/NodeDialog.vue'

const API_SOURCES: NonNullable<ReportBody['api_sources']> = [
  {
    code: 'energy',
    name: '能耗',
    connection: 'ems',
    path: '/energy',
    columns: [
      { key: 'shop', name: '车间', pointer: '/s', data_type: 'text' },
      { key: 'power', name: '用电', pointer: '/p', data_type: 'number' },
      { key: 'water', name: '用水', pointer: '/w', data_type: 'number' },
    ],
  },
]

const STAMP = '2026-09-01T00:00:00Z'
function table(): DatasetTableSummary {
  return {
    id: 't1',
    code: 'energy',
    name: '能耗台账',
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 300_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 2,
    created_at: STAMP,
    updated_at: STAMP,
  }
}
function column(key: string, name: string): DatasetColumn {
  return {
    id: key,
    table_id: 't1',
    key,
    name,
    unit: null,
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
  }
}

beforeEach(() => {
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
    items: [],
    page: 1,
    size: 200,
    total: 0,
  })
})
afterEach(() => vi.restoreAllMocks())

function open(props: Record<string, unknown> = {}): VueWrapper {
  return mount(NodeDialog, {
    props: { modelValue: true, metrics: [], apiSources: API_SOURCES, ...props },
    global: { stubs: { teleport: true } },
  })
}
function select(wrapper: VueWrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .filter((item) => item.props('label') === label)
  if (!found.length) throw new Error(`没有「${label}」下拉`)
  return found
}
async function choose(
  wrapper: VueWrapper,
  label: string,
  value: string,
  index = 0,
) {
  select(wrapper, label)[index]?.vm.$emit('update:modelValue', value)
  await flushPromises()
}
async function kind(wrapper: VueWrapper, value: string): Promise<void> {
  wrapper.findComponent(DtSegmented).vm.$emit('update:modelValue', value)
  await flushPromises()
}
function button(wrapper: VueWrapper, label: string) {
  return wrapper
    .findAllComponents(DtButton)
    .find((item) => item.text() === label)
}
function values(options: unknown): unknown[] {
  return Array.isArray(options)
    ? options.map((option: unknown) =>
        option !== null && typeof option === 'object' && 'value' in option
          ? option.value
          : undefined,
      )
    : []
}
function inserted(wrapper: VueWrapper, index = 0): unknown {
  return wrapper.emitted('insert')?.[index]?.[0]
}

it('选 API 来源即带出首个数值字段，可再添加序列并插入时间趋势图', async () => {
  const wrapper = open()
  await kind(wrapper, 'bar')
  await choose(wrapper, '数据来源', 'api:energy')
  expect(select(wrapper, '字段')[0]?.props('modelValue')).toBe('power')
  expect(values(select(wrapper, '字段')[0]?.props('options'))).toEqual([
    'power',
    'water',
  ])
  await button(wrapper, '添加序列')?.trigger('click')
  await flushPromises()
  await button(wrapper, '插入正文')?.trigger('click')
  expect(inserted(wrapper)).toMatchObject({
    type: 'dsChart',
    attrs: {
      kind: 'bar',
      x_axis: 'time',
      offset: 0,
      window: null,
      series: [
        { table: 'api:energy', key: 'power', offset: 0 },
        { table: 'api:energy', key: 'water', offset: 0 },
      ],
    },
  })
  expect(
    wrapper.findAll('label').some((item) => item.text() === '报告期'),
  ).toBe(false)
  wrapper.unmount()
})

it('饼图自动改为按数据字段展示，列表型接口一步出图', async () => {
  const wrapper = open()
  await choose(wrapper, '数据来源', 'api:energy')
  await kind(wrapper, 'pie')
  expect(select(wrapper, '横轴')[0]?.props('modelValue')).toBe('field')
  await button(wrapper, '添加数据项')?.trigger('click')
  await flushPromises()
  await button(wrapper, '插入正文')?.trigger('click')
  expect(inserted(wrapper)).toMatchObject({
    type: 'dsChart',
    attrs: { kind: 'pie', x_axis: 'field', category_key: '' },
  })
  wrapper.unmount()
})

it('按分类展示必须先选分类字段，未选时说明原因并禁止插入', async () => {
  const wrapper = open()
  await choose(wrapper, '数据来源', 'api:energy')
  await choose(wrapper, '横轴', 'category')
  expect(wrapper.text()).toContain('请选择横轴的分类字段')
  expect(button(wrapper, '插入正文')?.props('disabled')).toBe(true)
  expect(values(select(wrapper, '分类字段')[0]?.props('options'))).toContain(
    'shop',
  )
  await choose(wrapper, '分类字段', 'shop')
  await choose(wrapper, '聚合方式', 'sum')
  await button(wrapper, '插入正文')?.trigger('click')
  expect(inserted(wrapper)).toMatchObject({
    attrs: { x_axis: 'category', category_key: 'shop', agg: 'sum' },
  })
  wrapper.unmount()
})

it('条件文本可点选指标与常用写法，不必手敲花括号', async () => {
  const wrapper = open({
    metrics: [
      { name: '本期', table: 'energy', key: 'value' },
      { name: '上期', table: 'energy', key: 'value', offset: -1 },
    ],
  })
  await kind(wrapper, 'condText')
  await button(wrapper, '升高 / 降低')?.trigger('click')
  await flushPromises()
  expect(
    wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '表达式')
      ?.props('modelValue'),
  ).toBe("IF({本期}>{上期}, '升高', '降低')")
  await kind(wrapper, 'metricRef')
  wrapper
    .findAllComponents(DtInput)
    .find((input) => input.props('label') === '表达式')
    ?.vm.$emit('update:modelValue', '')
  await flushPromises()
  await button(wrapper, '本期')?.trigger('click')
  await flushPromises()
  await button(wrapper, '插入正文')?.trigger('click')
  expect(inserted(wrapper)).toMatchObject({
    type: 'metricRef',
    attrs: { expr: '{本期}', precision: 2 },
  })
  wrapper.unmount()
})

it('台账表格按 code 引用，目录晚到也会补拉列清单并带上汇总与报告期', async () => {
  let release: () => void = () => undefined
  vi.mocked(dataset.listDatasetTables).mockReturnValue(
    new Promise((resolve) => {
      release = () =>
        resolve({ items: [table()], page: 1, size: 200, total: 1 })
    }),
  )
  const columns = vi
    .spyOn(dataset, 'listDatasetColumns')
    .mockResolvedValue([column('e', '电量'), column('w', '水量')])
  const wrapper = open({
    node: { type: 'dsTable', attrs: { table: 'energy', keys: ['e'] } },
  })
  await flushPromises()
  expect(columns).not.toHaveBeenCalled()
  release()
  await flushPromises()
  expect(columns).toHaveBeenCalledWith('t1')
  const boxes = wrapper.findAllComponents(DtCheckbox)
  expect(boxes.map((box) => box.props('label'))).toEqual(['电量', '水量'])
  boxes[1]?.vm.$emit('update:modelValue', true)
  await choose(wrapper, '表末汇总行', 'sum')
  await choose(wrapper, '报告期', '-1')
  await button(wrapper, '应用修改')?.trigger('click')
  expect(inserted(wrapper)).toMatchObject({
    type: 'dsTable',
    attrs: { table: 'energy', keys: ['e', 'w'], summary: 'sum', offset: -1 },
  })
  wrapper.unmount()
})

it('编辑既有图表保留其余属性，节点级偏移并入各序列，取消不回写', async () => {
  const node = {
    type: 'dsChart',
    attrs: {
      title: '原图',
      kind: 'line',
      offset: -1,
      render: 'raster',
      series: [
        { table: 'energy', key: 'a', offset: 0 },
        { table: 'energy', key: 'b', offset: -12 },
      ],
      agg: 'sum',
      bucket: 'day',
    },
  }
  const wrapper = open({ node })
  expect(values(wrapper.findComponent(DtSegmented).props('options'))).toEqual([
    'line',
    'bar',
    'pie',
  ])
  await kind(wrapper, 'bar')
  await button(wrapper, '应用修改')?.trigger('click')
  expect(inserted(wrapper)).toMatchObject({
    type: 'dsChart',
    attrs: {
      kind: 'bar',
      render: 'raster',
      agg: 'sum',
      bucket: 'day',
      offset: 0,
      series: [
        { key: 'a', offset: -1 },
        { key: 'b', offset: -13 },
      ],
    },
  })
  expect(node.attrs.kind).toBe('line')
  wrapper.findComponent(DtModal).vm.$emit('update:modelValue', false)
  expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  wrapper.unmount()
})
