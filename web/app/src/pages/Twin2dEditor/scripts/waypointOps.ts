/**
 * @fileoverview 编辑器里一条连线的落点算术：两端解析成画布坐标、拼出完整折线，
 * 拐点的增删与吸网格，以及端点拖到节点上时落在哪个端口或哪个周长参数上。
 *
 * ⚠ 两端解析与 `edgeView.ts` 的 `endOf` 逐条同序（`t` > `portId` > 朝向对方中心）：
 * 漂了的表现是把手浮在离线几个像素的地方，而线本身画得好好的。
 * ⚠ 折线一律经 `edgePath` 产出，不在这里另拼一条：把手落在哪与线画在哪必须同源。
 */
import {
  applyNodeTransform,
  centerBoxOf,
  clamp,
  edgePath,
  invertNodeTransform,
  perimTToSide,
  perimeterPoint,
  polylineLength,
  portWorldPos,
  portWorldSide,
  projectToPerimT,
  sideNormal,
  uniqueBy,
} from '@dt/twin2d'
import type {
  Box,
  Pt,
  Twin2dEdge,
  Twin2dEdgeStyle,
  Twin2dEndpoint,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dPort,
  Twin2dRouteKind,
  Twin2dSide,
  Twin2dWaypoint,
} from '@dt/twin2d'

import { nodeWorldBox } from './entityBoxes'
import { snapPoint } from './snapping'
import type { Twin2dSnapOptions } from './snapping'

/** 端点吸端口的半径（屏幕像素），按当前倍率折算成设计像素后再用。 */
export const TWIN_2D_DROP_SNAP_PX = 10

/**
 * 两端都跟随缺省时的走线档。
 * ⚠ 与 `edgeView.ts` 的 `FALLBACK_ROUTE` 是同一档的两处落点（那边服务渲染、这边
 * 服务把手），改了要两处一起改，否则把手按正交摆而线按别的档画。
 */
const FALLBACK_ROUTE: Twin2dRouteKind = 'orthogonal'

/** 编辑器恒按正向画：反向只是运行态的数据，文档里的形状不跟着变。 */
const NOT_REVERSED = false

/** 折线上离查询点最近的那一处。 */
export interface Twin2dPolylineHit {
  /** 落在第几段；第 `index` 段连接 `points[index]` 与 `points[index + 1]`。 */
  index: number
  /** 折线上的落点。 */
  point: Pt
  /** 落点到查询点的距离（设计像素）。 */
  distance: number
  /** 落点占总弧长的比例，与 `pointAlong` 同一口径。 */
  at: number
}

/** 一端解析之后：画布坐标上的落点与出线方向。 */
export interface Twin2dEdgeEnd {
  point: Pt
  side: Twin2dSide
}

/** 一个节点实例与它的样式。 */
interface NodePair {
  node: Twin2dNode
  style: Twin2dNodeStyle
}

/**
 * 一端所在节点的世界盒。⚠ 盒本身只有 `entityBoxes` 一份，别在这里另算：与 `edgeView`
 * 同源的那份交换宽高的口径，编辑器侧只该有一处。
 * @param pair 节点与它的样式
 */
function worldBoxOf(pair: NodePair): Box {
  return nodeWorldBox(pair.node, pair.style)
}

/**
 * 合并后的端口表：节点上的同 id 覆盖样式里的那一个，其余追加。
 * @param pair 节点与它的样式
 */
function portsOf(pair: NodePair): Twin2dPort[] {
  return uniqueBy([...pair.node.ports, ...pair.style.ports], (port) => port.id)
}

/**
 * 端口那一端：有引脚符号时从引脚**外端**起算，与渲染件同一处落点。
 * @param pair 节点与它的样式
 * @param portId 端口 id
 */
function portEnd(pair: NodePair, portId: string): Twin2dEdgeEnd | null {
  const pos = portWorldPos(pair.node, pair.style, portId)
  // 端口寻不到就退回上一级优先级（朝向对方中心），与渲染件同一条口径
  if (pos === null) return null
  const side = portWorldSide(pair.node, pair.style, portId)
  const marker = portsOf(pair).find((port) => port.id === portId)?.marker
  const reach = marker === undefined || marker === null ? 0 : marker.length
  const normal = sideNormal(side)
  return {
    point: { x: pos.x + normal.x * reach, y: pos.y + normal.y * reach },
    side,
  }
}

