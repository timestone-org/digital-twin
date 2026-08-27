/**
 * @fileoverview 契约：连线两端解析出来的落点与渲染件画出来的**逐字一致**（转过 90°
 * 的节点上尤其），双击插拐点按弧长定段而不是按到拐点的直线距离，拐点增删挪都吸网格，
 * 端点落到节点上吸最近端口或周长、落在空白处一律不动。
 *
 * ⚠ 两端解析漂了不报错：把手浮在离线几个像素的地方，而线本身画得好好的。
 * ⚠ 插段定错不报错：圆角折线上离拐点最近的那一段常常不是用户点中的那一段，插进去
 * 的拐点会让线当场拐向另一边。
 * ⚠ 端点的周长参数落在**未变换**的盒上：不先反变换的话，转过 90° 的节点上端点会跑到
 * 相邻那条边去，而两处单看都说得通。
 */
import { Twin2dEdgeLayer, normalizeTwin2dConfig } from '@dt/twin2d'
import type { Pt, Twin2dConfig, Twin2dEdge } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { TWIN_2D_DEFAULT_SNAP } from '@/pages/Twin2dEditor/scripts/snapping'
import type { Twin2dSnapOptions } from '@/pages/Twin2dEditor/scripts/snapping'
import {
  dropEndpoint,
  edgeEnds,
  edgePolyline,
  insertWaypoint,
  insertWaypointOnPath,
  moveWaypoint,
  projectOnPolyline,
  removeWaypoint,
  resolveEdgeEnd,
} from '@/pages/Twin2dEditor/scripts/waypointOps'

/** 引脚符号：0..1 的一段横线，按 length 伸出 12 像素。 */
const PIN = {
  shape: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
  strokes: [{ id: 'pin-0', width: 3 }],
  length: 12,
}

/** 100×60 的方块，左右各一个引脚（右边中点、左边中点）。 */
const NODE_STYLE = {
  id: 'ns',
  name: '方块',
  size: { w: 100, h: 60 },
  ports: [
    { id: 'r', at: { kind: 'perim', t: 0.375 }, side: 'right' },
    { id: 'l', at: { kind: 'perim', t: 0.875 }, side: 'left' },
    { id: 'pin', at: { kind: 'perim', t: 0.375 }, side: 'right', marker: PIN },
  ],
}

/** 直线档：path 串就是 `M起点 L终点`，两端落点能被逐字比对。 */
const EDGE_STYLE = {
  id: 'es',
  name: '直线',
  route: 'straight',
  cornerRadius: 0,
  strokes: [{ id: 'core', width: 2 }],
}

const NODES = [
  { id: 'a', styleId: 'ns', x: 0, y: 0, w: 100, h: 60 },
  { id: 'b', styleId: 'ns', x: 400, y: 0, w: 100, h: 60 },
]

/** 两端各钉一处周长参数：a 的右边中点 → b 的左边中点。 */
const EDGE = {
  id: 'e1',
  styleId: 'es',
  from: { nodeId: 'a', t: 0.375 },
  to: { nodeId: 'b', t: 0.875 },
}

/** 浮点比对的位数：半个像素在这一档之外好几个数量级。 */
const PLACES = 10

/** 网格 20 的吸附；参考线那一路与落点无关，关掉免得混进来。 */
const SNAP: Twin2dSnapOptions = {
  ...TWIN_2D_DEFAULT_SNAP,
  grid: 20,
  guides: false,
}

interface Overrides {
  nodes?: readonly unknown[]
  edges?: readonly unknown[]
  edgeStyles?: readonly unknown[]
}

function doc(over: Overrides = {}): Twin2dConfig {
  return normalizeTwin2dConfig({
    canvas: { width: 800, height: 400 },
    styles: [NODE_STYLE],
    edgeStyles: [EDGE_STYLE],
    nodes: NODES,
    edges: [EDGE],
    ...over,
  })
}

/** 取第一条连线；归一化把它整条丢了的话当场炸，而不是让断言去猜。 */
function firstEdge(config: Twin2dConfig): Twin2dEdge {
  const edge = config.edges[0]
  if (edge === undefined) throw new Error('这份文档里没有连线')
  return edge
}

function pointAt(points: readonly Pt[], index: number): Pt {
  const point = points[index]
  if (point === undefined) throw new Error(`折线上没有第 ${index} 个点`)
  return point
}

/** 渲染件真画出来的那条 path。 */
function renderedPath(config: Twin2dConfig): string {
  const wrapper = mount(Twin2dEdgeLayer, {
    props: {
      edges: config.edges,
      edgeStyles: config.edgeStyles,
      nodes: config.nodes,
      nodeStyles: config.styles,
      width: config.canvas.width,
      height: config.canvas.height,
    },
  })
  const path = wrapper.get('[data-test="edge-stroke"]').attributes('d') ?? ''
  wrapper.unmount()
  return path
}

