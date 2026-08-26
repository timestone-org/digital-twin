/**
 * @fileoverview 守连线归一化的三条口径：悬空端点丢整条、脏拐点逐个丢、走线档闭合。
 * ⚠ 悬空那一条是重点：改成「照画」不会有任何一处报错，只会在图上多出一条
 * 通向画布原点的斜线，同时把 `edgeValues` 的文档序整体错开一格。
 */
import { describe, expect, it } from 'vitest'

import {
  normalizeEdge,
  normalizeEdges,
  normalizeEndpoint,
  normalizeWaypoints,
} from '../src/normalizeEdges'

const NODE_IDS: ReadonlySet<string> = new Set(['n1', 'n2', '7'])

function edgeRaw(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'e1',
    styleId: 'water',
    from: { nodeId: 'n1' },
    to: { nodeId: 'n2' },
    ...patch,
  }
}

describe('端点归一化', () => {
  it('指到已有节点才留下，端点本身不是对象就没有身份', () => {
    expect(normalizeEndpoint({ nodeId: 'n1' }, NODE_IDS)).toEqual({
      nodeId: 'n1',
      portId: '',
      t: null,
    })
    expect(normalizeEndpoint(null, NODE_IDS)).toBeNull()
    expect(normalizeEndpoint('n1', NODE_IDS)).toBeNull()
  })

  it('节点 id 缺失或指不到已有节点一律没有归宿', () => {
    expect(normalizeEndpoint({ nodeId: '  ' }, NODE_IDS)).toBeNull()
    expect(normalizeEndpoint({}, NODE_IDS)).toBeNull()
    expect(normalizeEndpoint({ nodeId: 'ghost' }, NODE_IDS)).toBeNull()
  })

  it('数字 id 走 String() 收，与节点集合对得上', () => {
    expect(normalizeEndpoint({ nodeId: 7 }, NODE_IDS)?.nodeId).toBe('7')
  })

  it('portId 留空表示由几何自动选边，不是丢弃理由', () => {
    const endpoint = normalizeEndpoint({ nodeId: 'n1', portId: '  ' }, NODE_IDS)
    expect(endpoint?.portId).toBe('')
  })

  it('portId 取 trim 后的值', () => {
    const endpoint = normalizeEndpoint(
      { nodeId: 'n1', portId: ' p1 ' },
      NODE_IDS,
    )
    expect(endpoint?.portId).toBe('p1')
  })

  it('沿边参数夹到 [0,1]，取不到数就是「没有钉周长参数」', () => {
    expect(normalizeEndpoint({ nodeId: 'n1', t: 0.25 }, NODE_IDS)?.t).toBe(0.25)
    expect(normalizeEndpoint({ nodeId: 'n1', t: -3 }, NODE_IDS)?.t).toBe(0)
    expect(normalizeEndpoint({ nodeId: 'n1', t: 9 }, NODE_IDS)?.t).toBe(1)
    expect(
      normalizeEndpoint({ nodeId: 'n1', t: Number.NaN }, NODE_IDS)?.t,
    ).toBeNull()
    expect(normalizeEndpoint({ nodeId: 'n1' }, NODE_IDS)?.t).toBeNull()
  })
})

describe('拐点归一化', () => {
  it('非数组进来是空拐点，不是异常', () => {
    expect(normalizeWaypoints(undefined)).toEqual([])
    expect(normalizeWaypoints({ x: 1, y: 2 })).toEqual([])
  })

  it('脏点逐个丢，其余照留（丢一个拐点线还在两端之间）', () => {
    const points = normalizeWaypoints([
      { x: 10, y: 20 },
      null,
      'nope',
      { x: Number.POSITIVE_INFINITY, y: 1 },
      { x: 1, y: Number.NaN },
      { y: 5 },
      { x: 30, y: 40 },
    ])
    expect(points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ])
  })

  it('数字串按设计像素收', () => {
    expect(normalizeWaypoints([{ x: '12', y: '-3.5' }])).toEqual([
      { x: 12, y: -3.5 },
    ])
  })
})

