/**
 * @fileoverview 契约：钻取树的建树、取子项、求路径、摊平字段与摘要回落。
 * ⚠ 成环时必须能停下来：建树无限递归会让整页白屏，往上求路径无限循环同理。
 * ⚠ 摊平用**文档序**而不是树序：树序会随「拖一下改父子」整片重排，
 * 而那会静默地把每一条绑定改喂另一个字段。
 */
import { describe, expect, it } from 'vitest'

import {
  buildHierTree,
  childrenOf,
  flattenHierFields,
  hierAncestors,
  hierEffectiveNodes,
  hierPathOf,
  hierSummaryFields,
} from '../src/hierTree'
import { normalizeTwinConfig } from '../src/normalize'
import type { TwinHierNode } from '../src/types'

function nodesOf(raw: unknown[]): TwinHierNode[] {
  return normalizeTwinConfig({ hierNodes: raw }).hierNodes
}

const PLANT = [
  { id: 'plant', name: '厂区', order: 0 },
  { id: 'shopB', parentId: 'plant', name: 'B 车间', order: 2 },
  { id: 'shopA', parentId: 'plant', name: 'A 车间', order: 1 },
  { id: 'pump', parentId: 'shopA', name: '泵组', nodes: ['Pump'] },
]

describe('建树', () => {
  it('按 parentId 接成树，同级按 order 排', () => {
    const tree = buildHierTree(nodesOf(PLANT))

    expect(tree).toHaveLength(1)
    expect(tree[0]?.node.id).toBe('plant')
    expect(tree[0]?.children.map((item) => item.node.id)).toEqual([
      'shopA',
      'shopB',
    ])
  })

  it('order 相同的两个按文档序分先后', () => {
    const tree = buildHierTree(
      nodesOf([
        { id: 'a', name: 'A', order: 5 },
        { id: 'b', name: 'B', order: 5 },
      ]),
    )

    expect(tree.map((item) => item.node.id)).toEqual(['a', 'b'])
  })

  it('parentId 指到不存在的节点时那一条按根处理，不从树上消失', () => {
    const tree = buildHierTree(
      nodesOf([{ id: 'orphan', parentId: 'gone', name: '孤儿' }]),
    )

    expect(tree.map((item) => item.node.id)).toEqual(['orphan'])
  })

  it('父子成环时建树能停下来，环上的节点整片不出现', () => {
    const tree = buildHierTree(
      nodesOf([
        { id: 'a', parentId: 'b', name: 'A' },
        { id: 'b', parentId: 'a', name: 'B' },
        { id: 'root', name: '根' },
      ]),
    )

    expect(tree.map((item) => item.node.id)).toEqual(['root'])
  })

  it('自己指自己也不会无限递归', () => {
    const tree = buildHierTree(nodesOf([{ id: 'self', parentId: 'self' }]))

    expect(tree).toEqual([])
  })
})

describe('取子项', () => {
  it('parentId 给 null 时取全部根', () => {
    expect(childrenOf(nodesOf(PLANT), null).map((item) => item.id)).toEqual([
      'plant',
    ])
  })

  it('取某一层的直接下级', () => {
    expect(childrenOf(nodesOf(PLANT), 'shopA').map((item) => item.id)).toEqual([
      'pump',
    ])
  })
})

describe('钻取路径', () => {
  it('从根到当前，名字空着退回 id', () => {
    const nodes = nodesOf([
      { id: 'plant', name: '' },
      { id: 'pump', parentId: 'plant', name: '泵组' },
    ])

    expect(hierPathOf(nodes, 'pump')).toEqual(['plant', '泵组'])
  })

  it('祖先链带的是节点本身，面包屑靠它拿 id', () => {
    expect(hierAncestors(nodesOf(PLANT), 'pump').map((it) => it.id)).toEqual([
      'plant',
      'shopA',
      'pump',
    ])
  })

  it('成环时往上求路径不会无限循环', () => {
    const nodes = nodesOf([
      { id: 'a', parentId: 'b', name: 'A' },
      { id: 'b', parentId: 'a', name: 'B' },
    ])

    expect(hierPathOf(nodes, 'a')).toEqual(['B', 'A'])
  })

  it('找不到这个 id 时给空数组', () => {
    expect(hierPathOf(nodesOf(PLANT), 'gone')).toEqual([])
  })
})

