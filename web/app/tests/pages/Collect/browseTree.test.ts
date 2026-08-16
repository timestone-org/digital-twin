/**
 * @fileoverview 地址空间树的纯逻辑：找节点、收变量、猜编码、生成点位。
 *
 * ⚠ 两条口径钉在这里：对象节点不能当点位（建了永远读不到值），猜不出合法
 * 编码时必须跳过而不是补一个 `point_1`（半年后没人看得懂那张点表）。
 */
import { describe, expect, it } from 'vitest'
import type { CollectBrowseItem } from '@dt/contracts'

import {
  findNode,
  suggestCode,
  toNodes,
  toPointItems,
  variableIndex,
} from '@/pages/Collect/OpcuaSourceDetail/browseTree'

function browsed(
  address: string,
  overrides: Partial<CollectBrowseItem> = {},
): CollectBrowseItem {
  return {
    address,
    name: address,
    has_children: false,
    is_variable: true,
    ...overrides,
  }
}

describe('展开与查找', () => {
  it('刚转出来的节点还没展开过', () => {
    const nodes = toNodes([browsed('ns=2;s=A', { has_children: true })])
    expect(nodes[0]?.children).toBeNull()
  })

  it('深层节点也找得到', () => {
    const nodes = toNodes([browsed('ns=2;s=A', { has_children: true })])
    const root = nodes[0]
    if (root) root.children = toNodes([browsed('ns=2;s=A.B')])

    expect(findNode(nodes, 'ns=2;s=A.B')?.address).toBe('ns=2;s=A.B')
  })

  it('找不到就是 null，不抛', () => {
    expect(findNode(toNodes([browsed('ns=2;s=A')]), '不存在')).toBeNull()
  })
})

describe('变量索引', () => {
  it('只收变量节点——对象节点建成点位就是永远读不到值', () => {
    const nodes = toNodes([
      browsed('ns=2;s=Obj', { is_variable: false, has_children: true }),
      browsed('ns=2;s=Var'),
    ])
    expect([...variableIndex(nodes).keys()]).toEqual(['ns=2;s=Var'])
  })

  it('展开过的子层也一起收', () => {
    const nodes = toNodes([
      browsed('ns=2;s=Obj', { is_variable: false, has_children: true }),
    ])
    const root = nodes[0]
    if (root) root.children = toNodes([browsed('ns=2;s=Obj.Var')])

    expect([...variableIndex(nodes).keys()]).toEqual(['ns=2;s=Obj.Var'])
  })
})

describe('从寻址串猜编码', () => {
  it('取最后一段并转成下划线小写', () => {
    expect(suggestCode('ns=2;s=Plant1.Line1.OutletTemp')).toBe('outlettemp')
  })

  it('中间的非字母数字并成一个下划线', () => {
    expect(suggestCode('ns=2;s=A.Outlet-Temp 1')).toBe('outlet_temp_1')
  })

  it('数字标识也认', () => {
    expect(suggestCode('ns=2;i=1024')).toBe('1024')
  })

  it('全是中文时猜不出，返回空串交给人填', () => {
    expect(suggestCode('ns=2;s=出口温度')).toBe('')
  })
})

describe('勾中的节点转成点位', () => {
  const nodes = toNodes([
    browsed('ns=2;s=A.Temp', { name: '温度' }),
    browsed('ns=2;s=B.Temp', { name: '温度二' }),
    browsed('ns=2;s=出口温度', { name: '中文点' }),
  ])
  const index = variableIndex(nodes)

  it('名字来自节点、寻址串原样带过去', () => {
    const { items } = toPointItems(['ns=2;s=A.Temp'], index, new Set())
    expect(items).toEqual([
      { code: 'temp', name: '温度', address: 'ns=2;s=A.Temp' },
    ])
  })

  it('同批里撞码时挂序号，不让整批被 400 打回', () => {
    const { items } = toPointItems(
      ['ns=2;s=A.Temp', 'ns=2;s=B.Temp'],
      index,
      new Set(),
    )
    expect(items.map((one) => one.code)).toEqual(['temp', 'temp_2'])
  })

  it('与库里已有的编码撞了同样挂序号', () => {
    const { items } = toPointItems(
      ['ns=2;s=A.Temp'],
      index,
      new Set(['temp', 'temp_2']),
    )
    expect(items[0]?.code).toBe('temp_3')
  })

  it('猜不出编码的跳过并如实报出来，不补一个看不懂的名字', () => {
    const { items, skipped } = toPointItems(
      ['ns=2;s=出口温度'],
      index,
      new Set(),
    )
    expect(items).toEqual([])
    expect(skipped).toEqual(['ns=2;s=出口温度'])
  })

  it('不在索引里的地址（比如对象节点）直接忽略', () => {
    const { items } = toPointItems(['ns=2;s=Nope'], index, new Set())
    expect(items).toEqual([])
  })
})
