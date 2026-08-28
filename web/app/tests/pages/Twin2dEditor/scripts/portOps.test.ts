/**
 * @fileoverview 契约：端口点的世界坐标与朝向跟着节点的位姿走、四档旋转吸到最近的
 * 一档、一次拖动只有主选中吸附而整批加同一个差值，且原地没挪时原样返回入参那个引用。
 *
 * ⚠ 端口坐标另算一份在对称符号上肉眼看不出差别，在二极管上就是极性反了——图画得
 * 挺好，接线是错的，所以这里逐档钉死朝向。
 * ⚠ 转过 90 / 270 的节点在画布上占的是换过来的宽高：按原尺寸吸会吸到一条画面上
 * 根本没有的边上，而它看起来像「吸附差了几个像素」。
 * ⚠ 原地没挪时换了引用不会报错，只会在撤销栈上留下一格什么都没变的空步。
 */
import { portWorldPos } from '@dt/twin2d'
import type {
  Twin2dNode,
  Twin2dNodeRotation,
  Twin2dNodeStyle,
  Twin2dPort,
  Twin2dPortAt,
  Twin2dSide,
} from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  moveNodes,
  nodePortDots,
  rotationOf,
  snapRotation,
  withNodeRotation,
} from '@/pages/Twin2dEditor/scripts/portOps'
import { TWIN_2D_DEFAULT_SNAP } from '@/pages/Twin2dEditor/scripts/snapping'
import type { Twin2dSnapOptions } from '@/pages/Twin2dEditor/scripts/snapping'

/** 一枚二极管的设计尺寸：非对称符号，两个引脚分居左右 */
const SIZE = { w: 40, h: 20 }

const BASE_NODE: Twin2dNode = {
  id: 'n1',
  styleId: 's1',
  x: 100,
  y: 50,
  w: 40,
  h: 20,
  rotate: 0,
  flipX: false,
  flipY: false,
  label: '',
  labelPos: 'bottom',
  status: '',
  accent: '',
  badge: '',
  badgeColor: '',
  badgeShape: 'round',
  tags: {},
  slots: [],
  layers: [],
  patch: {},
  ports: [],
}

function makePort(
  id: string,
  at: Twin2dPortAt,
  side: Twin2dSide = 'left',
): Twin2dPort {
  return {
    id,
    name: id.toUpperCase(),
    at,
    dir: 'passive',
    side,
    showName: false,
    marker: null,
  }
}

/** 阳极贴左边、阴极贴右边 */
const STYLE_PORTS: readonly Twin2dPort[] = [
  makePort('a', { kind: 'xy', x: 0, y: 0.5 }, 'left'),
  makePort('k', { kind: 'xy', x: 1, y: 0.5 }, 'right'),
]

function makeStyle(over: Partial<Twin2dNodeStyle> = {}): Twin2dNodeStyle {
  return {
    id: 's1',
    name: '二极管',
    category: 'circuit',
    accent: 'var(--accent-primary)',
    defaultStatus: 'hidden',
    size: SIZE,
    prims: [],
    ports: STYLE_PORTS,
    slots: [],
    outline: { kind: 'rect', r: 0 },
    variants: [],
    ...over,
  }
}

function makeNode(over: Partial<Twin2dNode> = {}): Twin2dNode {
  return { ...BASE_NODE, ...over }
}

function styleMap(
  ...styles: readonly Twin2dNodeStyle[]
): ReadonlyMap<string, Twin2dNodeStyle> {
  return new Map(styles.map((style) => [style.id, style]))
}

function snapWith(over: Partial<Twin2dSnapOptions> = {}): Twin2dSnapOptions {
  return { ...TWIN_2D_DEFAULT_SNAP, ...over }
}

/** 关掉吸附的那一档：位移原样落地 */
const FREE = snapWith({ enabled: false })