describe('有效 3D 节点', () => {
  it('自己配了就用自己的', () => {
    const nodes = nodesOf([
      { id: 'plant', nodes: ['Plant'] },
      { id: 'pump', parentId: 'plant', nodes: ['Pump'] },
    ])

    expect(hierEffectiveNodes(nodes, 'plant')).toEqual(['Plant'])
  })

  it('自己空着时取全部子孙的并集，重复只算一次', () => {
    const nodes = nodesOf([
      { id: 'plant' },
      { id: 'shop', parentId: 'plant', nodes: ['Shop'] },
      { id: 'pump', parentId: 'shop', nodes: ['Pump', 'Shop'] },
    ])

    expect(hierEffectiveNodes(nodes, 'plant')).toEqual(['Shop', 'Pump'])
  })

  it('成环的子树也能走完', () => {
    const nodes = nodesOf([
      { id: 'root' },
      { id: 'a', parentId: 'root', nodes: ['A'] },
      { id: 'b', parentId: 'a', nodes: ['B'] },
      { id: 'c', parentId: 'b', nodes: ['C'] },
    ])

    expect(hierEffectiveNodes(nodes, 'root')).toEqual(['A', 'B', 'C'])
  })

  it('找不到这个 id 时给空数组', () => {
    expect(hierEffectiveNodes(nodesOf(PLANT), 'gone')).toEqual([])
  })
})

describe('字段摊平', () => {
  it('按文档序摊平，取值键是 `节点 id::字段 key`', () => {
    const nodes = nodesOf([
      { id: 'b', fields: [{ key: 'p', label: '功率' }] },
      { id: 'a', fields: [{ key: 'p' }, { key: 'q' }] },
    ])

    expect(flattenHierFields(nodes).map((item) => item.valueKey)).toEqual([
      'b::p',
      'a::p',
      'a::q',
    ])
  })

  it('拖着改父子不动摊平次序——文档序才是绑定行的对齐口径', () => {
    const flat = nodesOf([
      { id: 'a', fields: [{ key: 'p' }] },
      { id: 'b', fields: [{ key: 'q' }] },
    ])
    const reparented = nodesOf([
      { id: 'a', parentId: 'b', fields: [{ key: 'p' }] },
      { id: 'b', fields: [{ key: 'q' }] },
    ])

    expect(flattenHierFields(reparented).map((it) => it.valueKey)).toEqual(
      flattenHierFields(flat).map((it) => it.valueKey),
    )
  })
})

describe('摘要字段', () => {
  it('一个都没勾时取前两个', () => {
    const node = nodesOf([
      { id: 'n', fields: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] },
    ])[0]
    if (node === undefined) throw new Error('造不出节点')

    expect(hierSummaryFields(node).map((item) => item.key)).toEqual(['a', 'b'])
  })

  it('勾了就按勾的来', () => {
    const node = nodesOf([
      {
        id: 'n',
        fields: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
        summaryFieldKeys: ['c', 'a'],
      },
    ])[0]
    if (node === undefined) throw new Error('造不出节点')

    expect(hierSummaryFields(node).map((item) => item.key)).toEqual(['c', 'a'])
  })

  it('勾中的 key 在字段里找不到就跳过，不留空行', () => {
    const node = nodesOf([
      { id: 'n', fields: [{ key: 'a' }], summaryFieldKeys: ['gone', 'a'] },
    ])[0]
    if (node === undefined) throw new Error('造不出节点')

    expect(hierSummaryFields(node).map((item) => item.key)).toEqual(['a'])
  })
})
