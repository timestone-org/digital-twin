/**
 * @fileoverview 图状态：每个改动一步撤销、载图不进撤销栈、删节点连带删边、
 * 拖动只在结束时提交一次。
 */
import type { ModelingGraph } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { useModelingGraph } from '@/pages/Modeling/Canvas/scripts/useModelingGraph'

function loaded(): ModelingGraph {
  return {
    format_version: '1',
    nodes: [
      {
        id: 'a',
        operator: 'src',
        alias: '',
        position: { left: 0, top: 0 },
        config: {},
      },
      {
        id: 'b',
        operator: 'mid',
        alias: '',
        position: { left: 100, top: 0 },
        config: {},
      },
    ],
    edges: [
      {
        id: 'a:out->b:in',
        from_node: 'a',
        from_port: 'out',
        to_node: 'b',
        to_port: 'in',
      },
    ],
  }
}

describe('画布上的图状态', () => {
  it('载图不算一次改动，也不进撤销栈', () => {
    const graph = useModelingGraph()

    graph.reset(loaded())

    expect(graph.isDirty.value).toBe(false)
    expect(graph.canUndo.value).toBe(false)
    expect(graph.nodeIds.value).toEqual(['a', 'b'])
  })

  it('载进来的那份图不与外面共享，改画布改不到调用方手上那份', () => {
    const source = loaded()
    const graph = useModelingGraph()

    graph.reset(source)
    graph.moveNodes(new Map([['a', { left: 9, top: 9 }]]))

    expect(source.nodes[0]?.position).toEqual({ left: 0, top: 0 })
  })

  it('新节点带着算子 schema 的默认参数落下来', () => {
    const graph = useModelingGraph()

    graph.addNode('src', { left: 0, top: 0 }, { row_limit: 100 })

    expect(graph.graph.value.nodes[0]?.config).toEqual({ row_limit: 100 })
  })

  it('删节点连同挂在它身上的边一起删', () => {
    const graph = useModelingGraph()
    graph.reset(loaded())

    graph.removeNodes(['a'])

    expect(graph.nodeIds.value).toEqual(['b'])
    expect(graph.edgeIds.value).toEqual([])
  })

  it('每个改动都能退回上一步', () => {
    const graph = useModelingGraph()
    graph.reset(loaded())

    graph.removeNodes(['a'])
    graph.undo()

    expect(graph.nodeIds.value).toEqual(['a', 'b'])
    expect(graph.edgeIds.value).toEqual(['a:out->b:in'])
  })

  it('撤销栈空着的时候按撤销不出事', () => {
    const graph = useModelingGraph()
    graph.reset(loaded())

    graph.undo()

    expect(graph.nodeIds.value).toEqual(['a', 'b'])
  })

  it('存盘之后「有未保存改动」清掉', () => {
    const graph = useModelingGraph()
    graph.reset(loaded())
    graph.removeEdges(['a:out->b:in'])

    expect(graph.isDirty.value).toBe(true)
    graph.markSaved()

    expect(graph.isDirty.value).toBe(false)
  })

  it('改参数只动那一个节点', () => {
    const graph = useModelingGraph()
    graph.reset(loaded())

    graph.setConfig('b', { fill: 'mean' })

    expect(graph.graph.value.nodes[1]?.config).toEqual({ fill: 'mean' })
    expect(graph.graph.value.nodes[0]?.config).toEqual({})
  })

  it('挪一批节点是一步撤销，不是每个节点一步', () => {
    const graph = useModelingGraph()
    graph.reset(loaded())

    graph.moveNodes(
      new Map([
        ['a', { left: 10, top: 10 }],
        ['b', { left: 20, top: 20 }],
      ]),
    )
    graph.undo()

    expect(graph.graph.value.nodes[0]?.position).toEqual({ left: 0, top: 0 })
    expect(graph.graph.value.nodes[1]?.position).toEqual({ left: 100, top: 0 })
  })

  it('连着落好几个节点时位置逐个错开，不叠在一起', () => {
    const graph = useModelingGraph()

    graph.addNode('src', { left: 40, top: 40 })
    graph.addNode('src', { left: 40, top: 40 })

    const [first, second] = graph.graph.value.nodes
    expect(second?.position).not.toEqual(first?.position)
  })
})
