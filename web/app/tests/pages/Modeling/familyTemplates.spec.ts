/** @fileoverview 模型族模板端口完整、数据待配置，选择后无需替换旧模型节点。 */
import { DtSegmented } from '@dt/ui'
import type { ModelingGraph } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { MODEL_FAMILY_TEMPLATES } from '@/pages/Modeling/Pipelines/scripts/familyTemplates'
import TemplatePicker from '@/pages/Modeling/Pipelines/components/TemplatePicker.vue'

interface Ports {
  inputs: Record<string, string>
  outputs: Record<string, string>
}
const FRAME = 'frame@v1'
const supervised: Ports = {
  inputs: { train: FRAME, test: FRAME },
  outputs: { model: 'model@v1', scored: FRAME },
}
const split: Ports = {
  inputs: { frame: FRAME },
  outputs: { train: FRAME, test: FRAME },
}
const unary: Ports = { inputs: { frame: FRAME }, outputs: { frame: FRAME } }
const ports: Record<string, Ports> = {
  ledger_source: { inputs: {}, outputs: { frame: FRAME } },
  fill_missing: unary,
  drop_missing: unary,
  split_dataset: split,
  split_samples: split,
  regression_model: supervised,
  classification_model: supervised,
  regression_metrics: {
    inputs: { scored: FRAME },
    outputs: { metrics: 'metrics@v1' },
  },
  classification_metrics: {
    inputs: { scored: FRAME },
    outputs: { metrics: 'metrics@v1' },
  },
  clustering_analysis: {
    inputs: { frame: FRAME },
    outputs: { frame: FRAME, metrics: 'metrics@v1' },
  },
  anomaly_model: {
    ...supervised,
    outputs: { ...supervised.outputs, metrics: 'metrics@v1' },
  },
}
function graphFor(key: string): ModelingGraph {
  const template = MODEL_FAMILY_TEMPLATES.find((item) => item.key === key)
  if (!template) throw new Error(`缺少模板 ${key}`)
  return template.build()
}

function assertGraphPorts(graph: ModelingGraph): void {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(
    graph.nodes.length,
  )
  expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(
    graph.edges.length,
  )
  for (const edge of graph.edges) {
    const source = nodes.get(edge.from_node)
    const target = nodes.get(edge.to_node)
    if (!source || !target) throw new Error('悬空连线')
    const output = ports[source.operator]?.outputs[edge.from_port]
    const input = ports[target.operator]?.inputs[edge.to_port]
    expect(output).toBeDefined()
    expect(input).toBe(output)
  }
}

it.each(MODEL_FAMILY_TEMPLATES)(
  '$label 的全部连线具有匹配的真实端口类型和唯一标识',
  (template) => {
    const graph = template.build()
    assertGraphPorts(graph)
    expect(graph.nodes.find((node) => node.id === 's')?.config).toEqual({
      table_code: '',
    })
    expect(graph.nodes.find((node) => node.id === 'm')?.config).toEqual({})
  },
)
it('新监督模板使用两个通用族，不复制算法参数或虚构业务列', () => {
  for (const key of ['regression_model', 'classification_model']) {
    const graph = graphFor(key)
    expect(graph.nodes.find((node) => node.id === 'm')?.operator).toBe(key)
    expect(graph.nodes.find((node) => node.id === 'p')?.config).toEqual({
      target_column: '',
    })
    expect(
      graph.nodes.some((node) =>
        ['linear_regression', 'logistic_regression', 'tree_regressor'].includes(
          node.operator,
        ),
      ),
    ).toBe(false)
  }
  const classification = graphFor('classification_model')
  expect(classification.nodes.find((node) => node.id === 'v')?.config).toEqual({
    average: 'macro',
  })
})
it('聚类只做整批分析，异常模板剔除缺失后进行训练测试切分', () => {
  const clustering = MODEL_FAMILY_TEMPLATES.find(
    (item) => item.key === 'clustering_analysis',
  )
  expect(clustering?.build().nodes.map((node) => node.operator)).toEqual([
    'ledger_source',
    'drop_missing',
    'clustering_analysis',
  ])
  expect(clustering?.hint).toContain('不产出可部署模型')
  const anomaly = MODEL_FAMILY_TEMPLATES.find(
    (item) => item.key === 'anomaly_model',
  )?.build()
  expect(anomaly?.nodes.map((node) => node.operator)).toEqual([
    'ledger_source',
    'drop_missing',
    'split_samples',
    'anomaly_model',
  ])
  expect(
    anomaly?.edges
      .filter((edge) => edge.to_node === 'm')
      .map((edge) => edge.to_port)
      .sort(),
  ).toEqual(['test', 'train'])
  expect(anomaly?.nodes.some((node) => 'target_column' in node.config)).toBe(
    false,
  )
})
it('模板选择器提供族入口，并可单独筛选探索分析与新异常模型', async () => {
  const wrapper = mount(TemplatePicker, {
    props: { modelValue: 'regression_model', disabled: false },
  })
  const general = wrapper
    .findAll('button')
    .find((button) => button.text() === '通用分类模型')
  if (!general) throw new Error('缺少通用分类入口')
  await general.trigger('click')
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
    'classification_model',
  ])
  wrapper.getComponent(DtSegmented).vm.$emit('update:modelValue', 'analysis')
  await wrapper.vm.$nextTick()
  expect(wrapper.findAll('.template-picker__option')).toHaveLength(1)
  expect(wrapper.get('.template-picker__option').text()).toContain('聚类分组')
  wrapper.getComponent(DtSegmented).vm.$emit('update:modelValue', 'detection')
  await wrapper.vm.$nextTick()
  expect(
    wrapper
      .findAll('.template-picker__option')
      .some((item) => item.text().includes('正常工况异常模型')),
  ).toBe(true)
  wrapper.unmount()
})
