/**
 * @fileoverview 开箱模板必须**能跑**。
 *
 * ⚠ 摆一张缺环的图比不摆更糟：用户会以为是自己配错了，然后去逐个节点找一个
 * 根本不存在的问题（docs/MODELING_PLATFORM_DESIGN.md D21）。
 * ⚠ 算子 code 是**字面量**：写错一个字母，画布上那个节点会渲染成一个空壳，
 * 而 typecheck 与 lint 双双放行——只有这一组用例逮得到。
 */
import { describe, expect, it } from 'vitest'

import { PIPELINE_TEMPLATES } from '@/pages/Modeling/Pipelines/scripts/templates'

import anomalyGraph from '../fixtures/deviceAnomalyGraph.json'
import energyGraphs from '../fixtures/dailyEnergyGraphs.json'
import loadGraph from '../fixtures/shortTermLoadGraph.json'

/** 后端算子花名册里确实有的那些。⚠ 与 `operators/__init__.py` 同源。 */
const KNOWN_OPERATORS = new Set([
  'anomaly_distance',
  'split_samples',
  'ledger_source',
  'fill_missing',
  'standardize',
  'split_dataset',
  'linear_regression',
  'logistic_regression',
  'tree_regressor',
  'regression_metrics',
  'classification_metrics',
  'select_columns',
  'resample',
  'drop_missing',
  'ledger_join',
  'time_shift',
  'cyclic_time',
  'energy_rules',
])

