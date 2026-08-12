/**
 * @fileoverview 地址空间折树的行为。
 * ⚠ 最要紧的一条是「父节点不在数据集里时子节点不许消失」——静默丢掉整棵
 * 子树会让人以为节点没建成功，然后重复创建、撞上标识冲突。
 */
import { describe, expect, it } from 'vitest'
import type { OpcuaNode } from '@dt/contracts'

import {
  buildNodeTree,
  flattenNodeTree,
} from '@/pages/Tools/OpcuaServerDetail/nodeTree'

function node(id: string, parentId: string | null = null): OpcuaNode {
  return {
    id,
    instance_id: 'i1',
    parent_id: parentId,
    node_class: 'variable',
    identifier: id,
    identifier_kind: 'string',
    node_id: `ns=2;s=${id}`,
    browse_name: id,
    data_type: 'double',
    value_rank: -1,
    array_dimensions: null,
    access_level: 3,
    initial_value: null,
    description: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}

describe('折树', () => {
  it('没有父节点的挂在根上', () => {
    const roots = buildNodeTree([node('a'), node('b')])
    expect(roots.map((item) => item.node.id)).toEqual(['a', 'b'])
    expect(roots.every((item) => item.depth === 0)).toBe(true)
  })

  it('父子关系按 parent_id 建立，深度逐层加一', () => {
    const roots = buildNodeTree([
      node('root'),
      node('child', 'root'),
      node('grand', 'child'),
    ])
    const flat = flattenNodeTree(roots)
    expect(flat.map((item) => [item.node.id, item.depth])).toEqual([
      ['root', 0],
      ['child', 1],
      ['grand', 2],
    ])
  })

  it('⚠ 父节点不在数据集里时，子节点仍然出现并被标为孤儿', () => {
    const roots = buildNodeTree([node('child', 'missing-parent')])
    expect(roots).toHaveLength(1)
    expect(roots[0]?.isOrphan).toBe(true)
  })

  it('真的挂在根下的节点不算孤儿', () => {
    expect(buildNodeTree([node('a')])[0]?.isOrphan).toBe(false)
  })

  it('同一个父下的多个子节点保持输入顺序', () => {
    const roots = buildNodeTree([
      node('p'),
      node('c1', 'p'),
      node('c2', 'p'),
      node('c3', 'p'),
    ])
    expect(roots[0]?.children.map((item) => item.node.id)).toEqual([
      'c1',
      'c2',
      'c3',
    ])
  })

  it('空输入给空树', () => {
    expect(buildNodeTree([])).toEqual([])
    expect(flattenNodeTree([])).toEqual([])
  })

  it('深度优先摊平：子在父之后、兄弟之前', () => {
    const roots = buildNodeTree([
      node('a'),
      node('a1', 'a'),
      node('b'),
      node('b1', 'b'),
    ])
    expect(flattenNodeTree(roots).map((item) => item.node.id)).toEqual([
      'a',
      'a1',
      'b',
      'b1',
    ])
  })
})