/**
 * 一端解析成落点与出线方向，优先级 `t` > `portId` > 朝向对方中心。
 * ⚠ 周长参数是**节点自己那只未变换的盒**上的：先取点再过位姿，直接在世界盒上取点
 * 会让转过 90° 的节点上的端点跑到相邻那条边去。
 * @param end 端点
 * @param node 节点实例
 * @param style 该节点用的样式
 * @param toward 对方的中心；前两级都落空时朝它出线
 */
export function resolveEdgeEnd(
  end: Twin2dEndpoint,
  node: Twin2dNode,
  style: Twin2dNodeStyle,
  toward: Pt,
): Twin2dEdgeEnd {
  const pair: NodePair = { node, style }
  const box = worldBoxOf(pair)
  if (end.t !== null) {
    const local = perimeterPoint(centerBoxOf(node, style.size), end.t)
    const point = applyNodeTransform(local.point, node, style.size)
    return { point, side: perimTToSide(projectToPerimT(box, point)) }
  }
  if (end.portId !== '') {
    const port = portEnd(pair, end.portId)
    if (port !== null) return port
  }
  const facing = projectToPerimT(box, toward)
  return {
    point: perimeterPoint(box, facing).point,
    side: perimTToSide(facing),
  }
}

/**
 * 节点与样式配对；节点或样式寻不到时 null。
 * @param nodeId 节点 id
 * @param nodes 全部节点
 * @param styles 全部节点样式（文档 ∪ 预置库）
 */
function pairOf(
  nodeId: string,
  nodes: readonly Twin2dNode[],
  styles: readonly Twin2dNodeStyle[],
): NodePair | null {
  const node = nodes.find((item) => item.id === nodeId)
  if (node === undefined) return null
  const style = styles.find((item) => item.id === node.styleId)
  return style === undefined ? null : { node, style }
}

/**
 * 两端一起解析；任一端的节点或样式寻不到时整条算挂不上。
 * @param edge 连线实例
 * @param nodes 全部节点
 * @param styles 全部节点样式（文档 ∪ 预置库）
 */
export function edgeEnds(
  edge: Twin2dEdge,
  nodes: readonly Twin2dNode[],
  styles: readonly Twin2dNodeStyle[],
): readonly [Twin2dEdgeEnd, Twin2dEdgeEnd] | null {
  const from = pairOf(edge.from.nodeId, nodes, styles)
  const to = pairOf(edge.to.nodeId, nodes, styles)
  if (from === null || to === null) return null
  const fromBox = worldBoxOf(from)
  const toBox = worldBoxOf(to)
  return [
    resolveEdgeEnd(edge.from, from.node, from.style, {
      x: toBox.x,
      y: toBox.y,
    }),
    resolveEdgeEnd(edge.to, to.node, to.style, { x: fromBox.x, y: fromBox.y }),
  ]
}

/**
 * 走线档位：连线上的 auto 跟随样式，样式还是 auto 就收底到正交。
 * @param edge 连线实例
 * @param style 连线样式
 */
function routeOf(edge: Twin2dEdge, style: Twin2dEdgeStyle): Twin2dRouteKind {
  if (edge.route !== 'auto') return edge.route
  return style.route === 'auto' ? FALLBACK_ROUTE : style.route
}

/**
 * 一条连线在画布上的完整折线（含两端）；挂不上时空表。
 * ⚠ 贝塞尔那一档的末点前面夹着一个**不在曲线上**的控制点（`edgePath` 拿它定箭头
 * 朝向），所以这串点只拿来取两端与插段，不能反过来当拐点表用。
 * @param edge 连线实例
 * @param nodes 全部节点
 * @param nodeStyles 全部节点样式（文档 ∪ 预置库）
 * @param edgeStyles 全部连线样式（文档 ∪ 预置库）
 */
export function edgePolyline(
  edge: Twin2dEdge,
  nodes: readonly Twin2dNode[],
  nodeStyles: readonly Twin2dNodeStyle[],
  edgeStyles: readonly Twin2dEdgeStyle[],
): readonly Pt[] {
  const ends = edgeEnds(edge, nodes, nodeStyles)
  const style = edgeStyles.find((item) => item.id === edge.styleId)
  if (ends === null || style === undefined) return []
  return edgePath({
    start: ends[0].point,
    end: ends[1].point,
    startSide: ends[0].side,
    endSide: ends[1].side,
    waypoints: edge.waypoints,
    route: routeOf(edge, style),
    radius: style.cornerRadius,
    labelAt: edge.labelAt,
    reversed: NOT_REVERSED,
  }).points
}