describe('两端解析', () => {
  it('折线两端与渲染件画出来的是同一处落点', () => {
    const config = doc()
    const points = edgePolyline(
      firstEdge(config),
      config.nodes,
      config.styles,
      config.edgeStyles,
    )
    const start = pointAt(points, 0)
    const end = pointAt(points, points.length - 1)

    expect(renderedPath(config)).toBe(
      `M${start.x},${start.y} L${end.x},${end.y}`,
    )
    expect(start).toEqual({ x: 100, y: 30 })
  })

  it('转过 90° 的节点上，端点跟着位姿走而不是留在原地', () => {
    const config = doc({ nodes: [{ ...NODES[0], rotate: 90 }, NODES[1]] })
    const points = edgePolyline(
      firstEdge(config),
      config.nodes,
      config.styles,
      config.edgeStyles,
    )

    expect(pointAt(points, 0)).toEqual({ x: 50, y: 80 })
    expect(renderedPath(config)).toBe('M50,80 L400,30')
  })

  it('既没钉周长参数也没钉引脚时朝对方中心出线', () => {
    const config = doc({ edges: [{ ...EDGE, from: { nodeId: 'a' } }] })
    const ends = edgeEnds(firstEdge(config), config.nodes, config.styles)

    expect(ends?.[0]).toEqual({ point: { x: 100, y: 30 }, side: 'right' })
  })

  it('钉了引脚的那一端落在引脚上', () => {
    const config = doc({
      edges: [{ ...EDGE, from: { nodeId: 'a', portId: 'r' } }],
    })
    const ends = edgeEnds(firstEdge(config), config.nodes, config.styles)

    expect(ends?.[0].point).toEqual({ x: 100, y: 30 })
  })

  it('端口带引脚符号时，线从引脚外端起画', () => {
    const config = doc({
      edges: [{ ...EDGE, from: { nodeId: 'a', portId: 'pin' } }],
    })
    const ends = edgeEnds(firstEdge(config), config.nodes, config.styles)

    expect(ends?.[0]).toEqual({ point: { x: 112, y: 30 }, side: 'right' })
    expect(renderedPath(config)).toBe('M112,30 L400,30')
  })

  it('节点样式悬空的连线整条挂不上', () => {
    const config = doc({
      nodes: [{ ...NODES[0], styleId: 'gone' }, NODES[1]],
    })
    const edge = firstEdge(config)

    expect(edgeEnds(edge, config.nodes, config.styles)).toBeNull()
    expect(
      edgePolyline(edge, config.nodes, config.styles, config.edgeStyles),
    ).toEqual([])
  })

  it('连线上钉了走线档就压过样式那一档', () => {
    const config = doc({
      edges: [{ ...EDGE, route: 'orthogonal', to: { nodeId: 'b', t: 0.125 } }],
    })
    const points = edgePolyline(
      firstEdge(config),
      config.nodes,
      config.styles,
      config.edgeStyles,
    )

    expect(points).toEqual([
      { x: 100, y: 30 },
      { x: 450, y: 30 },
      { x: 450, y: 0 },
    ])
  })

  it('两边都跟随缺省时收底到正交，而不是画一条穿过去的直线', () => {
    const config = doc({
      edgeStyles: [{ ...EDGE_STYLE, route: 'auto' }],
      edges: [{ ...EDGE, to: { nodeId: 'b', t: 0.125 } }],
    })
    const points = edgePolyline(
      firstEdge(config),
      config.nodes,
      config.styles,
      config.edgeStyles,
    )

    expect(points).toHaveLength(3)
  })

  it('端点指着一个已经没有的节点时整条挂不上', () => {
    const config = doc()
    const edge: Twin2dEdge = {
      ...firstEdge(config),
      from: { nodeId: 'gone', portId: '', t: null },
    }

    expect(edgeEnds(edge, config.nodes, config.styles)).toBeNull()
  })

  it('样式悬空的连线交不出折线，也不给一条到原点的斜线', () => {
    const config = doc({ edgeStyles: [{ ...EDGE_STYLE, id: 'other' }] })

    expect(
      edgePolyline(
        firstEdge(config),
        config.nodes,
        config.styles,
        config.edgeStyles,
      ),
    ).toEqual([])
  })
})

describe('按弧长找最近段', () => {
  /** 一条 L 形折线：横 100 再竖 100。 */
  const L_SHAPE: readonly Pt[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]

  it('贴着竖段的点落在竖段上，而不是落在离拐点更近的横段上', () => {
    const hit = projectOnPolyline(L_SHAPE, { x: 99, y: 40 })

    expect(hit).toEqual({
      index: 1,
      point: { x: 100, y: 40 },
      distance: 1,
      at: 0.7,
    })
  })

  it('两段等距时取先走到的那一段', () => {
    const hit = projectOnPolyline(L_SHAPE, { x: 95, y: 5 })

    expect(hit?.index).toBe(0)
  })

  it('点落在段外时收到段端上', () => {
    const hit = projectOnPolyline(L_SHAPE, { x: -40, y: -30 })

    expect(hit).toMatchObject({ index: 0, point: { x: 0, y: 0 }, distance: 50 })
  })

  it('零长折线上不产出 NaN', () => {
    const hit = projectOnPolyline(
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      { x: 8, y: 9 },
    )

    expect(hit).toEqual({
      index: 0,
      point: { x: 5, y: 5 },
      distance: 5,
      at: 0,
    })
  })

  it('不足两个点的折线上找不出段', () => {
    expect(projectOnPolyline([], { x: 0, y: 0 })).toBeNull()
    expect(projectOnPolyline([{ x: 1, y: 2 }], { x: 0, y: 0 })).toBeNull()
  })
})

