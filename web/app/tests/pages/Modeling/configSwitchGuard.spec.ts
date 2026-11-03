/** @fileoverview 真实配置窗口阻止用切换选项隐藏活跃错误，保留草稿与未知选项修复。 */
import type { ModelingGraphNode, ModelingOperator } from '@dt/contracts'
import { DtNumberInput, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ConfigEditorDialog from '@/pages/Modeling/Canvas/components/ConfigEditorDialog.vue'
import { fieldsOf } from '@/features/modeling-config/scripts/schemaForm'

function node(config: Record<string, unknown>): ModelingGraphNode {
  return {
    id: 'm',
    alias: '',
    operator: 'regression_model',
    position: { left: 0, top: 0 },
    config,
  }
}
function dialog(
  schema: Record<string, unknown>,
  config: Record<string, unknown>,
) {
  const operator: ModelingOperator = {
    code: 'regression_model',
    name: '回归模型',
    description: '',
    category: 'model',
    spec_version: '1',
    icon: 'table',
    inputs: [],
    outputs: [],
    config_schema: schema,
    fit_required: true,
    serving_enabled: true,
    serving_window_required: false,
    serving_channel: 'binary',
  }
  return mount(ConfigEditorDialog, {
    props: {
      node: node(config),
      operator,
      fields: fieldsOf(schema),
      options: {
        tables: [],
        tablesState: 'ready',
        tablesNote: '',
        columns: [],
        columnsNote: '',
      },
      isReadonly: false,
    },
    global: { stubs: { Teleport: true } },
  })
}
function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined
}

it.each([
  ['algorithm', 'ridge', 'forest'],
  ['gamma_mode', 'value', 'scale'],
])('%s 不能隐藏无效数值，修正后可切换', async (controller, current, next) => {
  const schema = {
    properties: {
      [controller]: { type: 'string', enum: [current, next], title: '选项' },
      parameter: {
        type: 'number',
        title: '参数值',
        default: 1,
        exclusiveMinimum: 0,
        'x-dt-visible-when': { [controller]: [current] },
      },
    },
  }
  const wrapper = dialog(schema, { [controller]: current, parameter: 0 })
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', next)
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')).toBeUndefined()
  expect(wrapper.text()).toContain('请先修正或应用「参数值」再切换选项')
  expect(wrapper.getComponent(DtSelect).props('modelValue')).toBe(current)
  wrapper.getComponent(DtNumberInput).vm.$emit('update:modelValue', 1)
  await wrapper.setProps({
    node: node({ [controller]: current, parameter: 1 }),
  })
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', next)
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')?.at(-1)).toEqual([controller, next])
  wrapper.unmount()
})
it('未完成数组草稿不能通过切算法丢弃，修正后可切换且保留合法参数', async () => {
  const schema = {
    properties: {
      algorithm: { type: 'string', enum: ['mlp', 'ridge'], title: '算法' },
      hidden_layers: {
        type: 'array',
        title: '隐藏层',
        items: { type: 'integer', minimum: 1 },
        default: [64],
        minItems: 1,
        'x-dt-visible-when': { algorithm: ['mlp'] },
      },
    },
  }
  const wrapper = dialog(schema, { algorithm: 'mlp', hidden_layers: [64] })
  await wrapper.get('input').setValue('64,')
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'ridge')
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')).toBeUndefined()
  expect(wrapper.get('input').element.value).toBe('64,')
  expect(wrapper.text()).toContain('请先修正或应用「隐藏层」再切换选项')
  await wrapper.get('input').setValue('64, 32')
  await wrapper.setProps({
    node: node({ algorithm: 'mlp', hidden_layers: [64, 32] }),
  })
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'ridge')
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')?.at(-1)).toEqual(['algorithm', 'ridge'])
  expect(
    property(
      property(property(wrapper.props(), 'node'), 'config'),
      'hidden_layers',
    ),
  ).toEqual([64, 32])
  wrapper.unmount()
})
it('未知算法本身仍可修正，不阻挡初始隐藏字段的错误', async () => {
  const schema = {
    properties: {
      algorithm: { type: 'string', enum: ['ridge', 'forest'], title: '算法' },
      alpha: {
        type: 'number',
        exclusiveMinimum: 0,
        'x-dt-visible-when': { algorithm: ['ridge'] },
      },
    },
  }
  const wrapper = dialog(schema, { algorithm: 'future_algorithm', alpha: 0 })
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'ridge')
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')?.at(-1)).toEqual(['algorithm', 'ridge'])
  wrapper.unmount()
})
