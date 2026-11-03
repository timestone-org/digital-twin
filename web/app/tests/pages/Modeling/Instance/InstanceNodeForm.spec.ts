/** @fileoverview 模型实例使用与画布相同的条件参数、数组、约束和默认恢复。 */
import type { ModelingParameterNode } from '@dt/contracts'
import { DtNumberInput, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import InstanceNodeForm from '@/pages/Modeling/Instance/components/InstanceNodeForm.vue'

const node: ModelingParameterNode = {
  id: 'model',
  alias: '',
  config: {},
  known_columns: ['温度', '能耗'],
  operator: {
    code: 'regression_model',
    name: '通用回归',
    category: 'model',
    description: '',
    spec_version: '1',
    icon: 'table',
    inputs: [],
    outputs: [],
    fit_required: true,
    serving_enabled: true,
    serving_window_required: false,
    serving_channel: 'binary',
    config_schema: {
      properties: {
        algorithm: {
          type: 'string',
          enum: ['ridge', 'mlp'],
          default: 'ridge',
          title: '算法',
          description: 'ridge=岭回归；mlp=神经网络回归',
        },
        alpha: {
          type: 'number',
          default: 1,
          minimum: 0,
          title: '正则强度',
          'x-dt-visible-when': { algorithm: ['ridge'] },
        },
        hidden_layers: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          default: [100],
          minItems: 1,
          title: '隐藏层',
          'x-dt-visible-when': { algorithm: ['mlp'] },
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          default: [],
          title: '特征列',
          'x-dt-widget': 'column',
        },
      },
    },
  },
}
it('默认值、中文选项、列候选与数值界限在实例表单中生效', () => {
  const wrapper = mount(InstanceNodeForm, {
    props: { node, config: {}, disabled: false },
  })
  expect(wrapper.getComponent(DtSelect).props('options')).toEqual([
    { value: 'ridge', label: '岭回归' },
    { value: 'mlp', label: '神经网络回归' },
  ])
  expect(wrapper.getComponent(DtNumberInput).props('modelValue')).toBe(1)
  expect(wrapper.getComponent(DtNumberInput).props('range')?.min).toBe(0)
  expect(wrapper.text()).toContain('温度')
  expect(wrapper.text()).not.toContain('隐藏层')
  wrapper.unmount()
})
it('切换模型显示整数列表，非法草稿阻止提交，隐藏错误不继续阻断', async () => {
  const wrapper = mount(InstanceNodeForm, {
    props: {
      node,
      config: { algorithm: 'mlp', hidden_layers: [32, 16] },
      disabled: false,
    },
  })
  expect(wrapper.text()).not.toContain('正则强度')
  expect(wrapper.find('textarea').exists()).toBe(false)
  await wrapper.get('input').setValue('32, 0')
  expect(wrapper.text()).toContain('不小于 1')
  expect(wrapper.emitted('error')?.at(-1)?.[1]).toContain('不小于 1')
  await wrapper.setProps({
    config: { algorithm: 'ridge', hidden_layers: [32, 16] },
  })
  expect(wrapper.emitted('error')?.at(-1)).toEqual(['model.__form', ''])
  expect(wrapper.emitted('change')).toBeUndefined()
  wrapper.unmount()
})
it('恢复默认和只读保持配置语义', async () => {
  const wrapper = mount(InstanceNodeForm, {
    props: { node, config: { algorithm: 'ridge', alpha: 2 }, disabled: false },
  })
  await wrapper
    .findAll('button')
    .find((button) => button.text().includes('恢复默认'))
    ?.trigger('click')
  expect(wrapper.emitted('change')?.at(-1)).toEqual(['alpha', 1])
  await wrapper.setProps({ disabled: true })
  expect(wrapper.getComponent(DtNumberInput).props('disabled')).toBe(true)
  expect(wrapper.text()).not.toContain('恢复默认')
  wrapper.unmount()
})

it.each(['bdm_source', 'energy_rules'])(
  '%s 保留既有业务JSON参数形状与草稿保护',
  async (code) => {
    const business: ModelingParameterNode = {
      ...node,
      operator: {
        ...node.operator,
        code,
        config_schema: {
          properties: { options: { type: 'object', title: '业务配置' } },
        },
      },
    }
    const wrapper = mount(InstanceNodeForm, {
      props: {
        node: business,
        config: { options: { field: '能耗' } },
        disabled: false,
      },
    })
    await wrapper.get('textarea').setValue('{')
    expect(wrapper.emitted('error')?.at(-1)?.[1]).toContain('JSON 格式不完整')
    await wrapper.get('textarea').setValue('{"field":"产量"}')
    expect(wrapper.emitted('change')?.at(-1)).toEqual([
      'options',
      { field: '产量' },
    ])
    wrapper.unmount()
  },
)