describe('端口点', () => {
  it('两个引脚各出一个点，坐标与 portWorldPos 同源', () => {
    const node = makeNode()
    const style = makeStyle()

    const dots = nodePortDots(node, style)

    expect(dots.map((dot) => dot.portId)).toEqual(['a', 'k'])
    expect(dots.map((dot) => dot.at)).toEqual([
      portWorldPos(node, style, 'a'),
      portWorldPos(node, style, 'k'),
    ])
    expect(dots[0]?.at).toEqual({ x: 100, y: 60 })
    expect(dots[1]?.at).toEqual({ x: 140, y: 60 })
  })

  it('键带上节点 id，两个节点的同名引脚不重号', () => {
    const style = makeStyle()

    const left = nodePortDots(makeNode({ id: 'n1' }), style)
    const right = nodePortDots(makeNode({ id: 'n2' }), style)

    const keys = new Set([...left, ...right].map((dot) => dot.key))
    expect(keys.size).toBe(4)
  })

  it('引脚名原样带出来，供点上的 title 用', () => {
    expect(nodePortDots(makeNode(), makeStyle())[0]?.name).toBe('A')
  })

  it('节点上的同 id 端口覆盖样式里的那一个', () => {
    const node = makeNode({
      ports: [makePort('a', { kind: 'xy', x: 0.5, y: 0 }, 'top')],
    })

    const dots = nodePortDots(node, makeStyle())

    expect(dots.find((dot) => dot.portId === 'a')?.at).toEqual({
      x: 120,
      y: 50,
    })
    expect(dots).toHaveLength(2)
  })

  it('节点追加的端口也出点', () => {
    const node = makeNode({
      ports: [makePort('g', { kind: 'xy', x: 0.5, y: 1 }, 'bottom')],
    })

    expect(nodePortDots(node, makeStyle()).map((dot) => dot.portId)).toEqual([
      'g',
      'a',
      'k',
    ])
  })

  it('没有身份的端口整条丢掉', () => {
    const style = makeStyle({
      ports: [...STYLE_PORTS, makePort('', { kind: 'xy', x: 0.5, y: 0.5 })],
    })

    expect(nodePortDots(makeNode(), style)).toHaveLength(2)
  })

  // ⚠ 朝向不跟着转的表现是正交首段朝着符号内部走，而图上看着只是「线绕了一下」
  it('转过 90° 的节点，贴左边的引脚朝上、坐标也跟着转', () => {
    const dots = nodePortDots(makeNode({ rotate: 90 }), makeStyle())

    expect(dots[0]).toMatchObject({ side: 'top', at: { x: 120, y: 40 } })
    expect(dots[1]).toMatchObject({ side: 'bottom', at: { x: 120, y: 80 } })
  })

  it('镜像过的节点，左右两个引脚对调', () => {
    const dots = nodePortDots(makeNode({ flipX: true }), makeStyle())

    expect(dots[0]).toMatchObject({ side: 'right', at: { x: 140, y: 60 } })
    expect(dots[1]).toMatchObject({ side: 'left', at: { x: 100, y: 60 } })
  })

  it('周长参数那一档也走同一条换算', () => {
    const style = makeStyle({
      ports: [makePort('t', { kind: 'perim', t: 0.25 }, 'top')],
    })
    const node = makeNode()

    expect(nodePortDots(node, style)[0]?.at).toEqual(
      portWorldPos(node, style, 't'),
    )
  })
})

