/** @fileoverview 能源规则按业务展示可视配置，并保护未完成的列表草稿。 */
import { DtButton, DtInput, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'

import ConfigEditorDialog from '@/pages/Modeling/Canvas/components/ConfigEditorDialog.vue'
import { changeEnergyConfig } from '@/pages/Modeling/Canvas/scripts/energyRuleForm'
import { fieldsOf } from '@/pages/Modeling/Canvas/scripts/schemaForm'

const schema = {
  properties: {
    kind: {
      type: 'string',
      enum: [
        'hvac_compliance',
        'energy_aggregation',
        'energy_trace',
        'unit_consumption',
      ],
      default: 'hvac_compliance',
      title: '规则类型',
    },
    fields: {
      type: 'object',
      title: '业务列映射',
      'x-dt-widget': 'energy-rules-json',
    },
    parameters: {
      $ref: '#/$defs/EnergyRuleParameters',
      title: '业务参数',
      'x-dt-widget': 'energy-rules-json',
    },
    meters: {
      type: 'array',
      title: '分类计量',
      'x-dt-widget': 'energy-rules-json',
    },
    topology: {
      type: 'array',
      title: '能源流向',
      'x-dt-widget': 'energy-rules-json',
    },
  },
  $defs: {
    EnergyRuleParameters: {
      properties: {
        temperature_min: {
          type: 'number',
          default: 18,
          minimum: -100,
          maximum: 100,
        },
        temperature_max: {
          type: 'number',
          default: 26,
          minimum: -100,
          maximum: 100,
        },
        humidity_min: { type: 'number', default: 40, minimum: 0, maximum: 100 },
        humidity_max: { type: 'number', default: 65, minimum: 0, maximum: 100 },
        balance_tolerance: {
          type: 'number',
          default: 0.01,
          minimum: 0,
          maximum: 1000000,
        },
        decimal_places: {
          type: 'integer',
          default: 6,
          minimum: 0,
          maximum: 12,
        },
      },
    },
  },
}
function dialog(kind = 'hvac_compliance', isReadonly = false) {
  return mount(ConfigEditorDialog, {
    props: {
      node: {
        id: 'rule',
        alias: '',
        operator: 'energy_rules',
        config: { kind },
        position: { left: 0, top: 0 },
      },
      operator: {
        code: 'energy_rules',
        name: '能源规则核算',
        description: '按明确规则核算',
        category: 'model',
        spec_version: '1',
        icon: 'table',
        fit_required: false,
        serving_enabled: true,
        serving_window_required: false,
        serving_channel: 'json',
        inputs: [],
        outputs: [],
        config_schema: schema,
      },
      fields: fieldsOf(schema),
      options: {
        tables: [],
        tablesState: 'ready',
        tablesNote: '',
        columns: [
          { key: '温度', name: '温度' },
          { key: '湿度', name: '湿度' },
          { key: '生产电量', name: '生产电量' },
        ],
        columnsNote: '',
      },
      isReadonly,
    },
    global: { stubs: { Teleport: true } },
  })
}
it('空调规则只显示相关映射与阈值，窗口有固定完成操作和草稿说明', () => {
  const wrapper = dialog()
  expect(wrapper.find('textarea').exists()).toBe(false)
  expect(wrapper.text()).toContain('温度下限')
  expect(wrapper.text()).toContain('湿度上限')
  expect(wrapper.text()).not.toContain('折标系数')
  expect(wrapper.get('.dt-modal__foot').text()).toContain('完成配置')
  expect(wrapper.text()).toContain('保存流水线')
  wrapper.unmount()
})
it('切换规则清除不适用的业务列映射', async () => {
  const wrapper = dialog()
  const select = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === '规则类型')
  select?.vm.$emit('update:modelValue', 'unit_consumption')
  await wrapper.vm.$nextTick()
  // ⚠ 一次写入：拆成两次 commit 的话，撤销一下会落到「旧类型 + 列映射已清空」
  expect(wrapper.emitted('change')).toEqual([['kind', 'unit_consumption']])
  wrapper.unmount()
})
it('换规则类型时一并清掉列映射，同类型不动', () => {
  const config = { kind: 'hvac_compliance', fields: { temp: 't1' } }
  expect(changeEnergyConfig(config, 'kind', 'energy_aggregation')).toEqual({
    kind: 'energy_aggregation',
    fields: {},
  })
  expect(changeEnergyConfig(config, 'kind', 'hvac_compliance')).toEqual(config)
})
it('分类计量提供可编辑行，折标系数保持十进制文本，未完成行不覆盖配置', async () => {
  const wrapper = dialog('energy_aggregation')
  expect(wrapper.find('textarea').exists()).toBe(false)
  const factor = wrapper
    .findAllComponents(DtInput)
    .find((item) => item.props('label') === '折标系数（kgce/计量单位）')
  factor?.vm.$emit('update:modelValue', '0.123456789012')
  await wrapper.vm.$nextTick()
  const changed = wrapper.emitted('change')?.at(-1)
  expect(changed?.[0]).toBe('meters')
  expect(JSON.stringify(changed?.[1])).toContain(
    '"standard_coal_factor":"0.123456789012"',
  )
  await wrapper
    .findAllComponents(DtButton)
    .find((item) => item.text().includes('添加计量'))
    ?.trigger('click')
  expect(wrapper.text()).toContain('请完善')
  expect(wrapper.emitted('status')?.at(-1)?.[0]).toMatchObject({
    hasDraft: true,
  })
  wrapper.unmount()
})
it('能源流向提供来源、去向与计量列，循环会就地提示', async () => {
  const wrapper = dialog('energy_trace')
  const source = wrapper
    .findAllComponents(DtInput)
    .find((item) => item.props('label') === '来源节点')
  source?.vm.$emit('update:modelValue', '配电中心')
  await wrapper.vm.$nextTick()
  expect(wrapper.text()).toContain('不能相同')
  expect(wrapper.emitted('change')).toBeUndefined()
  wrapper.unmount()
})
it('只读规则不允许修改、添加和恢复配置', () => {
  const wrapper = dialog('energy_aggregation', true)
  expect(
    wrapper.findAllComponents(DtInput).every((item) => item.props('disabled')),
  ).toBe(true)
  expect(
    wrapper.findAllComponents(DtSelect).every((item) => item.props('disabled')),
  ).toBe(true)
  expect(wrapper.text()).not.toContain('添加计量')
  expect(wrapper.text()).toContain('只读')
  wrapper.unmount()
})
