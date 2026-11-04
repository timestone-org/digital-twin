/**
 * @fileoverview 一键整理：按拓扑分层重排。
 */
import type { ModelingGraph } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { layoutGraph } from '@/pages/Modeling/Canvas/scripts/autoLayout'

const SIZES = new Map([
  ['a', { width: 200, height: 60 }],
  ['b', { width: 200, height: 60 }],
  ['c', { width: 200, height: 60 }],
])

function graph(ids: string[], edges: [string, string][] = []): ModelingGraph {
  return {
    format_version: '1',
    nodes: ids.map((id) => ({
      id,
      operator: 'op',
      alias: '',
      position: { left: 0, top: 0 },
      config: {},
    })),
    edges: edges.map(([from, to]) => ({
      id: `${from}->${to}`,
      from_node: from,
      from_port: 'out',
      to_node: to,
      to_port: 'in',
    })),
  }
}

describe('按数据流方向重排', () => {
  it('一条链排成一行，越靠下游越靠右', () => {
    const moves = layoutGraph(
      graph(
        ['a', 'b', 'c'],
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
      ),
      SIZES,
    )

    const left = (id: string): number => moves.get(id)?.left ?? 0
    expect(left('a')).toBeLessThan(left('b'))
    expect(left('b')).toBeLessThan(left('c'))
  })

  it('没有上游的节点都在第一层，纵向排开互不重叠', () => {
    const moves = layoutGraph(graph(['a', 'b']), SIZES)

    expect(moves.get('a')?.left).toBe(moves.get('b')?.left)
    expect(moves.get('a')?.top).not.toBe(moves.get('b')?.top)
  })

  // ⚠ 层号取最长路径：按最短算的话，旁路会把末端拽到很靠前的一层，边要往回画
  it('有旁路时末端仍排在最后一层', () => {
    const moves = layoutGraph(
      graph(
        ['a', 'b', 'c'],
        [
          ['a', 'b'],
          ['b', 'c'],
          ['a', 'c'],
        ],
      ),
      SIZES,
    )

    const left = (id: string): number => moves.get(id)?.left ?? 0
    expect(left('c')).toBeGreaterThan(left('b'))
  })

  it('量不到尺寸时按兜底算，而不是把所有卡片摞在一点上', () => {
    const moves = layoutGraph(graph(['a', 'b']), new Map())

    expect(moves.get('a')?.top).not.toBe(moves.get('b')?.top)
  })

  // ⚠ 带环的图（导入进来的、或被旧版本存坏的）不能让分层转成死循环
  it('图里有环时也能算完，不会转不出来', () => {
    const moves = layoutGraph(
      graph(
        ['a', 'b'],
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
      ),
      SIZES,
    )

    expect(moves.size).toBe(2)
  })

  it('空图给一张空表', () => {
    expect(layoutGraph(graph([]), SIZES).size).toBe(0)
  })

  it('反向节点顺序下异尺寸分支汇合与孤立节点仍不重叠，配置和连线不变', () => {
    const input = graph(
      ['join', 'right', 'isolated', 'left', 'source'],
      [
        ['source', 'left'],
        ['source', 'right'],
        ['left', 'join'],
        ['right', 'join'],
      ],
    )
    const before = structuredClone(input)
    const sizes = new Map([
      ['source', { width: 224, height: 100 }],
      ['left', { width: 224, height: 260 }],
      ['right', { width: 300, height: 90 }],
      ['join', { width: 224, height: 140 }],
      ['isolated', { width: 224, height: 220 }],
    ])
    const moves = layoutGraph(input, sizes)
    const boxes = input.nodes.map((node) => {
      const position = moves.get(node.id)
      const size = sizes.get(node.id)
      if (position === undefined || size === undefined)
        throw new Error('缺少节点矩形')
      return { id: node.id, ...position, ...size }
    })
    for (const edge of input.edges) {
      expect(moves.get(edge.to_node)?.left).toBeGreaterThan(
        moves.get(edge.from_node)?.left ?? Infinity,
      )
    }
    for (const [index, box] of boxes.entries()) {
      for (const other of boxes.slice(index + 1)) {
        const overlaps =
          box.left < other.left + other.width &&
          other.left < box.left + box.width &&
          box.top < other.top + other.height &&
          other.top < box.top + box.height
        expect(overlaps, `${box.id} 与 ${other.id} 不应重叠`).toBe(false)
      }
    }
    expect(input).toEqual(before)
    const arranged = {
      ...input,
      nodes: input.nodes.map((node) => ({
        ...node,
        position: moves.get(node.id) ?? node.position,
      })),
    }
    expect(layoutGraph(arranged, sizes)).toEqual(moves)
  })
})