describe('四档旋转', () => {
  it.each<[number, Twin2dNodeRotation]>([
    [0, 0],
    [44, 0],
    [45, 90],
    [90, 90],
    [134, 90],
    [135, 180],
    [180, 180],
    [270, 270],
    [315, 0],
    [359, 0],
    [360, 0],
  ])('%s° 吸到 %s 档', (deg, turn) => {
    expect(snapRotation(deg)).toBe(turn)
  })

  it('负角与超过一整圈的角都先绕回来', () => {
    expect(snapRotation(-90)).toBe(270)
    expect(snapRotation(-450)).toBe(270)
    expect(snapRotation(810)).toBe(90)
  })

  it('非有限值回 0 档，绝不产出 NaN', () => {
    expect(snapRotation(Number.NaN)).toBe(0)
    expect(snapRotation(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('旋转手势', () => {
  const CENTER = { x: 0, y: 0 }

  it('顺时针扫过一个直角就进下一档', () => {
    expect(rotationOf(0, CENTER, { x: 10, y: 0 }, { x: 0, y: 10 })).toBe(90)
  })

  it('逆时针扫回去，从 0 档退到 270', () => {
    expect(rotationOf(0, CENTER, { x: 10, y: 0 }, { x: 0, y: -10 })).toBe(270)
  })

  it('扫过一整圈回到起手那一档', () => {
    expect(rotationOf(180, CENTER, { x: 10, y: 0 }, { x: 10, y: 0 })).toBe(180)
  })

  it('从 270 再顺时针一个直角绕回 0', () => {
    expect(rotationOf(270, CENTER, { x: 10, y: 0 }, { x: 0, y: 10 })).toBe(0)
  })

  // ⚠ 手柄跟着节点转，所以吃的是「扫过多少」而不是「指向哪」：起手不动就该是原档
  it('起手那一下不动，档位不变', () => {
    expect(rotationOf(90, CENTER, { x: 0, y: -30 }, { x: 0, y: -30 })).toBe(90)
  })
})

describe('换档', () => {
  const nodes: readonly Twin2dNode[] = [
    makeNode({ id: 'n1' }),
    makeNode({ id: 'n2' }),
  ]

  it('换了档出一份新表，其余节点原样带着', () => {
    const next = withNodeRotation(nodes, 'n1', 180)

    expect(next[0]?.rotate).toBe(180)
    expect(next[1]).toBe(nodes[1])
  })

  it('档位没变就原样返回入参那个引用', () => {
    expect(withNodeRotation(nodes, 'n1', 0)).toBe(nodes)
  })

  it('节点不在表里也原样返回', () => {
    expect(withNodeRotation(nodes, 'missing', 90)).toBe(nodes)
  })
})

describe('拖动落位', () => {
  it('关掉吸附时位移原样落地', () => {
    const nodes = [makeNode()]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1'], leadId: 'n1', dx: 7, dy: -3 },
      FREE,
    )

    expect(move.nodes[0]).toMatchObject({ x: 107, y: 47 })
    expect(move.guides).toEqual([])
  })

  it('开着吸附时落到最近的一格网格线上', () => {
    const move = moveNodes(
      [makeNode()],
      styleMap(makeStyle()),
      { ids: ['n1'], leadId: 'n1', dx: 7, dy: -3 },
      snapWith({ guides: false }),
    )

    expect(move.nodes[0]).toMatchObject({ x: 100, y: 40 })
  })

  it('同级节点的边线压过网格，并交出这一帧的参考线', () => {
    const nodes = [makeNode(), makeNode({ id: 'n2', x: 300, y: 47 })]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1'], leadId: 'n1', dx: 7, dy: -3 },
      snapWith(),
    )

    expect(move.nodes[0]).toMatchObject({ x: 100, y: 47 })
    expect(move.guides).toEqual([{ axis: 'y', at: 47 }])
  })

  // ⚠ 逐个各吸各的会让一批节点在拖动中散开
  it('多选时其余节点原样加主选中那个差值', () => {
    const nodes = [makeNode(), makeNode({ id: 'n2', x: 220, y: 130 })]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1', 'n2'], leadId: 'n1', dx: 7, dy: -3 },
      snapWith({ guides: false }),
    )

    expect(move.nodes[0]).toMatchObject({ x: 100, y: 40 })
    expect(move.nodes[1]).toMatchObject({ x: 220, y: 120 })
  })

  // ⚠ 正在拖的那批留在可吸线里的表现是「怎么拖都不动」
  it('正在拖的节点不吸自己那条线', () => {
    const nodes = [makeNode(), makeNode({ id: 'n2' })]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1', 'n2'], leadId: 'n1', dx: 3, dy: 0 },
      snapWith({ grid: 1 }),
    )

    expect(move.nodes[0]).toMatchObject({ x: 103 })
    expect(move.nodes[1]).toMatchObject({ x: 103 })
  })

  it('没被拖的节点原样带着，连引用都不换', () => {
    const nodes = [makeNode(), makeNode({ id: 'n2', x: 220, y: 130 })]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1'], leadId: 'n1', dx: 7, dy: -3 },
      FREE,
    )

    expect(move.nodes[1]).toBe(nodes[1])
  })

  // ⚠ 按原尺寸吸会吸到一条画面上根本没有的边上
  it('转过 90° 的节点按换过来的宽高吸边', () => {
    const nodes = [
      makeNode({ rotate: 90 }),
      makeNode({ id: 'n2', x: 115, y: 400 }),
    ]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1'], leadId: 'n1', dx: 4, dy: 0 },
      snapWith({ grid: 1 }),
    )

    expect(move.nodes[0]).toMatchObject({ x: 105 })
  })

  it('一步都没挪时原样返回入参那个引用', () => {
    const nodes = [makeNode()]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1'], leadId: 'n1', dx: 0, dy: 0 },
      FREE,
    )

    expect(move.nodes).toBe(nodes)
  })

  it('位移不是有限数时按没挪算', () => {
    const nodes = [makeNode()]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1'], leadId: 'n1', dx: Number.NaN, dy: 0 },
      FREE,
    )

    expect(move.nodes).toBe(nodes)
  })

  it('主选中的样式悬空时整批不动', () => {
    const nodes = [makeNode({ styleId: 'gone' })]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1'], leadId: 'n1', dx: 7, dy: -3 },
      FREE,
    )

    expect(move.nodes).toBe(nodes)
    expect(move.guides).toEqual([])
  })

  it('主选中不在表里时整批不动', () => {
    const nodes = [makeNode()]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['gone'], leadId: 'gone', dx: 7, dy: -3 },
      FREE,
    )

    expect(move.nodes).toBe(nodes)
  })

  it('样式悬空的同级节点不进可吸线', () => {
    const nodes = [makeNode(), makeNode({ id: 'n2', styleId: 'gone', x: 105 })]

    const move = moveNodes(
      nodes,
      styleMap(makeStyle()),
      { ids: ['n1'], leadId: 'n1', dx: 3, dy: 0 },
      snapWith({ grid: 1 }),
    )

    expect(move.nodes[0]).toMatchObject({ x: 103 })
  })
})
