/** @fileoverview 指标、数据节点与页面设置的组件接线。 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DtButton,
  DtCheckbox,
  DtIconButton,
  DtInput,
  DtModal,
  DtSelect,
} from '@dt/ui'
import * as dataset from '@/api/dataset'
import MetricPanel from '@/pages/Reports/Editor/components/MetricPanel.vue'
import PageDialog from '@/pages/Reports/Editor/components/PageDialog.vue'

afterEach(() => vi.restoreAllMocks())
async function openMetricForm(wrapper: VueWrapper): Promise<void> {
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '添加指标')
    ?.trigger('click')
}
it('指标表单默认收起，点击添加才展开', async () => {
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
    items: [],
    page: 1,
    size: 200,
    total: 0,
  })
  const wrapper = mount(MetricPanel, {
    props: { modelValue: [], disabled: false },
  })
  await flushPromises()
  expect(wrapper.findAllComponents(DtInput)).toHaveLength(0)
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '添加指标')
    ?.trigger('click')
  expect(
    wrapper
      .findAllComponents(DtInput)
      .some((input) => input.props('label') === '指标名称'),
  ).toBe(true)
  wrapper.unmount()
})
describe('报告配置交互', () => {
  it('派生指标可添加并插入正文', async () => {
    vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    const wrapper = mount(MetricPanel, {
      props: { modelValue: [], disabled: false },
    })
    await flushPromises()
    await openMetricForm(wrapper)
    wrapper.findComponent(DtInput).vm.$emit('update:modelValue', '变化')
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'expr')
    await flushPromises()
    wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '指标表达式')
      ?.vm.$emit('update:modelValue', '100-80')
    await wrapper.findComponent(DtButton).trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
      expect.objectContaining({ name: '变化', mode: 'expr', expr: '100-80' }),
    ])
    wrapper.unmount()
  })
  it('纸张设置使用厘米并保留页眉页脚', async () => {
    const wrapper = mount(PageDialog, {
      props: {
        modelValue: false,
        page: {
          margins_cm: { left: 2, right: 2 },
          header: '页眉',
          footer: '页脚',
          orientation: 'landscape',
          watermark: { text: '内部资料', font_size_pt: 18, rotation: -35 },
        },
      },
      global: { stubs: { teleport: true } },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '应用')
      ?.trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual(
      expect.objectContaining({
        orientation: 'landscape',
        header: '页眉',
        footer: '页脚',
        margins_cm: expect.objectContaining({ left: 2, right: 2 }),
        watermark: {
          text: '内部资料',
          font_size_pt: 18,
          rotation: -35,
        },
      }),
    )
    wrapper.unmount()
  })
})

it('页面设置的每个字段都能实际修改', async () => {
  const wrapper = mount(PageDialog, {
    props: { modelValue: false, page: {} },
    global: { stubs: { teleport: true } },
  })
  await wrapper.setProps({ modelValue: true })
  const values: Record<string, string> = {
    '上边距（厘米）': '1',
    '下边距（厘米）': '2',
    '左边距（厘米）': '3',
    '右边距（厘米）': '4',
    '正文字号（磅）': '14',
    页眉: '新的页眉',
    页脚: '新的页脚',
    水印文字: '内部资料',
  }
  for (const input of wrapper.findAllComponents(DtInput))
    input.vm.$emit(
      'update:modelValue',
      values[input.props('label') ?? ''] ?? '',
    )
  for (const select of wrapper.findAllComponents(DtSelect))
    select.vm.$emit(
      'update:modelValue',
      select.props('label') === '纸张' ? 'A3' : 'landscape',
    )
  wrapper.findComponent(DtCheckbox).vm.$emit('update:modelValue', true)
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '应用')
    ?.trigger('click')
  expect(wrapper.emitted('save')?.[0]?.[0]).toEqual(
    expect.objectContaining({
      size: 'A3',
      orientation: 'landscape',
      font_size_pt: 14,
      is_toc_enabled: true,
      header: '新的页眉',
      footer: '新的页脚',
      watermark: { text: '内部资料' },
      margins_cm: { top: 1, bottom: 2, left: 3, right: 4 },
    }),
  )
  wrapper.findComponent(DtModal).vm.$emit('update:modelValue', false)
  expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  wrapper.unmount()
})

it('已有指标可编辑并保留正文引用名称', async () => {
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
    items: [],
    page: 1,
    size: 200,
    total: 0,
  })
  const wrapper = mount(MetricPanel, {
    props: {
      modelValue: [{ name: '同比', mode: 'expr', expr: '20' }],
      disabled: false,
    },
  })
  await flushPromises()
  await wrapper.get('[aria-label="编辑指标 同比"]').trigger('click')
  wrapper
    .findAllComponents(DtInput)
    .find((input) => input.props('label') === '指标表达式')
    ?.vm.$emit('update:modelValue', '40')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '保存指标修改')
    ?.trigger('click')
  expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
    expect.objectContaining({ name: '同比', expr: '40' }),
  ])
  wrapper.unmount()
})

it('API 文本字段自动使用最新值并隐藏数值聚合', async () => {
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 200,
  })
  const wrapper = mount(MetricPanel, {
    props: {
      modelValue: [],
      disabled: false,
      apiSources: [
        {
          code: 'status',
          name: '运行状态',
          connection: 'ems',
          path: '/status',
          columns: [
            {
              key: 'label',
              name: '状态',
              pointer: '/label',
              data_type: 'text',
            },
          ],
        },
      ],
    },
  })
  await flushPromises()
  await openMetricForm(wrapper)
  wrapper
    .findAllComponents(DtSelect)
    .find((select) => select.props('label') === '数据来源')
    ?.vm.$emit('update:modelValue', 'api:status')
  await flushPromises()
  wrapper
    .findAllComponents(DtSelect)
    .find((select) => select.props('label') === '数据字段')
    ?.vm.$emit('update:modelValue', 'label')
  await flushPromises()
  const modeSelect = wrapper
    .findAllComponents(DtSelect)
    .find((select) => select.props('label') === '取数方式')
  expect(modeSelect?.props('modelValue')).toBe('latest')
  expect(modeSelect?.props('options')).not.toContainEqual(
    expect.objectContaining({ value: 'sum' }),
  )
  wrapper.unmount()
})

function setMetricSelect(
  wrapper: VueWrapper,
  label: string,
  value: string,
): void {
  wrapper
    .findAllComponents(DtSelect)
    .find((select) => select.props('label') === label)
    ?.vm.$emit('update:modelValue', value)
}
function setMetricInput(
  wrapper: VueWrapper,
  label: string,
  value: string,
): void {
  wrapper
    .findAllComponents(DtInput)
    .find((input) => input.props('label') === label)
    ?.vm.$emit('update:modelValue', value)
}
it('API 数值指标保存聚合口径，支持取消编辑和删除', async () => {
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 200,
  })
  const wrapper = mount(MetricPanel, {
    props: {
      modelValue: [],
      disabled: false,
      apiSources: [
        {
          code: 'energy',
          name: '能耗',
          connection: 'ems',
          path: '/monthly',
          columns: [{ key: 'value', name: '电量', pointer: '/value' }],
        },
      ],
    },
  })
  await flushPromises()
  await openMetricForm(wrapper)
  setMetricSelect(wrapper, '数据来源', 'api:energy')
  await flushPromises()
  setMetricSelect(wrapper, '数据字段', 'value')
  setMetricSelect(wrapper, '取数方式', 'sum')
  setMetricInput(wrapper, '指标名称', '用电量')
  setMetricInput(wrapper, '单位（可选）', 'kWh')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '添加指标')
    ?.trigger('click')
  const metrics = [
    {
      name: '用电量',
      table: 'api:energy',
      key: 'value',
      mode: 'window_agg',
      agg: 'sum',
      offset: 0,
      expr: null,
      unit: 'kWh',
      window: null,
      anchor: 'period',
    },
  ]
  expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual(metrics)
  await wrapper.setProps({
    modelValue: metrics.map((metric) => ({
      ...metric,
      mode: 'window_agg',
      agg: 'sum',
      anchor: 'period',
    })),
  })
  await wrapper.get('[aria-label="编辑指标 用电量"]').trigger('click')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '取消编辑')
    ?.trigger('click')
  expect(
    wrapper
      .findAllComponents(DtButton)
      .some((button) => button.text() === '保存指标修改'),
  ).toBe(false)
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '插入')
    ?.trigger('click')
  expect(wrapper.emitted('insert')?.[0]?.[0]).toBe('{用电量}')
  await wrapper.get('[aria-label="移除指标 用电量"]').trigger('click')
  expect(wrapper.emitted('update:modelValue')?.[1]?.[0]).toEqual([])
  wrapper.unmount()
})

it('⚠ 页面设置的数字不合法时拦在弹窗里，不发出去', async () => {
  const wrapper = mount(PageDialog, {
    props: { modelValue: false, page: {} },
    global: { stubs: { teleport: true } },
  })
  await wrapper.setProps({ modelValue: true })
  const field = (label: string) =>
    wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === label)
  field('上边距（厘米）')?.vm.$emit('update:modelValue', 'abc')
  field('正文字号（磅）')?.vm.$emit('update:modelValue', '')
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '应用')
    ?.trigger('click')
  expect(wrapper.emitted('save')).toBeUndefined()
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  expect(field('上边距（厘米）')?.props('error')).toBeTruthy()
  expect(field('正文字号（磅）')?.props('error')).toBeTruthy()
  wrapper.unmount()
})

it('工具栏设过自定义纸张时，纸张一栏照实显示「自定义」', async () => {
  const wrapper = mount(PageDialog, {
    props: { modelValue: false, page: { size: 'custom' } },
    global: { stubs: { teleport: true } },
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  const paper = wrapper
    .findAllComponents(DtSelect)
    .find((select) => select.props('label') === '纸张')
  const options: unknown = paper?.props('options')
  expect(JSON.stringify(options)).toContain('custom')
  expect(paper?.props('modelValue')).toBe('custom')
  wrapper.unmount()
})

describe('指标面板的复位与说明', () => {
  const apiSource = {
    code: 'energy',
    name: '能管接口',
    connection: 'ems',
    method: 'GET' as const,
    path: '/monthly',
    query: {},
    columns: [{ key: 'value', name: '用电量', pointer: '/value' }],
    offset: 0,
  }
  const apiMetric = {
    name: '用电环比',
    table: 'api:energy',
    key: 'value',
    mode: 'expr' as const,
    expr: '{a}-{b}',
  }

  it('⚠ 编辑过一条再点「添加指标」，来源、字段、方式、偏移都回到初值', async () => {
    vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    const wrapper = mount(MetricPanel, {
      props: {
        modelValue: [{ ...apiMetric, mode: 'latest' as const, offset: -1 }],
        disabled: false,
        apiSources: [apiSource],
      },
    })
    await flushPromises()
    await wrapper
      .findAllComponents(DtIconButton)
      .find((button) => button.props('label') === '编辑指标 用电环比')
      ?.find('button')
      .trigger('click')
    await flushPromises()
    expect(
      wrapper
        .findAllComponents(DtSelect)
        .find((item) => item.props('label') === '数据来源')
        ?.props('modelValue'),
    ).toBe('api:energy')
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '取消编辑')
      ?.trigger('click')
    await openMetricForm(wrapper)
    await flushPromises()
    const select = (label: string) =>
      wrapper
        .findAllComponents(DtSelect)
        .find((item) => item.props('label') === label)
    expect(select('取数方式')?.props('modelValue')).toBe('window_agg')
    expect(select('数据来源')?.props('modelValue')).toBe('')
    expect(select('数据字段')?.props('modelValue')).toBe('')
    expect(
      wrapper
        .findAllComponents(DtInput)
        .find((item) => item.props('label') === '报告期偏移')
        ?.props('modelValue'),
    ).toBe('0')
    wrapper.unmount()
  })

  it('列表里说出报告期偏移与单位，本期与上期不再读成同一条', async () => {
    vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    const wrapper = mount(MetricPanel, {
      props: {
        modelValue: [
          { name: '本期电', table: 'ledger', key: 'value', unit: 'kWh' },
          {
            name: '上期电',
            table: 'ledger',
            key: 'value',
            offset: -1,
            unit: 'kWh',
          },
        ],
        disabled: false,
        apiSources: [apiSource],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('本期 · kWh')
    expect(wrapper.text()).toContain('上期 · kWh')
    wrapper.unmount()
  })
})
