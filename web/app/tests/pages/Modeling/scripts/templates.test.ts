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

/** 后端算子花名册里确实有的那些。⚠ 与 `operators/__init__.py` 同源。 */
const KNOWN_OPERATORS = new Set([
  'ledger_source',
  'fill_missing',
  'standardize',
  'split_dataset',
  'linear_regression',
  'logistic_regression',
  'tree_regressor',
  'regression_metrics',
  'classification_metrics',
])

describe('新建流水线的开箱模板', () => {
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

  it.each(PIPELINE_TEMPLATES.filter((item) => item.key !== 'blank'))(
    '「$label」的切分给建模那一步喂了 train 与 test 两路',
    (template) => {
      const ports = template
        .build()
        .edges.filter((edge) => edge.to_node === 'm')
        .map((edge) => edge.to_port)
      expect(ports.sort()).toEqual(['test', 'train'])
    },
  )

  it.each(PIPELINE_TEMPLATES)('「$label」写了一句说明', (template) => {
    expect(template.hint.length).toBeGreaterThan(2)
  })

  it.each(PIPELINE_TEMPLATES)('「$label」的节点不重叠', (template) => {
    // ⚠ 坐标字段是 `left`/`top` 不是 `x`/`y`：写成后者时那个对象字面量整个
    // 变成错误类型，而 typecheck 与 lint 都只报在**用到它的地方**
    const lefts = template.build().nodes.map((node) => node.position.left)
    expect(new Set(lefts).size).toBe(lefts.length)
  })
})
