/**
 * @fileoverview 树操作纯函数的口径：最上层选中集、换父防环、层内重排收拢、
 * 批量几何一笔落。
 */
import { describe, expect, it } from 'vitest'
import type { DashboardNodePayload } from '@dt/contracts'

import {
  bringForward,
  bringToFront,
  layerPositionOf,
  moveNode,
  sendBackward,
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

describe('逐层挪', () => {
  const nodes = [node('a', null, 0), node('b', null, 1), node('c', null, 2)]

  it('上移一层只与紧邻的那个换位，第三个不动', () => {
    const next = bringForward(nodes, 'a')
    expect([zOf(next, 'a'), zOf(next, 'b'), zOf(next, 'c')]).toEqual([1, 0, 2])
  })

  it('下移一层同理', () => {
    const next = sendBackward(nodes, 'c')
    expect([zOf(next, 'a'), zOf(next, 'b'), zOf(next, 'c')]).toEqual([0, 2, 1])
  })

  it('已经在这一头就原样返回，不该白记一笔撤销', () => {
    expect(bringForward(nodes, 'c')).toEqual(nodes)
    expect(sendBackward(nodes, 'a')).toEqual(nodes)
    expect(bringForward(nodes, 'ghost')).toEqual(nodes)
  })

  it('只在同一个父层里比较，别层的兄弟不参与', () => {
    const mixed = [
      node('a', null, 0),
      node('b', null, 1),
      node('kid1', 'a', 0),
      node('kid2', 'a', 1),
    ]

    const next = bringForward(mixed, 'kid1')

    expect([zOf(next, 'kid1'), zOf(next, 'kid2')]).toEqual([1, 0])
    expect([zOf(next, 'a'), zOf(next, 'b')]).toEqual([0, 1])
  })
})

describe('层序位置', () => {
  const nodes = [node('a', null, 0), node('b', null, 1), node('c', null, 2)]

  it('0 是最下面，total - 1 是最上面', () => {
    expect(layerPositionOf(nodes, 'a')).toEqual({ index: 0, total: 3 })
    expect(layerPositionOf(nodes, 'c')).toEqual({ index: 2, total: 3 })
  })

  it('只数同层兄弟；不存在的节点给 null', () => {
    const mixed = [node('a', null, 0), node('kid', 'a', 0)]
    expect(layerPositionOf(mixed, 'kid')).toEqual({ index: 0, total: 1 })
    expect(layerPositionOf(mixed, 'ghost')).toBeNull()
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
