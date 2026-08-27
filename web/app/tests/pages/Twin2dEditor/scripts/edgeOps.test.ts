/**
 * @fileoverview 契约：连线的增删改、复制、层序与标签错开全是纯函数，改完再归一化不变形。
 *
 * ⚠ 两端必须指向已有节点：归一化把悬空端点的整条线丢掉，所以新增落不了地时交出的
 * 必须是原样的配置与 `id: null`——交一个指不到实处的 id 出去，调用方会拿它去选中
 * 一条根本不存在的线。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  addEdge,
  duplicateEdges,
  orderEdges,
  removeEdges,
  spreadEdgeLabels,
  updateEdge,
} from '@/pages/Twin2dEditor/scripts/edgeOps'

/** 造 id 的桩：按调用次序发号。 */
function idSeries(prefix: string): () => string {
  let seq = 0
  return () => {
    seq += 1
    return `${prefix}${seq}`
  }
}

function configOf(): Twin2dConfig {
  return normalizeTwin2dConfig({
    styles: [{ id: 'sty' }],
    nodes: [
      { id: 'a', styleId: 'sty' },
      { id: 'b', styleId: 'sty' },
      { id: 'c', styleId: 'sty' },
    ],
    edges: [
      { id: 'e1', styleId: 'wire', from: { nodeId: 'a' }, to: { nodeId: 'b' } },
      { id: 'e2', styleId: 'wire', from: { nodeId: 'b' }, to: { nodeId: 'c' } },
      { id: 'e3', styleId: 'wire', from: { nodeId: 'a' }, to: { nodeId: 'c' } },
    ],
  })
}

function idsOf(config: Twin2dConfig): string[] {
  return config.edges.map((edge) => edge.id)
}

describe('新增', () => {
  it('追加在末尾并交出新 id', () => {
    const next = addEdge(
      configOf(),
      {
        styleId: 'wire',
        from: { nodeId: 'c', portId: '', t: null },
        to: { nodeId: 'a', portId: '', t: null },
      },
      () => 'e9',
    )

    expect(next.id).toBe('e9')
    expect(idsOf(next.config)).toEqual(['e1', 'e2', 'e3', 'e9'])
  })

  // ⚠ 悬空端点的整条线会被归一化丢掉，这时不许交出一个指不到实处的 id
  it('端点悬空时落不了地，原样返回并交出 null', () => {
    const config = configOf()

    const next = addEdge(config, { styleId: 'wire' }, () => 'e9')

    expect(next.id).toBeNull()
    expect(next.config).toBe(config)
  })

  it('改完再归一化不变形', () => {
    const next = addEdge(
      configOf(),
      {
        styleId: 'wire',
        from: { nodeId: 'c', portId: '', t: null },
        to: { nodeId: 'a', portId: '', t: null },
      },
      () => 'e9',
    ).config

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('改值', () => {
  it('只换被点名的那一条', () => {
    const next = updateEdge(configOf(), 'e2', {
      label: '回水',
      route: 'bezier',
    })

    expect(next.edges[1]?.label).toBe('回水')
    expect(next.edges[1]?.route).toBe('bezier')
    expect(next.edges[0]?.label).toBe('')
  })

  it('连线不在就原样返回入参那个引用', () => {
    const config = configOf()

    expect(updateEdge(config, 'nope', { label: 'x' })).toBe(config)
  })

  // ⚠ 逐键写回时归一化会把刚敲下的空格 trim 掉
  it('改值不过归一化，用户敲的空格留得住', () => {
    expect(
      updateEdge(configOf(), 'e1', { label: '一段 ' }).edges[0]?.label,
    ).toBe('一段 ')
  })
})

describe('复制', () => {
  it('副本插在原件后面', () => {
    const next = duplicateEdges(configOf(), ['e1'], idSeries('copy'))

    expect(next.ids).toEqual(['copy1'])
    expect(idsOf(next.config)).toEqual(['e1', 'copy1', 'e2', 'e3'])
  })

  // ⚠ 连线的位置由两端决定，没有可加的位移；替用户塞一个偏移就等于替他决定走折线
  it('副本与原件两端完全重合且没有拐点', () => {
    const next = duplicateEdges(configOf(), ['e1'], idSeries('copy'))

    expect(next.config.edges[1]?.from.nodeId).toBe('a')
    expect(next.config.edges[1]?.to.nodeId).toBe('b')
    expect(next.config.edges[1]?.waypoints).toEqual([])
  })

  it('一条都没点中时原样返回入参那个引用', () => {
    const config = configOf()

    expect(duplicateEdges(config, ['nope']).config).toBe(config)
  })

  it('改完再归一化不变形', () => {
    const next = duplicateEdges(configOf(), ['e2']).config

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('删除', () => {
  it('删线只删它自己，节点不跟着走', () => {
    const next = removeEdges(configOf(), ['e1', 'e3'])

    expect(idsOf(next.config)).toEqual(['e2'])
    expect(next.removed.edges).toEqual(['e1', 'e3'])
    expect(next.removed.nodes).toEqual([])
    expect(next.config.nodes).toHaveLength(3)
  })

  it('一条都没点中时原样返回入参那个引用', () => {
    const config = configOf()
    const next = removeEdges(config, ['nope'])

    expect(next.config).toBe(config)
    expect(next.removed.edges).toEqual([])
  })

  it('改完再归一化不变形', () => {
    const next = removeEdges(configOf(), ['e2']).config

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('层序', () => {
  it('置顶挪到末尾、置底挪到表头', () => {
    expect(idsOf(orderEdges(configOf(), ['e1'], 'front'))).toEqual([
      'e2',
      'e3',
      'e1',
    ])
    expect(idsOf(orderEdges(configOf(), ['e3'], 'back'))).toEqual([
      'e3',
      'e1',
      'e2',
    ])
  })

  it('上下各挪一层', () => {
    expect(idsOf(orderEdges(configOf(), ['e1'], 'forward'))).toEqual([
      'e2',
      'e1',
      'e3',
    ])
    expect(idsOf(orderEdges(configOf(), ['e3'], 'backward'))).toEqual([
      'e1',
      'e3',
      'e2',
    ])
  })

  it('挪不动时原样返回入参那个引用', () => {
    const config = configOf()

    expect(orderEdges(config, ['e3'], 'forward')).toBe(config)
  })
})

describe('标签错开', () => {
  // ⚠ 几条平行线的标签默认都在中点，叠成一坨谁都读不出来，而它看着像标签没渲染
  it('三条按 1/4、2/4、3/4 摆开', () => {
    const next = spreadEdgeLabels(configOf(), ['e1', 'e2', 'e3'])

    expect(next.edges.map((edge) => edge.labelAt)).toEqual([0.25, 0.5, 0.75])
  })

  it('只有一条时落回中点', () => {
    const config = updateEdge(configOf(), 'e1', { labelAt: 0.9 })

    expect(spreadEdgeLabels(config, ['e1']).edges[0]?.labelAt).toBe(0.5)
  })

  it('没点中或已经摆好时原样返回入参那个引用', () => {
    const config = configOf()

    expect(spreadEdgeLabels(config, [])).toBe(config)
    expect(spreadEdgeLabels(config, ['e2'])).toBe(config)
  })
})
