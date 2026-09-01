/**
 * @fileoverview 连线的四条判据、边的几何，以及接点命中测试。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  PORT_NAME_ATTR,
  PORT_NODE_ATTR,
  PORT_SIDE_ATTR,
  curveOf,
  edgeOf,
  portHitOf,
  verdictOf,
} from '@/pages/Modeling/Canvas/scripts/useCanvasWiring'

function operator(
  code: string,
  inputs: [string, string][],
  outputs: [string, string][],
): ModelingOperator {
  const port = ([name, contract]: [string, string]) => ({
    name,
    contract,
    label: name,
    is_required: true,
    description: '',
  })
  return {
    code,
    name: code,
    description: '',
    category: 'preprocess',
    spec_version: '1',
    icon: 'workflow',
    inputs: inputs.map(port),
    outputs: outputs.map(port),
    config_schema: {},
    fit_required: false,
    serving_enabled: false,
    serving_window_required: false,
    serving_channel: 'json',
  }
}

const OPERATORS = new Map<string, ModelingOperator>([
  ['src', operator('src', [], [['out', 'frame']])],
  ['mid', operator('mid', [['in', 'frame']], [['out', 'frame']])],
  ['fit', operator('fit', [['in', 'frame']], [['out', 'model']])],
  ['eval', operator('eval', [['m', 'model']], [])],
])

function graph(
  nodes: [string, string][],
  edges: [string, string, string, string][] = [],
): ModelingGraph {
  return {
    format_version: '1',
    nodes: nodes.map(([id, code]) => ({
      id,
      operator: code,
      alias: '',
      position: { left: 0, top: 0 },
      config: {},
    })),
    edges: edges.map(([fn, fp, tn, tp]) => ({
      id: `${fn}:${fp}->${tn}:${tp}`,
      from_node: fn,
      from_port: fp,
      to_node: tn,
      to_port: tp,
    })),
  }
}

describe('一条线能不能连', () => {
  it('接到自己身上不行', () => {
    const verdict = verdictOf(
      graph([['mid', 'mid']]),
      OPERATORS,
      { node: 'mid', port: 'out' },
      { node: 'mid', port: 'in', side: 'in' },
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('自己')
  })

  it('契约对不上不行', () => {
    const verdict = verdictOf(
      graph([
        ['src', 'src'],
        ['eval', 'eval'],
      ]),
      OPERATORS,
      { node: 'src', port: 'out' },
      { node: 'eval', port: 'm', side: 'in' },
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('类型')
  })

  it('一个入口只收一条线', () => {
    const current = graph(
      [
        ['src', 'src'],
        ['other', 'src'],
        ['mid', 'mid'],
      ],
      [['src', 'out', 'mid', 'in']],
    )

    const verdict = verdictOf(
      current,
      OPERATORS,
      { node: 'other', port: 'out' },
      { node: 'mid', port: 'in', side: 'in' },
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('已经接了')
  })

  it('会绕成环的不行', () => {
    const current = graph(
      [
        ['a', 'mid'],
        ['b', 'mid'],
      ],
      [['a', 'out', 'b', 'in']],
    )

    const verdict = verdictOf(
      current,
      OPERATORS,
      { node: 'b', port: 'out' },
      { node: 'a', port: 'in', side: 'in' },
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('环')
  })

  it('落在输出口上不算一次连接', () => {
    const verdict = verdictOf(
      graph([
        ['src', 'src'],
        ['mid', 'mid'],
      ]),
      OPERATORS,
      { node: 'src', port: 'out' },
      { node: 'mid', port: 'out', side: 'out' },
    )

    expect(verdict.ok).toBe(false)
  })

  it('四条都过就放行', () => {
    const verdict = verdictOf(
      graph([
        ['src', 'src'],
        ['mid', 'mid'],
      ]),
      OPERATORS,
      { node: 'src', port: 'out' },
      { node: 'mid', port: 'in', side: 'in' },
    )

    expect(verdict).toEqual({ ok: true, reason: '' })
  })

  it('认不出的接点当作不存在，而不是当作合法', () => {
    const verdict = verdictOf(
      graph([
        ['src', 'src'],
        ['mid', 'mid'],
      ]),
      OPERATORS,
      { node: 'src', port: '不存在' },
      { node: 'mid', port: 'in', side: 'in' },
    )

    expect(verdict.ok).toBe(false)
  })
})

describe('边的几何与命中', () => {
  it('贝塞尔从起点出发、落到终点', () => {
    const path = curveOf({ left: 0, top: 0 }, { left: 200, top: 100 })

    expect(path.startsWith('M 0 0')).toBe(true)
    expect(path.endsWith('200 100')).toBe(true)
  })

  it('边 id 由两端拼出来，同一对端点只会得到同一个 id', () => {
    const edge = edgeOf(
      { node: 'a', port: 'out' },
      { node: 'b', port: 'in', side: 'in' },
    )

    expect(edge.id).toBe('a:out->b:in')
    expect(edge.from_node).toBe('a')
    expect(edge.to_port).toBe('in')
  })

  it('落在接点里面的子元素上也算命中那个接点', () => {
    const host = document.createElement('span')
    host.setAttribute(PORT_NODE_ATTR, 'n1')
    host.setAttribute(PORT_NAME_ATTR, 'out')
    host.setAttribute(PORT_SIDE_ATTR, 'out')
    const inner = document.createElement('i')
    host.append(inner)

    expect(portHitOf(inner)).toEqual({ node: 'n1', port: 'out', side: 'out' })
  })

  it('没落在接点上给 null', () => {
    expect(portHitOf(document.createElement('div'))).toBeNull()
    expect(portHitOf(null)).toBeNull()
  })
})
