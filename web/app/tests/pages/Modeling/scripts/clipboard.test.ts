/**
 * @fileoverview 画布剪贴板：只搬内部的边、跨流水线读回来要逐项验形。
 */
import type { ModelingGraphEdge, ModelingGraphNode } from '@dt/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clipOf,
  readClip,
  writeClip,
} from '@/pages/Modeling/Canvas/scripts/clipboard'

const KEY = 'dt.modeling.clipboard.v1'

function node(id: string): ModelingGraphNode {
  return {
    id,
    operator: 'op',
    alias: '',
    config: { row_limit: 100 },
    position: { left: 10, top: 20 },
  }
}

function edge(from: string, to: string): ModelingGraphEdge {
  return {
    id: `${from}->${to}`,
    from_node: from,
    from_port: 'out',
    to_node: to,
    to_port: 'in',
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('由选中集造载荷', () => {
  it('只搬两端都在选中集里的边', () => {
    const clip = clipOf(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c')],
      ['a', 'b'],
    )

    expect(clip?.nodes.map((item) => item.id)).toEqual(['a', 'b'])
    expect(clip?.edges.map((item) => item.id)).toEqual(['a->b'])
  })

  it('什么都没选中时给 null', () => {
    expect(clipOf([node('a')], [], [])).toBeNull()
  })

  it('载荷是深拷贝，之后改图改不到剪贴板里那份', () => {
    const source = node('a')
    const clip = clipOf([source], [], ['a'])
    source.config['row_limit'] = 999

    expect(clip?.nodes[0]?.config['row_limit']).toBe(100)
  })
})

describe('写进去再读回来', () => {
  it('原样读得回来', () => {
    writeClip({ nodes: [node('a')], edges: [] })

    expect(readClip()?.nodes[0]?.id).toBe('a')
  })

  it('没写过时给 null', () => {
    expect(readClip()).toBeNull()
  })

  it('存的不是 JSON 时给 null，不抛', () => {
    window.localStorage.setItem(KEY, '这不是 JSON')

    expect(readClip()).toBeNull()
  })

  it('形状对不上的节点整条丢掉，不粘出半个节点来', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ nodes: [{ id: 'a' }], edges: [] }),
    )

    expect(readClip()).toBeNull()
  })

  it('位置缺失时补零，而不是变成 NaN 落到画布外', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        nodes: [{ id: 'a', operator: 'op' }],
        edges: [],
      }),
    )

    expect(readClip()?.nodes[0]?.position).toEqual({ left: 0, top: 0 })
  })

  it('端点缺失的边丢掉，节点仍然粘得出来', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        nodes: [{ id: 'a', operator: 'op' }],
        edges: [{ id: 'x', from_node: 'a' }],
      }),
    )

    expect(readClip()?.edges).toEqual([])
  })

  it('浏览器不给写时静默作罢，不把一次复制变成一条报错', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })

    expect(() => writeClip({ nodes: [node('a')], edges: [] })).not.toThrow()
  })

  it('浏览器不给读时给 null，不抛', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(readClip()).toBeNull()
  })
})