describe('拐点增删', () => {
  /** 一个拐点的折线：`[起点, 拐点, 终点]`，段序即拐点序。 */
  const BENT: readonly Pt[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]
  const WAYPOINTS = [{ x: 100, y: 0 }]

  it('插在点中的那一段里，落点先吸网格', () => {
    const next = insertWaypointOnPath(WAYPOINTS, BENT, { x: 99, y: 44 }, SNAP)

    expect(next).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 40 },
    ])
  })

  it('点在头一段上就插到已有拐点前面', () => {
    const next = insertWaypointOnPath(WAYPOINTS, BENT, { x: 44, y: 1 }, SNAP)

    expect(next).toEqual([
      { x: 40, y: 0 },
      { x: 100, y: 0 },
    ])
  })

  it('关了吸附就一点不吸', () => {
    const loose: Twin2dSnapOptions = { ...SNAP, enabled: false }
    const next = insertWaypointOnPath(WAYPOINTS, BENT, { x: 99, y: 44 }, loose)

    expect(next[1]).toEqual({ x: 99, y: 44 })
  })

  it('越界的插入位置一律夹进两头', () => {
    expect(insertWaypoint(WAYPOINTS, 99, { x: 20, y: 20 }, SNAP)).toEqual([
      { x: 100, y: 0 },
      { x: 20, y: 20 },
    ])
    expect(insertWaypoint(WAYPOINTS, -5, { x: 20, y: 20 }, SNAP)).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 0 },
    ])
  })

  it('折线交不出段时把拐点追加在最后，不静默丢掉这一下', () => {
    expect(insertWaypointOnPath(WAYPOINTS, [], { x: 42, y: 38 }, SNAP)).toEqual(
      [
        { x: 100, y: 0 },
        { x: 40, y: 40 },
      ],
    )
  })

  it('删中间那一个，其余原样', () => {
    const three = [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      { x: 40, y: 40 },
    ]

    expect(removeWaypoint(three, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 40 },
    ])
  })

  it('删一个不存在的拐点交出的是拷贝，不是原来那个引用', () => {
    const kept = removeWaypoint(WAYPOINTS, 9)

    expect(kept).toEqual(WAYPOINTS)
    expect(kept).not.toBe(WAYPOINTS)
  })

  it('挪一个拐点只动它自己，落点吸网格', () => {
    const two = [
      { x: 0, y: 0 },
      { x: 40, y: 40 },
    ]

    expect(moveWaypoint(two, 1, { x: 73, y: 68 }, SNAP)).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 60 },
    ])
  })
})

describe('端点落到哪', () => {
  it('够得着引脚就钉引脚', () => {
    const config = doc()

    expect(dropEndpoint(config.nodes, config.styles, { x: 96, y: 33 }, 10)) //
      .toEqual({ nodeId: 'a', portId: 'r', t: null })
  })

  it('够不着引脚就钉周长参数', () => {
    const config = doc()

    expect(
      dropEndpoint(config.nodes, config.styles, { x: 50, y: 5 }, 10),
    ).toEqual({ nodeId: 'a', portId: '', t: 0.125 })
  })

  it('落在空白处时一端都不给：文档里没有不挂节点的端点', () => {
    const config = doc()

    expect(
      dropEndpoint(config.nodes, config.styles, { x: 250, y: 250 }, 10),
    ).toBeNull()
  })

  it('叠在一起的两个节点里，落在最上面那个上', () => {
    const config = doc({
      nodes: [NODES[0], { ...NODES[0], id: 'over', x: 10, y: 0 }],
    })
    const drop = dropEndpoint(config.nodes, config.styles, { x: 60, y: 5 }, 4)

    expect(drop?.nodeId).toBe('over')
  })

  it('转过 90° 的节点上，周长参数与反过来解析出的落点对得上', () => {
    const config = doc({ nodes: [{ ...NODES[0], rotate: 90 }, NODES[1]] })
    const node = config.nodes[0]
    const style = config.styles[0]
    if (node === undefined || style === undefined) throw new Error('节点丢了')
    const drop = dropEndpoint(config.nodes, config.styles, { x: 25, y: 40 }, 10)
    if (drop === null) throw new Error('这一点应当落在节点上')

    const back = resolveEdgeEnd(drop, node, style, { x: 0, y: 0 }).point

    expect(drop.portId).toBe('')
    // 周长参数是浮点算出来的，逐位相等只是运气；四舍五入到十位已经远小于半个像素
    expect(drop.t ?? 0).toBeCloseTo(0.6, PLACES)
    expect(back.x).toBeCloseTo(20, PLACES)
    expect(back.y).toBeCloseTo(40, PLACES)
  })
})