/**
 * 一段上离查询点最近的那一处；`k` 是段内比例。
 * @param a 段起点
 * @param b 段终点
 * @param at 查询点
 */
function projectOnSegment(a: Pt, b: Pt, at: Pt): { point: Pt; k: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const span = dx * dx + dy * dy
  const raw = span === 0 ? 0 : ((at.x - a.x) * dx + (at.y - a.y) * dy) / span
  const k = clamp(raw, 0, 1)
  return { point: { x: a.x + dx * k, y: a.y + dy * k }, k }
}

/**
 * 折线上离查询点最近的那一处；点不足两个时 null。
 * ⚠ 并列时取**靠前**的那一段：这就是「按弧长定段」——同样的距离下先走到的那一段
 * 才是用户看着的那一段（圆角折线的拐角内侧两段常常等距）。
 * @param points 折线点序列
 * @param at 查询点
 */
export function projectOnPolyline(
  points: readonly Pt[],
  at: Pt,
): Twin2dPolylineHit | null {
  const total = polylineLength(points)
  let best: Twin2dPolylineHit | null = null
  let walked = 0
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    // ⚠ 这一支按循环边界走不到，留着只为收住下标可空；别去为它编一条用例
    if (a === undefined || b === undefined) continue
    const span = Math.hypot(b.x - a.x, b.y - a.y)
    const hit = projectOnSegment(a, b, at)
    const distance = Math.hypot(at.x - hit.point.x, at.y - hit.point.y)
    if (best === null || distance < best.distance) {
      const along = walked + span * hit.k
      best = {
        index,
        point: hit.point,
        distance,
        at: total === 0 ? 0 : along / total,
      }
    }
    walked += span
  }
  return best
}

/**
 * 插到第几个：越界一律夹进 [0, 现有条数]。
 * @param index 想插的位置
 * @param count 现有拐点数
 */
function insertIndexOf(index: number, count: number): number {
  return clamp(Math.round(index), 0, count)
}

/**
 * 插一个拐点；落点先吸网格。
 * @param waypoints 现有拐点
 * @param index 插到第几个
 * @param at 落点（设计坐标）
 * @param options 吸附配置
 */
export function insertWaypoint(
  waypoints: readonly Twin2dWaypoint[],
  index: number,
  at: Pt,
  options: Twin2dSnapOptions,
): Twin2dWaypoint[] {
  const kept = [...waypoints]
  kept.splice(insertIndexOf(index, waypoints.length), 0, snapPoint(at, options))
  return kept
}

/**
 * 双击线上一点：按弧长找最近的那一段，把拐点插进这一段里。
 * ⚠ 段序即拐点序，靠的是折线恒为 `[起点, ...拐点, 终点]`。自动走线的边还没有拐点，
 * 它的折线里夹着路由自己拼的拐角——这时插进去的第一个拐点会让整条改按折线走
 * （拐点非空时压过 `route`，§8），这是契约本身的取舍，不在这里把自动拐角偷偷固化。
 * @param waypoints 现有拐点
 * @param points 完整折线（含两端）
 * @param at 落点（设计坐标）
 * @param options 吸附配置
 */
export function insertWaypointOnPath(
  waypoints: readonly Twin2dWaypoint[],
  points: readonly Pt[],
  at: Pt,
  options: Twin2dSnapOptions,
): Twin2dWaypoint[] {
  const hit = projectOnPolyline(points, at)
  const index = hit === null ? waypoints.length : hit.index
  return insertWaypoint(waypoints, index, at, options)
}

/**
 * 删掉第 `index` 个拐点；越界即原样返回一份拷贝。
 * @param waypoints 现有拐点
 * @param index 第几个
 */
export function removeWaypoint(
  waypoints: readonly Twin2dWaypoint[],
  index: number,
): Twin2dWaypoint[] {
  return waypoints.filter((_item, order) => order !== index)
}

