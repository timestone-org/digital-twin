/**
 * @fileoverview 契约：钻取树的结构操作只动父子与同级次序，绝不动文档序，
 * 且拖进自己的子树一律拒绝。
 * ⚠ 文档序是 `hierValues` 的对齐口径，拖一下树就重排数组的话，每一条绑定都会
 * 安静地改喂另一个字段。
 * ⚠ 成环的那几层从任何根都走不到，在钻取里整片消失，所以必须在操作层挡住。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  addHierNode,
  hierDefaultName,
  isHierDescendant,
  moveHierSibling,
  reparentHierNode,
} from '@/pages/TwinEditor/scripts/hierOps'

function configOf(nodes: unknown[]): TwinConfig {
  return normalizeTwinConfig({ hierNodes: nodes })
}

/** 可预期的 id 工厂，省得断言里出现随机十六进制。 */
function ids(...queue: string[]): (prefix: string) => string {
  let at = 0
  return (prefix) => `${prefix}-${queue[at++] ?? 'x'}`
}

const TREE = [
  { id: 'plant', name: '厂区' },
  { id: 'shopA', parentId: 'plant', name: 'A 车间', order: 0 },
  { id: 'shopB', parentId: 'plant', name: 'B 车间', order: 1 },
  { id: 'pump', parentId: 'shopA', name: '泵组' },
]

describe('新建钻取节点', () => {
  it('建根给「区域 N」这样的智能默认名，不是空输入框', () => {
    const first = addHierNode(configOf([]), null, ids('1'))

    expect(first.config.hierNodes[0]).toMatchObject({
      id: 'hier-1',
      name: '区域 1',
      parentId: null,
    })
  })

  it('第二个根接着数，名字不重', () => {
    const one = addHierNode(configOf([]), null, ids('1'))
    const two = addHierNode(one.config, null, ids('2'))

    expect(two.config.hierNodes.map((item) => item.name)).toEqual([
      '区域 1',
      '区域 2',
    ])
  })

  it('建子层挂在指定的上一层下，名字是「子项 N」', () => {
    const next = addHierNode(configOf(TREE), 'plant', ids('1'))
    const created = next.config.hierNodes.find((item) => item.id === 'hier-1')

    expect(created).toMatchObject({ parentId: 'plant', name: '子项 3' })
  })

  it('新节点排在同一层最后，order 大于既有同级', () => {
    const next = addHierNode(configOf(TREE), 'plant', ids('1'))
    const created = next.config.hierNodes.find((item) => item.id === 'hier-1')

    expect(created?.order).toBe(2)
  })

  it('默认名按同级条数算，不按全表条数', () => {
    expect(hierDefaultName(configOf(TREE), 'shopA')).toBe('子项 2')
  })
})

describe('改上一层', () => {
  it('挂到新的上一层并排到最后', () => {
    const next = reparentHierNode(configOf(TREE), 'pump', 'shopB')

    expect(next.hierNodes.find((item) => item.id === 'pump')).toMatchObject({
      parentId: 'shopB',
      order: 0,
    })
  })

  it('提到顶层', () => {
    const next = reparentHierNode(configOf(TREE), 'pump', null)

    expect(
      next.hierNodes.find((item) => item.id === 'pump')?.parentId,
    ).toBeNull()
  })

  it('拖进自己的子树一律拒绝——那会立刻成环', () => {
    const before = configOf(TREE)

    expect(reparentHierNode(before, 'plant', 'pump')).toBe(before)
  })

  it('拖到自己身上也拒绝', () => {
    const before = configOf(TREE)

    expect(reparentHierNode(before, 'plant', 'plant')).toBe(before)
  })

  it('挂到它已经在的那一层是空操作', () => {
    const before = configOf(TREE)

    expect(reparentHierNode(before, 'pump', 'shopA')).toBe(before)
  })

  it('节点不存在时什么都不做', () => {
    const before = configOf(TREE)

    expect(reparentHierNode(before, 'gone', null)).toBe(before)
  })

  it('改父子不动 hierNodes 的数组次序', () => {
    const before = configOf(TREE)
    const after = reparentHierNode(before, 'pump', 'shopB')

    expect(after.hierNodes.map((item) => item.id)).toEqual(
      before.hierNodes.map((item) => item.id),
    )
  })
})

describe('同级挪位', () => {
  it('上移与下一位换个先后', () => {
    const next = moveHierSibling(configOf(TREE), 'shopB', -1)

    expect(
      next.hierNodes
        .filter((item) => item.parentId === 'plant')
        .sort((left, right) => left.order - right.order)
        .map((item) => item.id),
    ).toEqual(['shopB', 'shopA'])
  })

  it('两条 order 恰好相同时也真的换得动', () => {
    const before = configOf([
      { id: 'a', order: 0 },
      { id: 'b', order: 0 },
    ])
    const next = moveHierSibling(before, 'b', -1)

    expect(next.hierNodes.find((item) => item.id === 'b')?.order).toBe(0)
    expect(next.hierNodes.find((item) => item.id === 'a')?.order).toBe(1)
  })

  it('已经在头上再上移是空操作', () => {
    const before = configOf(TREE)

    expect(moveHierSibling(before, 'shopA', -1)).toBe(before)
  })

  it('已经在末尾再下移是空操作', () => {
    const before = configOf(TREE)

    expect(moveHierSibling(before, 'shopB', 1)).toBe(before)
  })

  it('节点不存在时什么都不做', () => {
    const before = configOf(TREE)

    expect(moveHierSibling(before, 'gone', 1)).toBe(before)
  })

  it('挪位不动 hierNodes 的数组次序', () => {
    const before = configOf(TREE)
    const after = moveHierSibling(before, 'shopB', -1)

    expect(after.hierNodes.map((item) => item.id)).toEqual(
      before.hierNodes.map((item) => item.id),
    )
  })
})

describe('祖先判定', () => {
  it('自己算自己的祖先——拖到自己身上同样成环', () => {
    expect(isHierDescendant(configOf(TREE).hierNodes, 'pump', 'pump')).toBe(
      true,
    )
  })

  it('隔代也认得出来', () => {
    expect(isHierDescendant(configOf(TREE).hierNodes, 'plant', 'pump')).toBe(
      true,
    )
  })

  it('不同支之间不算', () => {
    expect(isHierDescendant(configOf(TREE).hierNodes, 'shopB', 'pump')).toBe(
      false,
    )
  })

  it('数据已经成环时也能停下来', () => {
    const nodes = configOf([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]).hierNodes

    expect(isHierDescendant(nodes, 'gone', 'a')).toBe(false)
  })
})
