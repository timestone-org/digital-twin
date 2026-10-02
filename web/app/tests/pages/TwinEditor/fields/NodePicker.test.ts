/** @fileoverview 节点搜索支持保留关键词连续添加多个关联节点。 */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import NodePicker from '@/pages/TwinEditor/components/fields/NodePicker.vue'

it('一次搜索可连续添加节点，保留已有项且不重复添加', async () => {
  const wrapper = mount(NodePicker, {
    props: {
      modelValue: ['Existing'],
      candidates: [
        'Existing',
        ...Array.from({ length: 9 }, (_, i) => `Pump_${i}`),
      ],
      'onUpdate:modelValue': (value: string[]) => {
        void wrapper.setProps({ modelValue: value })
      },
    },
    global: { stubs: { teleport: true } },
  })
  await wrapper.get('[role="combobox"]').trigger('click')
  await wrapper.get('.dt-select-menu__input').setValue('Pump_')
  await wrapper.get('[role="option"]').trigger('click')
  expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe(
    'true',
  )
  expect(
    wrapper.get<HTMLInputElement>('.dt-select-menu__input').element.value,
  ).toBe('Pump_')
  expect(
    wrapper.findAll('[role="option"]').map((item) => item.text()),
  ).not.toContain('Pump_0')
  await wrapper
    .get('.dt-select-menu__input')
    .trigger('keydown', { key: 'Enter' })
  expect(wrapper.props('modelValue')).toEqual(['Existing', 'Pump_0', 'Pump_1'])
  expect(
    wrapper.get<HTMLInputElement>('.dt-select-menu__input').element.value,
  ).toBe('Pump_')
  await wrapper.get('[role="combobox"]').trigger('click')
  expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  wrapper.unmount()
})

it('少量候选也能搜索，全部选完后可移除并重新选择', async () => {
  const wrapper = mount(NodePicker, {
    props: {
      modelValue: [],
      candidates: ['Pump'],
      'onUpdate:modelValue': (value: string[]) => {
        void wrapper.setProps({ modelValue: value })
      },
    },
    global: { stubs: { teleport: true } },
  })
  await wrapper.get('[role="combobox"]').trigger('click')
  await wrapper.get('.dt-select-menu__input').setValue('unknown')
  expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  await wrapper.get('.dt-select-menu__input').setValue('Pump')
  await wrapper.get('[role="option"]').trigger('click')
  expect(wrapper.props('modelValue')).toEqual(['Pump'])
  expect(wrapper.find('[role="combobox"]').exists()).toBe(false)
  await wrapper.get('[aria-label="移除 Pump"]').trigger('click')
  await wrapper.get('[role="combobox"]').trigger('click')
  expect(wrapper.get('[role="option"]').text()).toBe('Pump')
  wrapper.unmount()
})

it('全选仅添加当前搜索结果，保留已有项；清除搜索后可全选剩余候选并清空', async () => {
  const wrapper = mount(NodePicker, {
    props: {
      modelValue: ['Existing', 'Pump_0'],
      candidates: ['Pump_0', 'Pump_1', 'Pump_2', 'Valve'],
      'onUpdate:modelValue': (value: string[]) => {
        void wrapper.setProps({ modelValue: value })
      },
    },
    global: { stubs: { teleport: true } },
  })
  await wrapper.get('[role="combobox"]').trigger('click')
  await wrapper.get('.dt-select-menu__input').setValue('pump')
  expect(wrapper.get('.dt-select-menu__actions').text()).toContain(
    '全选搜索结果（2）',
  )
  await wrapper.get('.dt-select-menu__actions button').trigger('click')
  expect(wrapper.props('modelValue')).toEqual([
    'Existing',
    'Pump_0',
    'Pump_1',
    'Pump_2',
  ])
  expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  expect(
    wrapper.get('.dt-select-menu__actions button').attributes('disabled'),
  ).toBeDefined()
  await wrapper.get('.dt-select-menu__input').setValue('')
  expect(wrapper.get('.dt-select-menu__actions').text()).toContain(
    '全选全部候选（1）',
  )
  await wrapper.get('.dt-select-menu__actions button').trigger('click')
  expect(wrapper.props('modelValue')).toEqual([
    'Existing',
    'Pump_0',
    'Pump_1',
    'Pump_2',
    'Valve',
  ])
  expect(wrapper.text()).toContain('已选 5 项')
  const clear = wrapper
    .findAll('button')
    .find((button) => button.text() === '清空已选')
  if (!clear) throw new Error('缺少清空按钮')
  await clear.trigger('click')
  expect(wrapper.props('modelValue')).toEqual([])
  expect(clear.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
