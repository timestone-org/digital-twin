/** @fileoverview 品牌回归和分类的专属参数在配置窗口中可见、可改且不串用。 */
import type { ModelingOperator } from '@dt/contracts'
import { DtNumberInput, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ConfigEditorDialog from '@/pages/Modeling/Canvas/components/ConfigEditorDialog.vue'
import {
  defaultsOf,
  fieldsOf,
} from '@/features/modeling-config/scripts/schemaForm'

const BRANDS = ['xgboost', 'lightgbm', 'catboost'] as const
const schema = {
  properties: {
    algorithm: {
      type: 'string',
      enum: BRANDS,
      title: '算法',
      default: 'xgboost',
      description: 'xgboost=XGBoost；lightgbm=LightGBM；catboost=CatBoost',
    },
    n_estimators: {
      type: 'integer',
      default: 100,
      minimum: 1,
      maximum: 300,
      title: '基学习器数量',
    },
    boost_l1: {
      type: 'number',
      default: 0,
      minimum: 0,
      maximum: 1000000,
      title: '提升树 L1 正则',
      'x-dt-visible-when': { algorithm: ['xgboost', 'lightgbm'] },
    },
    row_subsample: {
      type: 'number',
      default: 1,
      exclusiveMinimum: 0,
      maximum: 1,
      title: '每轮样本采样比例',
      'x-dt-step': 0.05,
    },
    boost_l2: {
      type: 'number',
      default: 1,
      minimum: 0,
      maximum: 1000000,
      title: '提升树 L2 正则',
    },
    min_child_weight: {
      type: 'number',
      default: 1,
      minimum: 0,
      maximum: 1000000,
      title: '子节点最小二阶权重',
      description: 'XGBoost 的最小 Hessian 权重，不是样本行数',
      'x-dt-visible-when': { algorithm: ['xgboost'] },
    },
    catboost_depth: {
      type: 'integer',
      default: 6,
      minimum: 1,
      maximum: 10,
      title: '对称树深度',
      description: '最多 10 层，即每棵树最多 1024 片叶子',
      'x-dt-visible-when': { algorithm: ['catboost'] },
    },
  },
}
function dialog(code: string, algorithm: string) {
  const operator: ModelingOperator = {
    code,
    name: code === 'regression_model' ? '通用回归' : '通用分类',
    description: '',
    category: 'model',
    spec_version: '1',
    icon: 'network',
    inputs: [],
    outputs: [],
    config_schema: schema,
    fit_required: true,
    serving_enabled: true,
    serving_window_required: false,
    serving_channel: 'binary',
  }
  const fields = fieldsOf(schema)
  return mount(ConfigEditorDialog, {
    props: {
      node: {
        id: 'brand',
        alias: '',
        operator: code,
        position: { left: 0, top: 0 },
        config: { ...defaultsOf(fields), algorithm },
      },
      operator,
      fields,
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
it.each(
  ['regression_model', 'classification_model'].flatMap((code) =>
    BRANDS.map((algorithm) => [code, algorithm] as const),
  ),
)('%s 的 %s 专属数值配置可用且没有JSON输入', async (code, algorithm) => {
  const wrapper = dialog(code, algorithm)
  const selector = wrapper.getComponent(DtSelect)
  expect(selector.props('modelValue')).toBe(algorithm)
  expect(wrapper.find('textarea').exists()).toBe(false)
  const labels = wrapper
    .findAllComponents(DtNumberInput)
    .map((field) => field.props('label'))
  expect(labels).toContain('基学习器数量')
  expect(labels.includes('子节点最小二阶权重')).toBe(algorithm === 'xgboost')
  expect(labels.includes('对称树深度')).toBe(algorithm === 'catboost')
  expect(labels.includes('提升树 L1 正则')).toBe(algorithm !== 'catboost')
  const strength = wrapper
    .findAllComponents(DtNumberInput)
    .find((field) => field.props('label') === '提升树 L2 正则')
  if (!strength) throw new Error('缺少正则参数')
  strength.vm.$emit('update:modelValue', 2)
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')?.at(-1)).toEqual(['boost_l2', 2])
  expect(wrapper.text()).toContain('完成配置')
  wrapper.unmount()
})

it('采样比例可从1便捷减少至0.95，UI步长不新增数值约束', async () => {
  const wrapper = dialog('regression_model', 'xgboost')
  const ratio = wrapper
    .findAllComponents(DtNumberInput)
    .find((field) => field.props('label') === '每轮样本采样比例')
  if (!ratio) throw new Error('缺少采样参数')
  expect(ratio.props('range')?.step).toBe(0.05)
  await ratio.get('button[aria-label="减少"]').trigger('click')
  expect(wrapper.emitted('change')?.at(-1)).toEqual(['row_subsample', 0.95])
  await ratio.get('input').setValue('0.97')
  await wrapper.vm.$nextTick()
  expect(wrapper.emitted('change')?.at(-1)).toEqual(['row_subsample', 0.97])
  wrapper.unmount()
})
