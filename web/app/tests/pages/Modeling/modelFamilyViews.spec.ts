/** @fileoverview 新模型结果保持中性聚类指标、明确汇总口径和中文算法名称。 */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import MetricsView from '@/pages/Modeling/Canvas/components/MetricsView.vue'
import ClassificationMetricsView from '@/pages/Modeling/Canvas/components/ClassificationMetricsView.vue'
import ModelView from '@/pages/Modeling/Canvas/components/ModelView.vue'
import MatrixTable from '@/pages/Modeling/Canvas/components/MatrixTable.vue'
import { previewOf } from '@/pages/Modeling/Canvas/scripts/preview'

it('聚类指标不派发分类矩阵，不将轮廓系数当准确率染色', () => {
  const preview = previewOf({
    kind: 'metrics',
    task: 'clustering',
    metrics: { cluster_count: 3, silhouette: null, noise_rows: 2 },
    labels: ['0', '1'],
    matrix: [],
  })
  if (preview.kind !== 'metrics') throw new Error('缺少指标')
  const wrapper = mount(MetricsView, {
    props: { preview, code: 'clustering_analysis' },
  })
  expect(wrapper.findComponent(MatrixTable).exists()).toBe(false)
  expect(wrapper.text()).toContain('簇数量')
  expect(wrapper.text()).toContain('轮廓系数')
  expect(wrapper.text()).toContain('无定义')
  expect(wrapper.find('.dt-tag--success').exists()).toBe(false)
  wrapper.unmount()
})
it('宏平均明确说明不对应单一正类，保留逐类混淆矩阵', () => {
  const preview = previewOf({
    kind: 'metrics',
    task: 'classification',
    metrics: { precision: 1, recall: 1, f1: 1 },
    labels: ['0', '1', '2'],
    matrix: [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ],
  })
  if (preview.kind !== 'metrics') throw new Error('缺少指标')
  const wrapper = mount(ClassificationMetricsView, {
    props: { preview, average: 'macro', positiveLabel: 1 },
  })
  expect(wrapper.text()).toContain('不对应单一正类')
  expect(wrapper.find('.dt-ml-clf__positive').exists()).toBe(false)
  expect(wrapper.findComponent(MatrixTable).exists()).toBe(true)
  wrapper.unmount()
})
it('二进制族模型用已解析的中文算法名展示，历史未知算法仍可显示', () => {
  const preview = previewOf({
    kind: 'model',
    algo: 'regression_model',
    task: 'regression',
    feature_keys: ['温度'],
    hyper_params: {},
    fitted: {},
    serving_channel: 'binary',
  })
  if (preview.kind !== 'model') throw new Error('缺少模型')
  const wrapper = mount(ModelView, {
    props: { preview, algorithmName: '支持向量回归' },
  })
  expect(wrapper.text()).toContain('支持向量回归')
  expect(wrapper.text()).toContain('可上线')
  wrapper.unmount()
})

it('模型参数使用Schema中文标签，隐藏其他算法的冻结参数', () => {
  const preview = previewOf({
    kind: 'model',
    algo: 'regression_model',
    task: 'regression',
    feature_keys: ['温度'],
    hyper_params: { algorithm: 'random_forest', alpha: 5, n_estimators: 30 },
    fitted: {},
    serving_channel: 'binary',
  })
  if (preview.kind !== 'model') throw new Error('缺少模型')
  const operator = {
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
          enum: ['random_forest', 'ridge'],
          description: 'random_forest=随机森林；ridge=岭回归',
          title: '算法',
        },
        alpha: {
          type: 'number',
          title: '正则强度',
          'x-dt-visible-when': { algorithm: ['ridge'] },
        },
        n_estimators: {
          type: 'integer',
          title: '基学习器数量',
          'x-dt-visible-when': { algorithm: ['random_forest'] },
        },
      },
    },
  }
  const wrapper = mount(ModelView, {
    props: { preview, operator, config: { algorithm: 'random_forest' } },
  })
  expect(wrapper.text()).toContain('随机森林')
  expect(wrapper.text()).toContain('基学习器数量')
  expect(wrapper.text()).not.toContain('正则强度')
  wrapper.unmount()
})
