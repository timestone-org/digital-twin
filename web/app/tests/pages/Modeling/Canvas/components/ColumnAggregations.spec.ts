/** @fileoverview 按列配置汇总方式的控件接线、缺列处理与只读行为。 */
import { DtInput, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ColumnAggregations from '@/pages/Modeling/Canvas/components/ColumnAggregations.vue'
import ConfigForm from '@/pages/Modeling/Canvas/components/ConfigForm.vue'
import { fieldsOf } from '@/pages/Modeling/Canvas/scripts/schemaForm'

const props = {
  modelValue: { 温度: 'avg' },
  columns: [
    { key: '产量', name: '计划产量' },
    { key: '温度', name: '室外温度' },
  ],
  options: [
    { value: 'sum', label: '求和' },
    { value: 'avg', label: '平均' },
  ],
  label: '各列汇总',
  note: '先连接数据',
  isReadonly: false,
}

describe('按列汇总配置', () => {
  it('没有列显示名时仍能搜索列 key，未匹配时不丢弃已存规则', async () => {
    const wrapper = mount(ColumnAggregations, {
      props: { ...props, columns: [{ key: '温度', name: '' }] },
    })
    expect(wrapper.findComponent(DtSelect).props('label')).toBe('温度')
    wrapper.findComponent(DtInput).vm.$emit('update:modelValue', '不存在')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('没有匹配的列')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('恢复默认清除逐列覆盖', async () => {
    const fields = fieldsOf({
      properties: {
        column_aggregations: {
          type: 'object',
          default: {},
          'x-dt-widget': 'column-aggregations',
          additionalProperties: { type: 'string', enum: ['sum', 'avg'] },
        },
      },
    })
    const wrapper = mount(ConfigForm, {
      props: {
        fields,
        config: { column_aggregations: { 温度: 'avg' } },
        isReadonly: false,
        options: {
          tables: [],
          tablesState: 'empty',
          tablesNote: '',
          columns: props.columns,
          columnsNote: '',
        },
      },
    })
    await wrapper.get('button.dt-ml-form__reset').trigger('click')
    expect(wrapper.emitted('change')).toEqual([['column_aggregations', {}]])
    wrapper.unmount()
  })
  it('为每列提供默认口径和后端给定的聚合方式', () => {
    const wrapper = mount(ColumnAggregations, { props })
    const fields = wrapper.findAllComponents(DtSelect)
    expect(fields[0]?.props('label')).toContain('计划产量')
    expect(fields[0]?.props('options')).toEqual([
      { value: '', label: '沿用默认' },
      ...props.options,
    ])
    expect(fields[1]?.props('modelValue')).toBe('avg')
    wrapper.unmount()
  })

  it('修改一列保持其余列，恢复默认时移除该覆盖', () => {
    const wrapper = mount(ColumnAggregations, { props })
    wrapper.findAllComponents(DtSelect)[0]?.vm.$emit('update:modelValue', 'sum')
    wrapper.findAllComponents(DtSelect)[1]?.vm.$emit('update:modelValue', '')
    expect(wrapper.emitted('update:modelValue')).toEqual([
      [{ 温度: 'avg', 产量: 'sum' }],
      [{}],
    ])
    expect(props.modelValue).toEqual({ 温度: 'avg' })
    wrapper.unmount()
  })

  it('上游移除的配置仍然可见且可以清除', () => {
    const wrapper = mount(ColumnAggregations, {
      props: { ...props, columns: [] },
    })
    expect(wrapper.text()).toContain('上游没有这一列')
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', '')
    expect(wrapper.emitted('update:modelValue')).toEqual([[{}]])
    wrapper.unmount()
  })

  it('只读时不允许修改，空候选给出原因', () => {
    const wrapper = mount(ColumnAggregations, {
      props: { ...props, isReadonly: true },
    })
    expect(wrapper.findComponent(DtSelect).props('disabled')).toBe(true)
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'sum')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
    const empty = mount(ColumnAggregations, {
      props: { ...props, columns: [], modelValue: null },
    })
    expect(empty.text()).toContain('先连接数据')
    empty.unmount()
  })

  it('搜索只影响展示，清空搜索恢复候选', async () => {
    const wrapper = mount(ColumnAggregations, { props })
    wrapper.findComponent(DtInput).vm.$emit('update:modelValue', '温度')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAllComponents(DtSelect)).toHaveLength(1)
    wrapper.findComponent(DtInput).vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAllComponents(DtSelect)).toHaveLength(2)
    wrapper.unmount()
  })

  it('schema 表单把映射值和修改事件传给列汇总控件', () => {
    const fields = fieldsOf({
      properties: {
        column_aggregations: {
          type: 'object',
          'x-dt-widget': 'column-aggregations',
          additionalProperties: { type: 'string', enum: ['sum', 'avg'] },
        },
      },
    })
    const wrapper = mount(ConfigForm, {
      props: {
        fields,
        config: { column_aggregations: { 温度: 'avg' } },
        isReadonly: false,
        options: {
          tables: [],
          tablesState: 'empty',
          tablesNote: '',
          columns: props.columns,
          columnsNote: '',
        },
      },
    })
    const field = wrapper.findComponent(ColumnAggregations)
    expect(field.props('modelValue')).toEqual({ 温度: 'avg' })
    field.vm.$emit('update:modelValue', { 产量: 'sum' })
    expect(wrapper.emitted('change')).toEqual([
      ['column_aggregations', { 产量: 'sum' }],
    ])
    wrapper.unmount()
  })
})
