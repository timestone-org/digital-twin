/** @fileoverview 指标、数据节点与页面设置的组件接线。 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DtButton, DtInput, DtSelect, DtCheckbox, DtModal } from '@dt/ui'
import * as dataset from '@/api/dataset'
import MetricPanel from '@/pages/Reports/Editor/components/MetricPanel.vue'
import NodeDialog from '@/pages/Reports/Editor/components/NodeDialog.vue'
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
  it('图表绑定选中指标的数据来源', async () => {
    const wrapper = mount(NodeDialog, {
      props: {
        modelValue: true,
        metrics: [{ name: '能耗', table: 'energy', key: 'value' }],
      },
      global: { stubs: { teleport: true } },
    })
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'bar')
    await flushPromises()
    wrapper
      .findAllComponents(DtSelect)[1]
      ?.vm.$emit('update:modelValue', '能耗')
    await flushPromises()
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '插入正文')
      ?.trigger('click')
    expect(wrapper.emitted('insert')?.[0]?.[0]).toEqual(
      expect.objectContaining({
        type: 'dsChart',
        attrs: expect.objectContaining({
          kind: 'bar',
          table: 'energy',
          keys: ['value'],
        }),
      }),
    )
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

it('条件文本表达式与数据表标题窗口都会进入节点配置', async () => {
  const wrapper = mount(NodeDialog, {
    props: {
      modelValue: true,
      metrics: [{ name: '能耗', table: 'energy', key: 'value' }],
    },
    global: { stubs: { teleport: true } },
  })
  wrapper
    .findComponent(DtInput)
    .vm.$emit('update:modelValue', "IF({本期}>{上期}, '升高', '降低')")
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '插入正文')
    ?.trigger('click')
  expect(wrapper.emitted('insert')?.[0]?.[0]).toEqual(
    expect.objectContaining({
      type: 'condText',
      attrs: expect.objectContaining({
        expr: "IF({本期}>{上期}, '升高', '降低')",
      }),
    }),
  )
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'dsTable')
  await flushPromises()
  wrapper.findAllComponents(DtSelect)[1]?.vm.$emit('update:modelValue', '能耗')

  for (const input of wrapper.findAllComponents(DtInput))
    input.vm.$emit('update:modelValue', tableInputValue(input.props('label')))
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '插入正文')
    ?.trigger('click')
  expect(wrapper.emitted('insert')?.[1]?.[0]).toEqual(
    expect.objectContaining({
      type: 'dsTable',
      attrs: expect.objectContaining({ title: '年度能耗', window: '12mo' }),
    }),
  )
  wrapper.findComponent(DtModal).vm.$emit('update:modelValue', false)
  expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  wrapper.unmount()
})

it('编辑图表保留多序列和聚合配置，取消不回写', async () => {
  const node = {
    type: 'dsChart',
    attrs: {
      title: '原图',
      kind: 'line',
      series: [
        { table: 'energy', key: 'a' },
        { table: 'energy', key: 'b' },
      ],
      agg: 'sum',
      bucket: 'day',
    },
  }
  const wrapper = mount(NodeDialog, {
    props: { modelValue: true, metrics: [], node },
    global: { stubs: { teleport: true } },
  })
  expect(
    wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '图表标题')
      ?.props('modelValue'),
  ).toBe('原图')
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'bar')
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '应用修改')
    ?.trigger('click')
  expect(wrapper.emitted('insert')?.[0]?.[0]).toMatchObject({
    type: 'dsChart',
    attrs: { ...node.attrs, kind: 'bar' },
  })
  expect(node.attrs.kind).toBe('line')
  wrapper.unmount()
})

function tableInputValue(label: string | undefined): string {
  if (label === '图表标题') return '年度能耗'
  if (label === '取数窗口') return '12mo'
  return '2'
}

it('图表可添加多序列，表格可添加同来源多列', async () => {
  const metrics = [
    { name: '电量', table: 'api:energy', key: 'power' },
    { name: '水量', table: 'api:energy', key: 'water' },
    { name: '温度', table: 'weather', key: 'temperature' },
  ]
  const wrapper = mount(NodeDialog, {
    props: { modelValue: true, metrics },
    global: { stubs: { teleport: true } },
  })
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'dsTable')
  await flushPromises()
  wrapper.findAllComponents(DtSelect)[1]?.vm.$emit('update:modelValue', '电量')
  await flushPromises()
  expect(wrapper.findAllComponents(DtCheckbox)).toHaveLength(1)
  wrapper.findComponent(DtCheckbox).vm.$emit('update:modelValue', true)
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '插入正文')
    ?.trigger('click')
  expect(wrapper.emitted('insert')?.[0]?.[0]).toMatchObject({
    type: 'dsTable',
    attrs: {
      table: 'api:energy',
      keys: ['power', 'water'],
      limit: 1000,
      window: null,
    },
  })
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

it('本期与上期图表保留各自偏移，表格只允许同窗口列', async () => {
  const metrics = [
    { name: '本期', table: 'energy', key: 'value', offset: 0 },
    { name: '上期', table: 'energy', key: 'value', offset: -1 },
  ]
  const wrapper = mount(NodeDialog, {
    props: { modelValue: true, metrics },
    global: { stubs: { teleport: true } },
  })
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'line')
  await flushPromises()
  wrapper.findAllComponents(DtSelect)[1]?.vm.$emit('update:modelValue', '本期')
  await flushPromises()
  wrapper.findComponent(DtCheckbox).vm.$emit('update:modelValue', true)
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '插入正文')
    ?.trigger('click')
  expect(wrapper.emitted('insert')?.[0]?.[0]).toMatchObject({
    attrs: {
      offset: 0,
      series: [
        { name: '本期', offset: 0 },
        { name: '上期', offset: -1 },
      ],
    },
  })
  await wrapper.setProps({ modelValue: false })
  await wrapper.setProps({ modelValue: true })
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'dsTable')
  await flushPromises()
  wrapper.findAllComponents(DtSelect)[1]?.vm.$emit('update:modelValue', '上期')
  await flushPromises()
  expect(wrapper.findAllComponents(DtCheckbox)).toHaveLength(0)
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '插入正文')
    ?.trigger('click')
  expect(wrapper.emitted('insert')?.[1]?.[0]).toMatchObject({
    attrs: { offset: -1 },
  })
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