describe('单条连线归一化', () => {
  it('补全全部键，走线缺省跟随样式、标签落在中点', () => {
    expect(normalizeEdge(edgeRaw({}), NODE_IDS)).toEqual({
      id: 'e1',
      styleId: 'water',
      from: { nodeId: 'n1', portId: '', t: null },
      to: { nodeId: 'n2', portId: '', t: null },
      route: 'auto',
      waypoints: [],
      accent: '',
      label: '',
      labelAt: 0.5,
    })
  })

  it('连线本身不是对象、或 id 缺失，整条丢弃', () => {
    expect(normalizeEdge(42, NODE_IDS)).toBeNull()
    expect(normalizeEdge(edgeRaw({ id: '   ' }), NODE_IDS)).toBeNull()
  })

  it('任一端指向不存在的节点 → 整条丢弃，而不是画一条到 (0,0) 的线', () => {
    expect(
      normalizeEdge(edgeRaw({ from: { nodeId: 'ghost' } }), NODE_IDS),
    ).toBeNull()
    expect(
      normalizeEdge(edgeRaw({ to: { nodeId: 'ghost' } }), NODE_IDS),
    ).toBeNull()
    expect(normalizeEdge(edgeRaw({ to: null }), NODE_IDS)).toBeNull()
  })

  it('走线四档加 auto 之外的取值回 auto（跟随样式，不就地钉死一档）', () => {
    expect(normalizeEdge(edgeRaw({ route: 'bezier' }), NODE_IDS)?.route).toBe(
      'bezier',
    )
    expect(normalizeEdge(edgeRaw({ route: 'step' }), NODE_IDS)?.route).toBe(
      'step',
    )
    expect(normalizeEdge(edgeRaw({ route: 'zigzag' }), NODE_IDS)?.route).toBe(
      'auto',
    )
    expect(normalizeEdge(edgeRaw({ route: 3 }), NODE_IDS)?.route).toBe('auto')
  })

  it('样式 id 允许为空，由渲染层落回预置库', () => {
    expect(normalizeEdge(edgeRaw({ styleId: null }), NODE_IDS)?.styleId).toBe(
      '',
    )
  })

  it('标签沿弧长的位置夹到 [0,1]', () => {
    expect(normalizeEdge(edgeRaw({ labelAt: 0 }), NODE_IDS)?.labelAt).toBe(0)
    expect(normalizeEdge(edgeRaw({ labelAt: 4 }), NODE_IDS)?.labelAt).toBe(1)
    expect(normalizeEdge(edgeRaw({ labelAt: -1 }), NODE_IDS)?.labelAt).toBe(0)
    expect(normalizeEdge(edgeRaw({ labelAt: 'x' }), NODE_IDS)?.labelAt).toBe(
      0.5,
    )
  })

  it('强调色与标签取 trim 后的值，空串表示跟随样式', () => {
    const edge = normalizeEdge(
      edgeRaw({ accent: ' #f00 ', label: ' L1 ' }),
      NODE_IDS,
    )
    expect(edge?.accent).toBe('#f00')
    expect(edge?.label).toBe('L1')
    expect(normalizeEdge(edgeRaw({ accent: 5 }), NODE_IDS)?.accent).toBe('')
  })

  it('脏拐点被逐个丢掉，连线照留', () => {
    const edge = normalizeEdge(
      edgeRaw({ waypoints: [{ x: 1, y: 2 }, {}, { x: 3, y: 4 }] }),
      NODE_IDS,
    )
    expect(edge?.waypoints).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ])
  })
})

describe('整份连线列表', () => {
  it('非数组是空列表', () => {
    expect(normalizeEdges(null, NODE_IDS)).toEqual([])
  })

  it('丢弃脏条目与悬空连线，其余保持文档序', () => {
    const edges = normalizeEdges(
      [
        edgeRaw({ id: 'e1' }),
        'nope',
        edgeRaw({ id: 'e2', from: { nodeId: 'ghost' } }),
        edgeRaw({ id: 'e3' }),
      ],
      NODE_IDS,
    )
    expect(edges.map((edge) => edge.id)).toEqual(['e1', 'e3'])
  })

  it('同 id 只留最先出现的一条', () => {
    const edges = normalizeEdges(
      [edgeRaw({ id: 'e1', label: '先' }), edgeRaw({ id: 'e1', label: '后' })],
      NODE_IDS,
    )
    expect(edges).toHaveLength(1)
    expect(edges[0]?.label).toBe('先')
  })

  it('节点集合为空时一条都留不下', () => {
    expect(normalizeEdges([edgeRaw({})], new Set<string>())).toEqual([])
  })
})
