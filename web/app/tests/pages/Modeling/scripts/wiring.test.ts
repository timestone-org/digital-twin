/**
 * @fileoverview 连线的四条判据、方向归一、落在卡片上的自动选口、边的几何，
 * 以及接点命中测试。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  arrowOf,
  curveOf,
  midOf,
} from '@/pages/Modeling/Canvas/scripts/edgeCurve'
import { openPortsOf, portKey } from '@/pages/Modeling/Canvas/scripts/openPorts'
import {
  NODE_ID_ATTR,
  PORT_NAME_ATTR,
  PORT_NODE_ATTR,
  PORT_SIDE_ATTR,
  portHitOf,
} from '@/pages/Modeling/Canvas/scripts/portHits'
import {
  autoEndOf,
  dropEndOf,
  edgeOf,
  isReachableFrom,
  orderEnds,
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
      { node: 'mid', port: 'out', side: 'out' },
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
      { node: 'src', port: 'out', side: 'out' },
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
      { node: 'other', port: 'out', side: 'out' },
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
      { node: 'b', port: 'out', side: 'out' },
      { node: 'a', port: 'in', side: 'in' },
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('环')
  })

  it('四条都过就放行', () => {
    const verdict = verdictOf(
      graph([
        ['src', 'src'],
        ['mid', 'mid'],
      ]),
      OPERATORS,
      { node: 'src', port: 'out', side: 'out' },
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
      { node: 'src', port: '不存在', side: 'out' },
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
      { node: 'a', port: 'out', side: 'out' },
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

describe('方向归一', () => {
  it('从出口拉到入口，原样收下', () => {
    const ends = orderEnds(
      { node: 'a', port: 'out', side: 'out' },
      { node: 'b', port: 'in', side: 'in' },
    )

    expect(ends?.out.node).toBe('a')
    expect(ends?.into.node).toBe('b')
  })

  it('从入口反着往回拉也认，两端调过来', () => {
    const ends = orderEnds(
      { node: 'b', port: 'in', side: 'in' },
      { node: 'a', port: 'out', side: 'out' },
    )

    expect(ends?.out.node).toBe('a')
    expect(ends?.into.node).toBe('b')
  })

  it('同一侧的两个口连不起来', () => {
    expect(
      orderEnds(
        { node: 'a', port: 'out', side: 'out' },
        { node: 'b', port: 'out', side: 'out' },
      ),
    ).toBeNull()
  })
})

describe('松手落在卡片上时替用户选口', () => {
  const current = graph([
    ['src', 'src'],
    ['mid', 'mid'],
  ])

  it('从出口拉过来，挑目标卡片上契约相符的入口', () => {
    const picked = autoEndOf(
      current,
      OPERATORS,
      { node: 'src', port: 'out', side: 'out' },
      'mid',
    )

    expect(picked).toEqual({ node: 'mid', port: 'in', side: 'in' })
  })

  it('契约都对不上时不硬接，给 null', () => {
    const withEval = graph([
      ['src', 'src'],
      ['eval', 'eval'],
    ])

    expect(
      autoEndOf(
        withEval,
        OPERATORS,
        { node: 'src', port: 'out', side: 'out' },
        'eval',
      ),
    ).toBeNull()
  })

  it('入口已经被占就不再挑它', () => {
    const wired = graph(
      [
        ['src', 'src'],
        ['other', 'src'],
        ['mid', 'mid'],
      ],
      [['src', 'out', 'mid', 'in']],
    )

    expect(
      autoEndOf(
        wired,
        OPERATORS,
        { node: 'other', port: 'out', side: 'out' },
        'mid',
      ),
    ).toBeNull()
  })

  it('落点先认接点：落在接点上时不走自动选口', () => {
    const port = document.createElement('span')
    port.setAttribute(PORT_NODE_ATTR, 'mid')
    port.setAttribute(PORT_NAME_ATTR, 'in')
    port.setAttribute(PORT_SIDE_ATTR, 'in')

    expect(
      dropEndOf(
        current,
        OPERATORS,
        { node: 'src', port: 'out', side: 'out' },
        port,
      ),
    ).toEqual({ node: 'mid', port: 'in', side: 'in' })
  })

  it('落在卡片空白处也算数——这正是「连不上线」的那一半原因', () => {
    const card = document.createElement('div')
    card.setAttribute(NODE_ID_ATTR, 'mid')
    const inner = document.createElement('p')
    card.append(inner)

    expect(
      dropEndOf(
        current,
        OPERATORS,
        { node: 'src', port: 'out', side: 'out' },
        inner,
      ),
    ).toEqual({ node: 'mid', port: 'in', side: 'in' })
  })

  it('落回自己那张卡片上不算数', () => {
    const card = document.createElement('div')
    card.setAttribute(NODE_ID_ATTR, 'src')

    expect(
      dropEndOf(
        current,
        OPERATORS,
        { node: 'src', port: 'out', side: 'out' },
        card,
      ),
    ).toBeNull()
  })
})

describe('拉线时哪些口还接得住', () => {
  const current = graph([
    ['src', 'src'],
    ['mid', 'mid'],
    ['eval', 'eval'],
  ])

  it('没在拉线时给一张空表', () => {
    expect(openPortsOf(current, OPERATORS, null).size).toBe(0)
  })

  it('只有契约相符的那个入口亮着', () => {
    const table = openPortsOf(current, OPERATORS, {
      node: 'src',
      port: 'out',
      side: 'out',
    })

    expect(table.get('mid')?.has(portKey('in', 'in'))).toBe(true)
    expect(table.get('eval')?.has(portKey('in', 'm'))).toBe(false)
    expect(table.get('src')?.size).toBe(0)
  })

  it('会绕成环的那个入口不亮', () => {
    const wired = graph(
      [
        ['a', 'mid'],
        ['b', 'mid'],
      ],
      [['a', 'out', 'b', 'in']],
    )

    expect(
      isReachableFrom(
        wired,
        OPERATORS,
        { node: 'b', port: 'out', side: 'out' },
        { node: 'a', port: 'in', side: 'in' },
      ),
    ).toBe(false)
  })
})

describe('边画出来的样子', () => {
  it('中点落在两端的正中', () => {
    expect(midOf({ left: 0, top: 0 }, { left: 200, top: 100 })).toEqual({
      left: 100,
      top: 50,
    })
  })

  it('箭头是个闭合三角，尖端落在入口上', () => {
    const path = arrowOf({ left: 200, top: 100 })

    expect(path.startsWith('M 200 100')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })
})
