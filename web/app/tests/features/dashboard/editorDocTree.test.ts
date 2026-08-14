/**
 * @fileoverview 树操作纯函数的口径：最上层选中集、换父防环、层内重排收拢、
 * 批量几何一笔落。
 */
import { describe, expect, it } from 'vitest'
import type { DashboardNodePayload } from '@dt/contracts'

import {
  bringToFront,
  moveNode,
  sendToBack,
  setGeometryBatch,
  topMostIds,
} from '@/features/dashboard/editorDoc'

function node(
  id: string,
  parentId: string | null,
  zIndex: number,
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd-1',
    parentId,
    clientKey: null,
    moduleType: 'text-block',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex,
    isVisible: true,
    configJson: {},
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
    bindings: [],
  }
}

function zOf(nodes: readonly DashboardNodePayload[], id: string): number {
  const found = nodes.find((item) => item.id === id)
  expect(found).toBeDefined()
  return found?.zIndex ?? -1
}

describe('topMostIds', () => {
  it('祖先在选中集里的后代被剔除', () => {
    const nodes = [node('a', null, 0), node('a1', 'a', 0), node('a11', 'a1', 0)]
    expect(topMostIds(nodes, ['a', 'a11'])).toEqual(['a'])
    expect(topMostIds(nodes, ['a1', 'a11'])).toEqual(['a1'])
    expect(topMostIds(nodes, ['a11'])).toEqual(['a11'])
  })
})

describe('置顶置底', () => {
  const nodes = [node('a', null, 0), node('b', null, 1), node('c', null, 2)]

  it('置顶后同层 z 连续且目标最大', () => {
    const next = bringToFront(nodes, 'a')
    expect(zOf(next, 'a')).toBe(2)
    expect(zOf(next, 'b')).toBe(0)
    expect(zOf(next, 'c')).toBe(1)
  })

  it('置底后目标最小，其余相对序不变', () => {
    const next = sendToBack(nodes, 'c')
    expect(zOf(next, 'c')).toBe(0)
    expect(zOf(next, 'a')).toBe(1)
    expect(zOf(next, 'b')).toBe(2)
  })

  it('不存在的节点原样返回', () => {
    expect(bringToFront(nodes, 'ghost')).toEqual(nodes)
  })
})

describe('moveNode', () => {
  const nodes = [
    node('a', null, 0),
    node('a1', 'a', 0),
    node('b', null, 1),
    node('b1', 'b', 0),
    node('b2', 'b', 1),
  ]

  it('换父后目标层排最后、老层收拢', () => {
    const next = moveNode(nodes, 'b1', 'a')
    const moved = next.find((item) => item.id === 'b1')
    expect(moved?.parentId).toBe('a')
    expect(zOf(next, 'a1')).toBe(0)
    expect(zOf(next, 'b1')).toBe(1)
    // 老层 b2 从 1 收拢到 0
    expect(zOf(next, 'b2')).toBe(0)
  })

  it('挪进自己的子树被拒，原样返回', () => {
    expect(moveNode(nodes, 'a', 'a1')).toEqual(nodes)
    expect(moveNode(nodes, 'a', 'a')).toEqual(nodes)
  })

  it('同层指定落位是重排不是换父', () => {
    const next = moveNode(nodes, 'b2', 'b', 0)
    expect(zOf(next, 'b2')).toBe(0)
    expect(zOf(next, 'b1')).toBe(1)
  })

  it('挪到顶层也收拢老层', () => {
    const next = moveNode(nodes, 'b1', null)
    const moved = next.find((item) => item.id === 'b1')
    expect(moved?.parentId).toBeNull()
    expect(zOf(next, 'b2')).toBe(0)
  })
})

describe('setGeometryBatch', () => {
  it('一次改多个，未涉及的保持同引用', () => {
    const nodes = [node('a', null, 0), node('b', null, 1)]
    const next = setGeometryBatch(
      nodes,
      new Map([
        ['a', { x: 10, y: 20, w: 200, h: 100 }],
        ['ghost', { x: 1, y: 1, w: 1, h: 1 }],
      ]),
    )
    expect(next.find((item) => item.id === 'a')?.x).toBe(10)
    expect(next[1]).toBe(nodes[1])
  })

  it('小数几何被取整——服务端整数字段收到小数是整批 422', () => {
    const nodes = [node('a', null, 0)]
    const next = setGeometryBatch(
      nodes,
      new Map([['a', { x: 10.4, y: 19.6, w: 200.5, h: 99.5 }]]),
    )
    const moved = next[0]
    expect(moved?.x).toBe(10)
    expect(moved?.y).toBe(20)
    expect(moved?.w).toBe(201)
    expect(moved?.h).toBe(100)
  })
})
