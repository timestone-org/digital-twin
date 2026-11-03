/** @fileoverview 有序列参数在真实配置窗口中可见、可调整，普通多选保持台账顺序。 */
import type { ModelingGraphNode, ModelingOperator } from '@dt/contracts'
import { DtCheckbox } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ColumnPicker from '@/pages/Modeling/Canvas/components/ColumnPicker.vue'
import ConfigEditorDialog from '@/pages/Modeling/Canvas/components/ConfigEditorDialog.vue'
import { fieldsOf } from '@/pages/Modeling/Canvas/scripts/schemaForm'

const columns = [
  { key: 'F1', name: '车间' },
  { key: 'F2', name: '设备' },
  { key: 'F3', name: '能耗' },
]
const schema = {
  properties: {
    columns: {
      type: 'array',
      title: '排序列',
      items: { type: 'string' },
      default: [],
      'x-dt-widget': 'column',
      'x-dt-ordered': true,
    },
  },
}
const operator: ModelingOperator = {
  code: 'sort_rows',
  name: '多列排序',
  category: 'preprocess',
  description: '',
  spec_version: '1',
  icon: 'table',
  fit_required: false,
  serving_enabled: false,
  serving_window_required: false,
  serving_channel: 'json',
  inputs: [],
  outputs: [],
  config_schema: schema,
}
function node(selected: string[]): ModelingGraphNode {
  return {
    id: 'sort',
    alias: '',
    operator: 'sort_rows',
    position: { left: 0, top: 0 },
    config: { columns: selected },
  }
}
function dialog(selected: string[], isReadonly = false) {
  return mount(ConfigEditorDialog, {
    props: {
      node: node(selected),
      operator,
      fields: fieldsOf(schema),
      options: {
        tables: [],
        tablesState: 'ready',
        tablesNote: '',
        columns,
        columnsNote: '',
      },
      isReadonly,
    },
    global: { stubs: { Teleport: true } },
  })
}
it('配置窗口显示已存优先级，上下移动保存实际列顺序', async () => {
  const wrapper = dialog(['F3', 'F1', 'F2'])
  expect(
    wrapper
      .get('ol[aria-label="排序优先级"]')
      .findAll('li')
      .map((item) => item.get('span').text()),
  ).toEqual(['1. 能耗', '2. 车间', '3. 设备'])
  expect(
    wrapper.get('button[aria-label="上移 能耗"]').attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper.get('button[aria-label="下移 设备"]').attributes('disabled'),
  ).toBeDefined()
  await wrapper.get('button[aria-label="上移 车间"]').trigger('click')
  expect(wrapper.emitted('change')?.at(-1)).toEqual([
    'columns',
    ['F1', 'F3', 'F2'],
  ])
  await wrapper.setProps({ node: node(['F1', 'F3', 'F2']) })
  await wrapper.get('button[aria-label="下移 能耗"]').trigger('click')
  expect(wrapper.emitted('change')?.at(-1)).toEqual([
    'columns',
    ['F1', 'F2', 'F3'],
  ])
  wrapper.unmount()
})
it('有序选择保留点击先后，全选追加未选项', async () => {
  const wrapper = dialog(['F3'])
  wrapper.findAllComponents(DtCheckbox)[0]?.vm.$emit('update:modelValue', true)
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')?.at(-1)).toEqual(['columns', ['F3', 'F1']])
  await wrapper.setProps({ node: node(['F3', 'F1']) })
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '全选')
    ?.trigger('click')
  expect(wrapper.emitted('change')?.at(-1)).toEqual([
    'columns',
    ['F3', 'F1', 'F2'],
  ])
  wrapper.unmount()
})
it('只读参数保留优先级且所有移动按钮禁用', async () => {
  const wrapper = dialog(['F3', '失联列'], true)
  expect(wrapper.text()).toContain('失联列')
  for (const button of wrapper.get('ol').findAll('button')) {
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')
  }
  wrapper.findAllComponents(DtCheckbox)[0]?.vm.$emit('update:modelValue', true)
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')).toBeUndefined()
  wrapper.unmount()
})
it('普通列多选继续使用台账顺序且不显示排序操作', async () => {
  const wrapper = mount(ColumnPicker, {
    props: {
      modelValue: ['F3'],
      columns,
      label: '列',
      hint: '',
      note: '',
      isReadonly: false,
    },
  })
  wrapper.findAllComponents(DtCheckbox)[0]?.vm.$emit('update:modelValue', true)
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['F1', 'F3']])
  expect(wrapper.find('ol').exists()).toBe(false)
  wrapper.unmount()
})
