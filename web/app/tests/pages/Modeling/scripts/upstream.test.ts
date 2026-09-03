/**
 * @fileoverview 列候选只看上游那条支路。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  sourceTablesFor,
  upstreamSourcesFor,
  visibleKeysOf,
  withAncestorsOf,
} from '@/pages/Modeling/Canvas/scripts/upstream'

function operator(code: string, category: string): ModelingOperator {
  return {
    code,
    name: code,
    description: '',
    category,
    spec_version: '1',
    icon: 'table',
    inputs: [],
    outputs: [],
    config_schema: {},
    fit_required: false,
    serving_enabled: false,
    serving_window_required: false,
    serving_channel: 'json',
  }
}

const OPERATORS = new Map([
  ['src', operator('src', 'source')],
  ['mid', operator('mid', 'preprocess')],
])

/** 两条互不相干的支路：src1 → m1、src2 → m2。 */
const GRAPH: ModelingGraph = {
  format_version: '1',
  nodes: [
    {
      id: 's1',
      operator: 'src',
      alias: '',
      position: { left: 0, top: 0 },
      config: { table_code: 'energy' },
    },
    {
      id: 's2',
      operator: 'src',
      alias: '',
      position: { left: 0, top: 0 },
      config: { table_code: 'water' },
    },
    {
      id: 'm1',
      operator: 'mid',
      alias: '',
      position: { left: 0, top: 0 },
      config: {},
    },
    {
      id: 'm2',
      operator: 'mid',
      alias: '',
      position: { left: 0, top: 0 },
      config: {},
    },
  ],
  edges: [
    { id: 'e1', from_node: 's1', from_port: 'o', to_node: 'm1', to_port: 'i' },
    { id: 'e2', from_node: 's2', from_port: 'o', to_node: 'm2', to_port: 'i' },
  ],
}

describe('往上游走', () => {
  it('含它自己，以及顺着边够得到的所有上游', () => {
    expect([...withAncestorsOf(GRAPH, 'm1')].sort()).toEqual(['m1', 's1'])
  })

  it('图里有环时也走得完，不会转不出来', () => {
    const looped: ModelingGraph = {
      ...GRAPH,
      edges: [
        {
          id: 'a',
          from_node: 'm1',
          from_port: 'o',
          to_node: 's1',
          to_port: 'i',
        },
        {
          id: 'b',
          from_node: 's1',
          from_port: 'o',
          to_node: 'm1',
          to_port: 'i',
        },
      ],
    }

    expect(withAncestorsOf(looped, 'm1').size).toBe(2)
  })
})

// ⚠ 拿「图里所有取数节点」凑数的话，另一支的列名会被列进来，
// 用户勾了要等运行时才报「这一列不存在」
describe('列候选看哪几张台账', () => {
  it('只看上游那条支路上的取数节点', () => {
    expect(sourceTablesFor(GRAPH, OPERATORS, 'm1')).toEqual(['energy'])
    expect(sourceTablesFor(GRAPH, OPERATORS, 'm2')).toEqual(['water'])
  })

  it('取数节点自己看的是它自己选的那张', () => {
    expect(sourceTablesFor(GRAPH, OPERATORS, 's2')).toEqual(['water'])
  })

  it('不指定节点时看整张图', () => {
    expect(sourceTablesFor(GRAPH, OPERATORS, null).sort()).toEqual([
      'energy',
      'water',
    ])
  })

  it('还没选台账的取数节点不算数', () => {
    const blank: ModelingGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === 's1' ? { ...node, config: { table_code: '' } } : node,
      ),
    }

    expect(sourceTablesFor(blank, OPERATORS, 'm1')).toEqual([])
  })
})

// ⚠ 收窄口径必须与后端 `graph_walk.known_keys_by_node` 一致：只列台账的全部列
// 时，下游能勾到一列上游根本不产出的列，而报错要到保存 / 运行才出来
describe('上游取数挑了列之后，下游候选跟着收窄', () => {
  function narrowed(picked: string[]): ModelingGraph {
    return {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === 's1'
          ? { ...node, config: { table_code: 'energy', columns: picked } }
          : node,
      ),
    }
  }

  it('挑过列就只剩那几列', () => {
    const sources = upstreamSourcesFor(narrowed(['F2', 'F3']), OPERATORS, 'm1')
    expect(visibleKeysOf(sources)).toEqual(new Set(['F2', 'F3']))
  })

  it('留空的语义是「取全部列」，那时不收窄', () => {
    const sources = upstreamSourcesFor(narrowed([]), OPERATORS, 'm1')
    expect(visibleKeysOf(sources)).toBeNull()
  })

  it('上游一个取数都没有时也不收窄', () => {
    expect(visibleKeysOf([])).toBeNull()
  })

  it('两支里只要有一支留空，整体就推不出来', () => {
    const both: ModelingGraph = {
      ...narrowed(['F2']),
      edges: [
        ...GRAPH.edges,
        {
          id: 'e3',
          from_node: 's2',
          from_port: 'o',
          to_node: 'm1',
          to_port: 'j',
        },
      ],
    }

    expect(visibleKeysOf(upstreamSourcesFor(both, OPERATORS, 'm1'))).toBeNull()
  })
})