/**
 * 把第 `index` 个拐点挪到新落点；落点先吸网格。
 * @param waypoints 现有拐点
 * @param index 第几个
 * @param to 新落点（设计坐标）
 * @param options 吸附配置
 */
export function moveWaypoint(
  waypoints: readonly Twin2dWaypoint[],
  index: number,
  to: Pt,
  options: Twin2dSnapOptions,
): Twin2dWaypoint[] {
  return waypoints.map((item, order) =>
    order === index ? snapPoint(to, options) : item,
  )
}

/**
 * 这个点算不算落在这个节点上（盒外再放宽 `slack`）。
 * ⚠ 先反变换再比盒：直接拿世界坐标比未变换的盒，转过 90° 的扁节点会有一大片
 * 「看着在里面、判定在外面」的区域。
 * @param pair 节点与它的样式
 * @param at 落点（设计坐标）
 * @param slack 盒外仍算命中的余量
 */
function coversPoint(pair: NodePair, at: Pt, slack: number): boolean {
  const box = centerBoxOf(pair.node, pair.style.size)
  const local = invertNodeTransform(at, pair.node, pair.style.size)
  return (
    Math.abs(local.x - box.x) <= box.w / 2 + slack &&
    Math.abs(local.y - box.y) <= box.h / 2 + slack
  )
}

/**
 * 离落点最近的端口；一个都够不着时空串。
 * @param pair 节点与它的样式
 * @param at 落点（设计坐标）
 * @param threshold 吸端口的半径（设计像素）
 */
function nearestPortId(pair: NodePair, at: Pt, threshold: number): string {
  let best = ''
  let gap = Number.POSITIVE_INFINITY
  for (const port of portsOf(pair)) {
    const pos = portWorldPos(pair.node, pair.style, port.id)
    // ⚠ 同上：端口就是从这张合并表里来的，这一支按构造走不到
    if (pos === null) continue
    const away = Math.hypot(at.x - pos.x, at.y - pos.y)
    if (away < gap) {
      best = port.id
      gap = away
    }
  }
  return gap <= threshold ? best : ''
}

/**
 * 落在这个节点上的那个端点：够得着端口就钉端口，否则钉周长参数。
 * @param pair 节点与它的样式
 * @param at 落点（设计坐标）
 * @param threshold 吸端口的半径（设计像素）
 */
function endpointOn(pair: NodePair, at: Pt, threshold: number): Twin2dEndpoint {
  const portId = nearestPortId(pair, at, threshold)
  if (portId !== '') return { nodeId: pair.node.id, portId, t: null }
  // ⚠ `t` 是未变换盒上的周长参数（与 `resolveEdgeEnd` 互逆）：不先反变换的话，
  // 转过 90° 的节点上端点会落到相邻的那条边
  const local = invertNodeTransform(at, pair.node, pair.style.size)
  const t = projectToPerimT(centerBoxOf(pair.node, pair.style.size), local)
  return { nodeId: pair.node.id, portId: '', t }
}

/**
 * 端点松手落在哪：吸到命中节点的最近端口或它的周长上；落在空白处时 null。
 * ⚠ null 的意思是「这一端不动」而不是「这一端没有归宿」：文档契约里的端点必须挂在
 * 一个真实节点上（`normalizeEndpoint` 见到空 nodeId 会把**整条线**丢掉），所以落在
 * 空白处只能保持原样，不能就地造一个自由端点——那条线会在下次读盘时静默消失。
 * ⚠ 倒序找节点：文档序即绘制序，后面的盖在前面的上头，命中要从最上面那个算起。
 * @param nodes 全部节点
 * @param styles 全部节点样式（文档 ∪ 预置库）
 * @param at 落点（设计坐标）
 * @param threshold 吸端口的半径（设计像素），同时当作盒外的命中余量
 */
export function dropEndpoint(
  nodes: readonly Twin2dNode[],
  styles: readonly Twin2dNodeStyle[],
  at: Pt,
  threshold: number,
): Twin2dEndpoint | null {
  const map = new Map(styles.map((style) => [style.id, style]))
  const pairs: NodePair[] = []
  for (const node of nodes) {
    const style = map.get(node.styleId)
    if (style !== undefined) pairs.push({ node, style })
  }
  const hit = pairs.reverse().find((pair) => coversPoint(pair, at, threshold))
  return hit === undefined ? null : endpointOn(hit, at, threshold)
}
