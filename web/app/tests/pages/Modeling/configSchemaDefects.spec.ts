/** @fileoverview 算子参数的数组形状、缺省初值、列选择与只读交互。 */
import { DtCheckbox, DtNumberInput, DtSelect, DtSwitch } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ColumnPicker from '@/pages/Modeling/Canvas/components/ColumnPicker.vue'
import ConfigForm from '@/pages/Modeling/Canvas/components/ConfigForm.vue'
import MomentInput from '@/pages/Modeling/Canvas/components/MomentInput.vue'
import type { FormOptions } from '@/pages/Modeling/Canvas/scripts/schemaForm'
import {
  defaultsOf,
  fieldsOf,
} from '@/pages/Modeling/Canvas/scripts/schemaForm'

const OPTIONS: FormOptions = {
  tables: [],
  tablesState: 'ready',
  tablesNote: '',
  columns: [{ key: '功率', name: '功率' }],
  columnsNote: '',
}
const CYCLIC_SCHEMA = {
  $defs: { Cycle: { enum: ['day', 'week'], type: 'string' } },
  properties: {
    cycles: {
      type: 'array',
      items: { $ref: '#/$defs/Cycle' },
      default: ['day', 'week'],
      minItems: 1,
      maxItems: 2,
      title: '周期',
      description: 'day=日内周期；week=周内周期',
    },
  },
}

function form(
  schema: Record<string, unknown>,
  config: Record<string, unknown> = {},
) {
  return mount(ConfigForm, {
    props: {
      fields: fieldsOf(schema),
      config,
      options: OPTIONS,
      isReadonly: false,
    },
  })
}

describe('数组参数按真实类型编辑', () => {
  it('周期、滚动项和时间项的枚举数组具有多选项', () => {
    const field = fieldsOf(CYCLIC_SCHEMA)[0]
    expect(field?.widget).toBe('multi-select')
    expect(field?.options).toEqual([
      { value: 'day', label: '日内周期' },
      { value: 'week', label: '周内周期' },
    ])
  })

  it('周期显示默认选中项，取消一项后保存数组', async () => {
    const wrapper = form(CYCLIC_SCHEMA)
    const boxes = wrapper.findAllComponents(DtCheckbox)
    expect(boxes.map((box) => box.props('modelValue'))).toEqual([true, true])
    boxes[1]?.vm.$emit('update:modelValue', false)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['cycles', ['day']])
  })

  it('滞后期数显示数字列表，输入提交后仍是整数数组', async () => {
    const wrapper = form(
      {
        properties: {
          lags: {
            type: 'array',
            items: { type: 'integer' },
            title: '滞后几期',
            default: [1],
            minItems: 1,
          },
        },
      },
      { lags: [1, 3] },
    )
    expect(wrapper.get('input').element.value).toBe('1, 3')
    await wrapper.get('input').setValue('1, 12')
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['lags', [1, 12]])
    await wrapper.get('input').setValue('1, 1.5')
    expect(wrapper.text()).toContain('整数')
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['lags', [1, 12]])
  })

  it('没有默认值的数组初值保持数组形状', () => {
    const config = defaultsOf(
      fieldsOf({
        properties: {
          lags: { type: 'array', items: { type: 'integer' } },
        },
      }),
    )
    expect(config['lags']).toEqual([])
  })
})

describe('缺省配置与明确值', () => {
  it('缺省的开关、数值和枚举回显schema初值', () => {
    const wrapper = form({
      properties: {
        use_intercept: { type: 'boolean', default: true },
        test_ratio: { type: 'number', default: 0.2 },
        method: {
          type: 'string',
          enum: ['time_order', 'random'],
          default: 'time_order',
        },
      },
    })
    expect(wrapper.findComponent(DtSwitch).props('modelValue')).toBe(true)
    expect(wrapper.findComponent(DtNumberInput).props('modelValue')).toBe(0.2)
    expect(wrapper.findComponent(DtSelect).props('modelValue')).toBe(
      'time_order',
    )
    expect(wrapper.text()).not.toContain('恢复默认')
  })

  it('明确的false与0不会被默认值覆盖', () => {
    const wrapper = form(
      {
        properties: {
          use_intercept: { type: 'boolean', default: true },
          ridge_alpha: { type: 'number', default: 1 },
        },
      },
      { use_intercept: false, ridge_alpha: 0 },
    )
    expect(wrapper.findComponent(DtSwitch).props('modelValue')).toBe(false)
    expect(wrapper.findComponent(DtNumberInput).props('modelValue')).toBe(0)
  })

  it('严格上下界的端点值给出就地错误', () => {
    const wrapper = form(
      {
        properties: {
          test_ratio: {
            type: 'number',
            default: 0.2,
            exclusiveMinimum: 0,
            exclusiveMaximum: 1,
          },
        },
      },
      { test_ratio: 0 },
    )
    expect(wrapper.text()).toContain('必须大于 0')
  })

  it('校准分位数可以按小数步进而不是一步变为边界值', async () => {
    const wrapper = form({
      properties: {
        quantile: {
          type: 'number',
          default: 0.99,
          minimum: 0.95,
          maximum: 0.9999,
        },
      },
    })
    await wrapper.get('button[aria-label="增加"]').trigger('click')
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['quantile', 0.9901])
  })

  it('缺省文本显示默认前缀', () => {
    const wrapper = form({
      properties: {
        right_prefix: { type: 'string', default: '右_', minLength: 1 },
      },
    })
    expect(wrapper.get('input').element.value).toBe('右_')
  })
})

