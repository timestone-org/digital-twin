/** @fileoverview 指标、数据节点与页面设置的组件接线。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DtButton, DtInput, DtSelect, DtCheckbox, DtModal } from '@dt/ui'
import * as dataset from '@/api/dataset'
import MetricPanel from '@/pages/Reports/Editor/components/MetricPanel.vue'
import NodeDialog from '@/pages/Reports/Editor/components/NodeDialog.vue'
import PageDialog from '@/pages/Reports/Editor/components/PageDialog.vue'

afterEach(() => vi.restoreAllMocks())
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
    wrapper.findComponent(DtInput).vm.$emit('update:modelValue', '变化')
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'expr')
    await flushPromises()
    const inputs = wrapper.findAllComponents(DtInput)
    inputs.at(-1)?.vm.$emit('update:modelValue', '100-80')
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
    input.vm.$emit(
      'update:modelValue',
      input.props('label') === '图表标题' ? '年度能耗' : '12mo',
    )
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
