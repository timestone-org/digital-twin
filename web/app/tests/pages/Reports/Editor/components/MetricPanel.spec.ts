/** @fileoverview 指标多时列表的检索、分批显示，以及编辑表单以弹窗打开。 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DtButton, DtInput, DtSelect } from '@dt/ui'
import type { ReportMetric } from '@dt/contracts'
import * as dataset from '@/api/dataset'
import MetricPanel from '@/pages/Reports/Editor/components/MetricPanel.vue'

const apiSource = {
  code: 'ems',
  name: '能管',
  connection: 'ems_local',
  method: 'GET' as const,
  path: '/api/ems/local/DPResultData/1',
  query: {},
  columns: Array.from({ length: 120 }, (_, index) => ({
    key: `item_${index + 1}`,
    name: `第${index + 1}项`,
    pointer: `/${index}`,
    data_type: 'text' as const,
  })),
  offset: 0,
}
const metrics: ReportMetric[] = apiSource.columns.map((column) => ({
  name: `能管_${column.name}`,
  table: 'api:ems',
  key: column.key,
  mode: 'latest',
  agg: 'avg',
  offset: 0,
}))

beforeEach(() => {
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
    items: [],
    page: 1,
    size: 200,
    total: 0,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

async function mountPanel(): Promise<VueWrapper> {
  const wrapper = mount(MetricPanel, {
    attachTo: document.body,
    props: { modelValue: metrics, disabled: false, apiSources: [apiSource] },
  })
  await flushPromises()
  return wrapper
}
const editButtons = (): NodeListOf<Element> =>
  document.querySelectorAll('[aria-label^="编辑指标 "]')

it('⚠ 指标很多时点编辑，表单以弹窗打开且带出原来源与字段', async () => {
  const wrapper = await mountPanel()
  await wrapper.get('[aria-label="编辑指标 能管_第1项"]').trigger('click')
  await flushPromises()
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog?.getAttribute('aria-label')).toBe('编辑指标 · 能管_第1项')
  const select = (label: string) =>
    wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === label)
  expect(select('数据来源')?.props('modelValue')).toBe('api:ems')
  expect(select('数据字段')?.props('modelValue')).toBe('item_1')
  expect(select('取数方式')?.props('modelValue')).toBe('latest')
  wrapper.unmount()
})

it('保存修改只替换被编辑那一条并关闭弹窗', async () => {
  const wrapper = await mountPanel()
  await wrapper.get('[aria-label="编辑指标 能管_第2项"]').trigger('click')
  await flushPromises()
  wrapper
    .findAllComponents(DtInput)
    .find((input) => input.props('label') === '单位（可选）')
    ?.vm.$emit('update:modelValue', 'kWh')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '保存指标修改')
    ?.trigger('click')
  await flushPromises()
  const saved = wrapper.emitted('update:modelValue')?.[0]?.[0] as
    ReportMetric[] | undefined
  expect(saved).toHaveLength(metrics.length)
  expect(saved?.[1]).toEqual(
    expect.objectContaining({ name: '能管_第2项', key: 'item_2', unit: 'kWh' }),
  )
  expect(saved?.[0]).toEqual(metrics[0])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  wrapper.unmount()
})

it('列表每批只渲染 50 条，可继续展开', async () => {
  const wrapper = await mountPanel()
  expect(editButtons()).toHaveLength(50)
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text().startsWith('再显示 50 条'))
    ?.trigger('click')
  expect(editButtons()).toHaveLength(100)
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text().startsWith('再显示 20 条'))
    ?.trigger('click')
  expect(editButtons()).toHaveLength(120)
  expect(wrapper.text()).not.toContain('再显示')
  wrapper.unmount()
})

it('检索按名称或字段过滤，命中排在后面的也能直接编辑', async () => {
  const wrapper = await mountPanel()
  const search = wrapper.get('input[aria-label="检索指标"]')
  await search.setValue('item_110')
  expect(editButtons()).toHaveLength(1)
  expect(wrapper.text()).toContain('匹配 1 条')
  await search.setValue('不存在')
  expect(editButtons()).toHaveLength(0)
  expect(wrapper.text()).toContain('没有匹配的指标')
  wrapper.unmount()
})
