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

  it('删一整份选中是**一步**撤销，不是节点一步、边一步', () => {
    const graph = useModelingGraph()
    graph.reset(loaded())

    graph.removeSelection(['a'], ['a:out->b:in'])
    graph.undo()

    expect(graph.nodeIds.value).toEqual(['a', 'b'])
    expect(graph.edgeIds.value).toEqual(['a:out->b:in'])
  })

  it('什么都没选中时不入撤销栈，免得攒一堆按不出效果的空步', () => {
    const graph = useModelingGraph()
    graph.reset(loaded())

    graph.removeSelection([], [])

    expect(graph.canUndo.value).toBe(false)
    expect(graph.isDirty.value).toBe(false)
  })

  // 错开落点由调用方用 `cascadeFrom` 算好再传进来——拖拽落件要的是指哪落哪，
  // 而点算子面板要的是错开。两种落法共用一个 `addNode`，位置一律由外面给
  it('落点原样落下，不在这里悄悄改', () => {
    const graph = useModelingGraph()

    graph.addNode('src', { left: 40, top: 40 })

    expect(graph.graph.value.nodes[0]?.position).toEqual({ left: 40, top: 40 })
  })

  it('落一个节点回它的 id，好把它选中', () => {
    const graph = useModelingGraph()

    const id = graph.addNode('src', { left: 0, top: 0 })

    expect(graph.graph.value.nodes[0]?.id).toBe(id)
  })

  it('撤销之后能重做回来', () => {
    const graph = useModelingGraph()
    graph.addNode('src', { left: 0, top: 0 })

    graph.undo()
    expect(graph.graph.value.nodes).toHaveLength(0)
    graph.redo()

    expect(graph.graph.value.nodes).toHaveLength(1)
  })

  // ⚠ 不清空的话，改一笔之后按重做会跳回另一条已经被覆盖的分支上
  it('重做栈在新改动落下时清空', () => {
    const graph = useModelingGraph()
    graph.addNode('src', { left: 0, top: 0 })
    graph.undo()

    graph.addNode('mid', { left: 10, top: 10 })

    expect(graph.canRedo.value).toBe(false)
  })

  it('改显示名只动那一个节点', () => {
    const graph = useModelingGraph()
    const id = graph.addNode('src', { left: 0, top: 0 })

    graph.setAlias(id, '取数')

    expect(graph.graph.value.nodes[0]?.alias).toBe('取数')
  })
})
