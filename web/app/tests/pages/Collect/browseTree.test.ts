/**
 * @fileoverview 地址空间树的纯逻辑：找节点、收变量、猜编码、生成点位。
 *
 * ⚠ 两条口径钉在这里：对象节点不能当点位（建了永远读不到值），猜不出合法
 * 编码时必须跳过而不是补一个 `point_1`（半年后没人看得懂那张点表）。
 */
import { describe, expect, it } from 'vitest'
import type { CollectBrowseItem, CollectSubtreeItem } from '@dt/contracts'

import type { TreeNode } from '@/pages/Collect/Opcua/scripts/browseTree'
import {
  findNode,
  graftSubtree,
  selectionStates,
  suggestCode,
  toNodes,
  toPointItems,
  unloadedUnder,
  variableIndex,
  variablesUnder,
} from '@/pages/Collect/Opcua/scripts/browseTree'

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

describe('子树里的变量与待补拉的层', () => {
  function subtree(): TreeNode {
    const [root] = toNodes([
      browsed('ns=2;s=Line1', { is_variable: false, has_children: true }),
    ])
    if (root === undefined) throw new Error('夹具坏了')
    root.children = toNodes([
      browsed('ns=2;s=Line1.Temp'),
      browsed('ns=2;s=Line1.Zone', { is_variable: false, has_children: true }),
    ])
    return root
  }

  it('收得到已加载的变量，跳过对象节点', () => {
    expect(variablesUnder(subtree()).map((one) => one.address)).toEqual([
      'ns=2;s=Line1.Temp',
    ])
  })

  it('没拉过子层的对象节点会被列出来——它们就是「全选」要补拉的', () => {
    expect(unloadedUnder(subtree()).map((one) => one.address)).toEqual([
      'ns=2;s=Line1.Zone',
    ])
  })

  it('全部拉过之后没有待补拉的', () => {
    const root = subtree()
    const zone = findNode([root], 'ns=2;s=Line1.Zone')
    if (zone !== null) zone.children = []
    expect(unloadedUnder(root)).toEqual([])
  })
})

describe('勾选态', () => {
  /** 一层：Line1 下两个变量，且 Line1 已经拉全。 */
  function loaded(): TreeNode[] {
    const nodes = toNodes([
      browsed('ns=2;s=Line1', { is_variable: false, has_children: true }),
    ])
    const root = nodes[0]
    if (root === undefined) throw new Error('夹具坏了')
    root.children = toNodes([
      browsed('ns=2;s=Line1.Temp'),
      browsed('ns=2;s=Line1.Flow'),
    ])
    return nodes
  }

  it('一个都没勾是 none', () => {
    const states = selectionStates(loaded(), new Set())
    expect(states.get('ns=2;s=Line1')).toBe('none')
  })

  it('勾了一部分是 some', () => {
    const states = selectionStates(loaded(), new Set(['ns=2;s=Line1.Temp']))
    expect(states.get('ns=2;s=Line1')).toBe('some')
  })

  it('全勾且已拉全是 all', () => {
    const states = selectionStates(
      loaded(),
      new Set(['ns=2;s=Line1.Temp', 'ns=2;s=Line1.Flow']),
    )
    expect(states.get('ns=2;s=Line1')).toBe('all')
  })

  it('⚠ 下面还有没拉过的层时最多只能是 some', () => {
    const nodes = loaded()
    const root = nodes[0]
    root?.children?.push(
      ...toNodes([
        browsed('ns=2;s=Line1.Zone', {
          is_variable: false,
          has_children: true,
        }),
      ]),
    )
    const states = selectionStates(
      nodes,
      new Set(['ns=2;s=Line1.Temp', 'ns=2;s=Line1.Flow']),
    )
    expect(states.get('ns=2;s=Line1')).toBe('some')
  })

  it('⚠ 已建过点位的变量不算「该勾而没勾」，否则上层永远停在半选', () => {
    const states = selectionStates(
      loaded(),
      new Set(['ns=2;s=Line1.Temp']),
      new Set(['ns=2;s=Line1.Flow']),
    )
    expect(states.get('ns=2;s=Line1')).toBe('all')
  })

  it('变量自己的态就是勾没勾', () => {
    const states = selectionStates(loaded(), new Set(['ns=2;s=Line1.Temp']))
    expect(states.get('ns=2;s=Line1.Temp')).toBe('all')
    expect(states.get('ns=2;s=Line1.Flow')).toBe('none')
  })
})

describe('把一次子树遍历接回树上', () => {
  function walked(
    parent: string | null,
    address: string,
    overrides: Partial<CollectSubtreeItem> = {},
  ): CollectSubtreeItem {
    return { ...browsed(address, overrides), parent }
  }

  function root(): TreeNode {
    const node = toNodes([
      browsed('ns=2;s=L1', { has_children: true, is_variable: false }),
    ])[0]
    if (node === undefined) throw new Error('夹具不对')
    return node
  }

  it('平铺的结果按 parent 拼回层级', () => {
    const node = root()

    graftSubtree(
      node,
      [
        walked('ns=2;s=L1', 'ns=2;s=L1.Dev', {
          has_children: true,
          is_variable: false,
        }),
        walked('ns=2;s=L1.Dev', 'ns=2;s=L1.Dev.T'),
      ],
      true,
    )

    expect(node.children?.[0]?.address).toBe('ns=2;s=L1.Dev')
    expect(node.children?.[0]?.children?.[0]?.address).toBe('ns=2;s=L1.Dev.T')
    expect(unloadedUnder(node)).toEqual([])
  })

  it('⚠ 已经在树上的节点原样留用，展开着的层不会被收起来', () => {
    const node = root()
    node.children = toNodes([
      browsed('ns=2;s=L1.Dev', { has_children: true, is_variable: false }),
    ])
    const kept = node.children[0]
    if (kept === undefined) throw new Error('夹具不对')
    kept.isOpen = true

    graftSubtree(
      node,
      [
        walked('ns=2;s=L1', 'ns=2;s=L1.Dev', {
          has_children: true,
          is_variable: false,
        }),
        walked('ns=2;s=L1.Dev', 'ns=2;s=L1.Dev.T'),
      ],
      true,
    )

    expect(node.children[0]).toBe(kept)
    expect(kept.isOpen).toBe(true)
  })

  it('⚠ 整棵走全了，没子层就是真没有——就地纠正掉那个骗人的箭头', () => {
    // 驱动把「不是变量」一律当成「有子节点」，空文件夹因此也长着箭头和勾选框
    const node = root()

    graftSubtree(node, [], true)

    expect(node.hasChildren).toBe(false)
    expect(node.children).toEqual([])
  })

  it('⚠ 没走全时不敢下这个结论，留着「还没拉过」', () => {
    const node = root()

    graftSubtree(node, [], false)

    expect(node.hasChildren).toBe(true)
    expect(node.children).toBeNull()
  })

  it('⚠ 没走全的那一枝留在「还没拉过」，上层因此只能算半选', () => {
    const node = root()

    graftSubtree(
      node,
      [
        walked('ns=2;s=L1', 'ns=2;s=L1.Dev', {
          has_children: true,
          is_variable: false,
        }),
        walked('ns=2;s=L1', 'ns=2;s=L1.T'),
      ],
      false,
    )

    expect(unloadedUnder(node).map((one) => one.address)).toEqual([
      'ns=2;s=L1.Dev',
    ])
    const states = selectionStates([node], new Set(['ns=2;s=L1.T']))
    expect(states.get('ns=2;s=L1')).toBe('some')
  })
})
