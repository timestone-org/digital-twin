/** @fileoverview 大算子目录按分类与关键词组合查找，保留只读与新增交互。 */
import type { ModelingOperator } from '@dt/contracts'
import { DtInput, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import OperatorPalette from '@/pages/Modeling/Canvas/components/OperatorPalette.vue'

function operator(
  code: string,
  name: string,
  category: string,
): ModelingOperator {
  return {
    code,
    name,
    category,
    description: `${name}说明`,
    spec_version: '1.0',
    icon: 'table',
    inputs: [],
    outputs: [],
    config_schema: {},
    fit_required: false,
    serving_enabled: false,
    serving_window_required: false,
    serving_channel: '',
  }
}
const operators = [
  operator('ledger_source', '台账取数', 'source'),
  operator('deduplicate', '去重', 'preprocess'),
  operator('numeric_transform', '数值变换', 'feature'),
]

describe('算子目录筛选', () => {
  it('组合分类和名称搜索，清空后恢复全部算子', async () => {
    const wrapper = mount(OperatorPalette, {
      props: { operators, isReadonly: false },
    })
    const category = wrapper.getComponent(DtSelect)
    expect(category.props('options')).toContainEqual({
      value: '',
      label: '全部分类（3）',
    })
    category.vm.$emit('update:modelValue', 'preprocess')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.dt-ml-palette__item')).toHaveLength(1)
    expect(wrapper.text()).toContain('去重')
    wrapper.getComponent(DtInput).vm.$emit('update:modelValue', 'numeric')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('没有匹配的算子')
    category.vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()
    await wrapper.get('.dt-ml-palette__item').trigger('click')
    expect(wrapper.emitted('pick')).toEqual([['numeric_transform']])
    wrapper.getComponent(DtInput).vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.dt-ml-palette__item')).toHaveLength(3)
    wrapper.unmount()
  })
  it('目录保留新增分类，且只读时不能添加算子', () => {
    const wrapper = mount(OperatorPalette, {
      props: {
        operators: [operator('custom', '扩展统计', 'statistics')],
        isReadonly: true,
      },
    })
    expect(wrapper.getComponent(DtSelect).props('options')).toContainEqual({
      value: 'statistics',
      label: 'statistics（1）',
    })
    const item = wrapper.get<HTMLButtonElement>('.dt-ml-palette__item')
    expect(item.element.disabled).toBe(true)
    expect(item.attributes('draggable')).toBe('false')
    wrapper.unmount()
  })
})

it('检索族内算法的英文值和中文名，目录只保留一个族入口', async () => {
  const family = operator('regression_model', '通用回归', 'model')
  family.config_schema = {
    properties: {
      algorithm: {
        type: 'string',
        enum: ['ridge', 'knn', 'svr'],
        description: 'ridge=岭回归；knn=近邻回归；svr=支持向量回归',
      },
    },
  }
  const wrapper = mount(OperatorPalette, {
    props: { operators: [family], isReadonly: false },
  })
  for (const keyword of ['SVR', 'KNN', '支持向量', '近邻']) {
    await wrapper.get('input').setValue(keyword)
    expect(wrapper.findAll('.dt-ml-palette__item')).toHaveLength(1)
  }
  expect(wrapper.get('.dt-ml-palette__item').text()).toContain('3')
  await wrapper.get('.dt-ml-palette__item').trigger('click')
  expect(wrapper.emitted('pick')).toEqual([['regression_model']])
  wrapper.unmount()
})

it('品牌模型和英文缩写定位到两个任务入口', async () => {
  const schema = {
    properties: {
      algorithm: {
        type: 'string',
        enum: ['xgboost', 'lightgbm', 'catboost'],
        description: 'xgboost=XGBoost；lightgbm=LightGBM；catboost=CatBoost',
      },
    },
  }
  const families = ['regression_model', 'classification_model'].map((code) => ({
    ...operator(code, code, 'model'),
    config_schema: schema,
  }))
  const wrapper = mount(OperatorPalette, {
    props: { operators: families, isReadonly: false },
  })
  for (const query of ['XGBoost', 'LightGBM', 'CatBoost', 'XGB', 'LGBM']) {
    await wrapper.get('input').setValue(query)
    expect(wrapper.findAll('.dt-ml-palette__item')).toHaveLength(2)
  }
  wrapper.unmount()
})