describe('新建流水线的开箱模板', () => {
  it('设备异常模板与后端执行验收图一致', () => {
    expect(
      PIPELINE_TEMPLATES.find((item) => item.key === 'device_anomaly')?.build(),
    ).toEqual(anomalyGraph)
  })
  it('半小时负荷模板与后端真实执行的图一致', () => {
    expect(
      PIPELINE_TEMPLATES.find(
        (item) => item.key === 'short_term_load',
      )?.build(),
    ).toEqual(loadGraph)
  })
  it.each(Object.entries(energyGraphs))(
    '%s 与后端执行验收的图逐字段一致',
    (key, graph) => {
      expect(
        PIPELINE_TEMPLATES.find((item) => item.key === key)?.build(),
      ).toEqual(graph)
    },
  )
  it('模板键不重样', () => {
    const keys = PIPELINE_TEMPLATES.map((item) => item.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('第一张是空白，让「我自己搭」这条路始终在', () => {
    expect(PIPELINE_TEMPLATES[0]?.key).toBe('blank')
    expect(PIPELINE_TEMPLATES[0]?.build().nodes).toEqual([])
  })

  it.each(PIPELINE_TEMPLATES.filter((item) => item.key !== 'blank'))(
    '「$label」摆的算子都在花名册里',
    (template) => {
      for (const node of template.build().nodes) {
        expect(KNOWN_OPERATORS).toContain(node.operator)
      }
    },
  )

  it.each(PIPELINE_TEMPLATES.filter((item) => item.key !== 'blank'))(
    '「$label」每条边的两头都指向真实存在的节点',
    (template) => {
      const graph = template.build()
      const ids = new Set(graph.nodes.map((node) => node.id))
      for (const edge of graph.edges) {
        expect(ids).toContain(edge.from_node)
        expect(ids).toContain(edge.to_node)
      }
    },
  )

  it.each(PIPELINE_TEMPLATES.filter((item) => item.key !== 'blank'))(
    '「$label」是一条连通的链，没有孤立节点',
    (template) => {
      const graph = template.build()
      const touched = new Set(
        graph.edges.flatMap((edge) => [edge.from_node, edge.to_node]),
      )
      for (const node of graph.nodes) {
        expect(touched).toContain(node.id)
      }
    },
  )

  it.each(
    PIPELINE_TEMPLATES.filter(
      (item) => item.key !== 'blank' && !item.key.startsWith('rule_'),
    ),
  )('「$label」的切分给建模那一步喂了 train 与 test 两路', (template) => {
    const ports = template
      .build()
      .edges.filter((edge) => edge.to_node === 'm')
      .map((edge) => edge.to_port)
    expect(ports.sort()).toEqual(['test', 'train'])
  })

  it.each([
    ['hvac_compliance', '空调机组达标检测模型'],
    ['efficiency_fluctuation', '能效波动分析模型'],
    ['energy_aggregation', '能耗分类归集模型'],
    ['energy_trace', '能源流向追溯模型'],
    ['unit_consumption', '单位能耗核算模型'],
    ['efficiency_benchmark', '能效对标分析模型'],
    ['equipment_efficiency', '设备能效评估模型'],
    ['supply_diagnosis', '能源供应异常诊断模型'],
  ])('%s 直接使用可配置规则，不虚构训练目标', (kind, label) => {
    const template = PIPELINE_TEMPLATES.find(
      (item) => item.key === `rule_${kind}`,
    )
    expect(template?.label).toBe(label)
    const graph = template?.build()
    expect(graph?.nodes.map((node) => node.operator)).toEqual([
      'ledger_source',
      'energy_rules',
    ])
    expect(graph?.nodes.find((node) => node.id === 'm')?.config['kind']).toBe(
      kind,
    )
    expect(graph?.edges).toEqual([
      {
        id: 's_frame_m_frame',
        from_node: 's',
        from_port: 'frame',
        to_node: 'm',
        to_port: 'frame',
      },
    ])
  })

  it.each(PIPELINE_TEMPLATES)('「$label」写了一句说明', (template) => {
    expect(template.hint.length).toBeGreaterThan(2)
  })

  it.each(PIPELINE_TEMPLATES)('「$label」的节点不重叠', (template) => {
    // ⚠ 坐标字段是 `left`/`top` 不是 `x`/`y`：写成后者时那个对象字面量整个
    // 变成错误类型，而 typecheck 与 lint 都只报在**用到它的地方**
    const positions = template
      .build()
      .nodes.map((node) => `${node.position.left}:${node.position.top}`)
    expect(new Set(positions).size).toBe(positions.length)
  })

  it.each(['daily_energy', 'daily_energy_joined'])(
    '%s 只用完整日并按时间评估，缺失目标先剔除',
    (key) => {
      const graph = PIPELINE_TEMPLATES.find((item) => item.key === key)?.build()
      expect(graph).toBeDefined()
      if (graph === undefined) throw new Error(`找不到模板 ${key}`)
      const daily = graph.nodes.filter((node) => node.operator === 'resample')
      expect(daily.length).toBeGreaterThan(0)
      for (const node of daily) {
        expect(node.config).toMatchObject({
          bucket: '1d',
          agg: 'sum',
          missing_policy: 'propagate',
          should_keep_complete_buckets: true,
        })
      }
      expect(graph.nodes.find((node) => node.id === 'p')?.config).toMatchObject(
        { method: 'time_order', min_test_rows: 7 },
      )
      expect(graph.edges).toContainEqual(
        expect.objectContaining({ from_node: 'd', to_node: 'f' }),
      )
      expect(
        graph.nodes.find((node) => node.id === 'd')?.config['subset'],
      ).toEqual([key === 'daily_energy' ? '能耗' : '能耗_能耗'])
    },
  )

  it('分表模板先汇总再按同一天精确关联', () => {
    const graph = PIPELINE_TEMPLATES.find(
      (item) => item.key === 'daily_energy_joined',
    )?.build()
    expect(
      graph?.nodes.filter((node) => node.operator === 'ledger_source'),
    ).toHaveLength(2)
    expect(
      graph?.nodes.find((node) => node.operator === 'ledger_join')?.config,
    ).toEqual({ how: 'inner', tolerance_ms: 0, right_prefix: '能耗_' })
  })

  it('多次创建模板不共享可变配置', () => {
    const template = PIPELINE_TEMPLATES.find(
      (item) => item.key === 'daily_energy',
    )
    const graph = template?.build()
    const source = graph?.nodes[0]
    if (source) source.config['table_code'] = 'changed'
    expect(template?.build().nodes[0]?.config['table_code']).toBe('')
  })
})
