/**
 * @fileoverview 地址空间折树的行为。
 * ⚠ 最要紧的一条是「父节点不在数据集里时子节点不许消失」——静默丢掉整棵
 * 子树会让人以为节点没建成功，然后重复创建、撞上标识冲突。
 */
import { describe, expect, it } from 'vitest'
import type { OpcuaNode } from '@dt/contracts'

import {
  ancestorIds,
  buildNodeTree,
  expandableIds,
  filterNodeTree,
  matchesKeyword,
  visibleRows,
} from '@/pages/Tools/OpcuaServerDetail/scripts/nodeTree'

/** 全展开摊平成 id 序列。 */
function flatAll(roots: ReturnType<typeof buildNodeTree>): string[] {
  return visibleRows(roots, new Set(), true).map((row) => row.node.id)
}

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
    const flat = visibleRows(roots, new Set(), true)
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
    expect(visibleRows([], new Set(), true)).toEqual([])
  })

  it('深度优先摊平：子在父之后、兄弟之前', () => {
    const roots = buildNodeTree([
      node('a'),
      node('a1', 'a'),
      node('b'),
      node('b1', 'b'),
    ])
    expect(flatAll(roots)).toEqual(['a', 'a1', 'b', 'b1'])
  })
})

describe('折叠与展开', () => {
  const roots = buildNodeTree([
    node('p'),
    node('c', 'p'),
    node('g', 'c'),
    node('other'),
  ])

  it('默认全折起来时只剩根这一层', () => {
    expect(visibleRows(roots, new Set()).map((row) => row.node.id)).toEqual([
      'p',
      'other',
    ])
  })

  it('展开一层只多出直接子节点，孙子仍然收着', () => {
    const rows = visibleRows(roots, new Set(['p']))
    expect(rows.map((row) => row.node.id)).toEqual(['p', 'c', 'other'])
  })

  it('expandAll 忽略折叠状态——搜出来却看不见等于没搜', () => {
    expect(flatAll(roots)).toEqual(['p', 'c', 'g', 'other'])
  })

  it('叶子不带 aria-expanded 所需的展开态', () => {
    const leaf = visibleRows(roots, new Set(), true).find(
      (row) => row.node.id === 'g',
    )
    expect(leaf?.hasChildren).toBe(false)
    expect(leaf?.isExpanded).toBe(false)
  })

  it('同层的 setSize / posInSet 反映真实兄弟数', () => {
    const rows = visibleRows(roots, new Set())
    expect(rows.map((row) => [row.setSize, row.posInSet])).toEqual([
      [2, 1],
      [2, 2],
    ])
  })

  it('expandableIds 只收有子节点的', () => {
    expect(expandableIds(roots).sort()).toEqual(['c', 'p'])
  })

  it('ancestorIds 给出从根到该节点的整条路径', () => {
    expect(ancestorIds(roots, 'g')).toEqual(['p', 'c'])
    expect(ancestorIds(roots, 'p')).toEqual([])
    expect(ancestorIds(roots, 'no-such')).toEqual([])
  })
})

describe('搜索', () => {
  function named(id: string, browse: string, parentId: string | null = null) {
    return { ...node(id, parentId), browse_name: browse }
  }

  it('BrowseName、标识与 NodeId 都参与匹配', () => {
    const target = named('x', 'Temperature')
    expect(matchesKeyword(target, 'temp')).toBe(true)
    expect(matchesKeyword(target, 'x')).toBe(true)
    expect(matchesKeyword(target, 'ns=2;s=x')).toBe(true)
    expect(matchesKeyword(target, 'pressure')).toBe(false)
  })

  it('空关键词全部命中', () => {
    expect(matchesKeyword(named('x', 'Temperature'), '')).toBe(true)
  })

  it('⚠ 命中节点的祖先必须保留，否则看不出它挂在哪', () => {
    const roots = buildNodeTree([
      named('line1', 'Line1'),
      named('t', 'Temperature', 'line1'),
      named('line2', 'Line2'),
    ])
    const filtered = filterNodeTree(roots, 'Temperature')
    expect(flatAll(filtered)).toEqual(['line1', 't'])
  })

  it('祖先自己不命中也留着，且深度重新从 0 起算', () => {
    const roots = buildNodeTree([
      named('a', 'Plant'),
      named('b', 'Line', 'a'),
      named('c', 'Temperature', 'b'),
    ])
    const rows = visibleRows(filterNodeTree(roots, 'temper'), new Set(), true)
    expect(rows.map((row) => [row.node.id, row.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
  })

  it('一个都不命中就给空树', () => {
    const roots = buildNodeTree([named('a', 'Plant')])
    expect(filterNodeTree(roots, 'zzz')).toEqual([])
  })

  it('空关键词原样返回整棵树', () => {
    const roots = buildNodeTree([named('a', 'Plant'), named('b', 'X', 'a')])
    expect(flatAll(filterNodeTree(roots, '  '))).toEqual(['a', 'b'])
  })
})