describe('列集合保持选择和业务语义', () => {
  it('必须选列的算子不会提示留空取全部', () => {
    const wrapper = form(
      {
        properties: {
          columns: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: '只保留这些列',
            'x-dt-widget': 'column',
          },
        },
        required: ['columns'],
      },
      { columns: [] },
    )
    expect(wrapper.text()).not.toContain('留空表示取全部列')
    expect(wrapper.text()).toContain('至少选择 1 项')
  })

  it('搜索后全选保留其他已选列和上游暂不可见列', async () => {
    const columns = Array.from({ length: 8 }, (_, index) => ({
      key: `F${index}`,
      name: `F${index}`,
    }))
    const wrapper = mount(ColumnPicker, {
      props: {
        modelValue: ['F0', '已失联列'],
        columns,
        label: '列',
        hint: '',
        note: '',
        isReadonly: false,
      },
    })
    await wrapper.get('input[type="search"]').setValue('F3')
    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('全选'))
      ?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      ['F0', 'F3', '已失联列'],
    ])
  })
})

describe('只读与嵌套配置类型', () => {
  it('保存阻止原因定位未应用的字段而非已保存的不完整配置', async () => {
    const wrapper = form(
      {
        properties: {
          table_code: { type: 'string', title: '数据台账' },
          fields: {
            type: 'object',
            title: '列映射',
            default: {},
            'x-dt-widget': 'energy-rules-json',
          },
        },
        required: ['table_code'],
      },
      {},
    )
    await wrapper.get('textarea').setValue('{"energy":"用电量"}')
    expect(wrapper.emitted('status')?.at(-1)).toEqual([
      { hasDraft: true, message: '列映射：配置尚未应用' },
    ])
  })

  it('只读时刻不提供可修改的模式按钮', async () => {
    const wrapper = mount(MomentInput, {
      props: {
        modelValue: '-90d',
        label: '起始时刻',
        hint: '',
        isReadonly: true,
      },
    })
    const button = wrapper
      .findAll('button')
      .find((item) => item.text() === '绝对')
    if (button) await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.text()).toContain('相对')
  })

  it('数组不能替代要求对象的规则参数', async () => {
    const wrapper = form(
      {
        properties: {
          fields: {
            type: 'object',
            title: '列映射',
            'x-dt-widget': 'energy-rules-json',
          },
        },
      },
      { fields: {} },
    )
    await wrapper.get('textarea').setValue('[]')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '应用配置')
      ?.trigger('click')
    expect(wrapper.emitted('change')).toBeUndefined()
    expect(wrapper.text()).toContain('配置必须是对象')
  })

  it('对象不能替代要求列表的拓扑参数', async () => {
    const wrapper = form(
      {
        properties: {
          topology: {
            type: 'array',
            title: '能源流向',
            'x-dt-widget': 'energy-rules-json',
          },
        },
      },
      { topology: [] },
    )
    await wrapper.get('textarea').setValue('{}')
    expect(wrapper.text()).toContain('配置必须是列表')
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('只读列表不能修改选择，已有未知选项保持可见', async () => {
    const wrapper = mount(ConfigForm, {
      props: {
        fields: fieldsOf(CYCLIC_SCHEMA),
        config: { cycles: ['day', '旧周期'] },
        options: OPTIONS,
        isReadonly: true,
      },
    })
    const boxes = wrapper.findAllComponents(DtCheckbox)
    expect(wrapper.text()).toContain('旧周期（不在可选项中）')
    expect(boxes.every((box) => box.props('disabled'))).toBe(true)
    boxes[0]?.vm.$emit('update:modelValue', false)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('change')).toBeUndefined()
  })
})
