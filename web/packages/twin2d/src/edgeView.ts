/**
 * @fileoverview 连线层的绘制输入：两端解析（`t` > `portId` > 朝向对方中心）、多遍描边、
 * 端点箭头、流动动画的合成与沿路径的标签，外加端口上的引脚符号。只出属性对象、
 * 不碰 DOM，元素由 `render/Twin2dEdgeLayer.vue` 写。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.9 与 §8。
 */
import {
  TWIN_2D_DEFAULT_FLOW_SPEED,
  TWIN_2D_MAX_FLOW_SPEED,
  TWIN_2D_MIN_FLOW_SPEED,
} from './constants'
import { resolveAccent, sanitizeCssValue } from './cssValue'
import { edgePath } from './edgePath'
import {
  perimTToSide,
  perimeterPoint,
  projectToPerimT,
  sideNormal,
} from './geometry'
import {
  svgPaintLayers,
  svgShapeAttrs,
  svgShapeTag,
  svgStrokeAttrs,
} from './paintVec'
import { clamp, finiteOr, uniqueBy } from './sanitize'
import {
  applyNodeTransform,
  centerBoxOf,
  portWorldPos,
  portWorldSide,
} from './transform'
import type { Box, Pt } from './geometry'
import type { Twin2dRouteKind, Twin2dSide } from './kinds'
import type { Twin2dSvgTag } from './paintVec'
import type {
  Twin2dEdge,
  Twin2dEdgeInactive,
  Twin2dEdgeLabelBox,
  Twin2dEdgeMarker,
  Twin2dEdgeStyle,
  Twin2dEndpoint,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dPort,
} from './types'
import type { Twin2dBorder, Twin2dRadius, Twin2dStrokePass } from './typesPrim'
import type { FontValue } from '@dt/contracts'

/** 坐标精度 */
const COORD_DIGITS = 2
/** 未配色时的取色口径 */
const INHERITED_COLOR = 'currentColor'
/** SVG 的「不上色」 */
const NO_PAINT = 'none'
/** 两端都跟随缺省时的走线档 */
const FALLBACK_ROUTE: Twin2dRouteKind = 'orthogonal'
/** 四档出线方向对应的旋转角（度，SVG 的正角是顺时针） */
const SIDE_TURN: Readonly<Record<Twin2dSide, number>> = Object.freeze({
  right: 0,
  bottom: 90,
  left: 180,
  top: 270,
})
/** 引脚符号的局部渐变前缀；引脚不带渐变表，只为拼出稳定的 id */
const PIN_ID_PREFIX = 'pin'
/** 起点标记的身份 */
export const TWIN_2D_START_MARKER = 'start'
/** 末端标记的身份 */
export const TWIN_2D_END_MARKER = 'end'
/** 空心箭头没有描边可跟随时的线宽 */
const FALLBACK_OUTLINE_WIDTH = 1
/** 标签字号缺省 */
const LABEL_FONT_SIZE = 12
/** 标签底板的字宽估算系数 */
const LABEL_EM_RATIO = 0.62
/** 标签底板的行高系数 */
const LABEL_LINE_RATIO = 1.2

/** 一条连线的运行态：绑定值归一之后的三项。 */
export interface Twin2dEdgeState {
  active: boolean
  reversed: boolean
  label: string
}

/**
 * 流动动画的两个顶层配置键。
 * ⚠ 它们在模块壳 `Component.vue` 里读、当 props 递进来，包里一处都不直接读配置（§3.2）。
 */
export interface Twin2dFlowInput {
  animate: boolean
  speed: number
}

/** 一遍描边画出来是什么；`flowing` 的那一遍挂流动类。 */
export interface Twin2dEdgeStrokeView {
  id: string
  attrs: Record<string, string>
  flowing: boolean
}

/** 一个 SVG 元素的属性与它的 `v-for` key。 */
export interface Twin2dEdgePart {
  id: string
  attrs: Record<string, string>
}

/** 一条连线的标签：文字、字体与可选的底板。 */
export interface Twin2dEdgeLabelView {
  text: string
  attrs: Record<string, string>
  style: Record<string, string>
  box: Record<string, string> | null
}

/**
 * 流动动画的两个数。
 * ⚠ 只出数、不出 CSS 变量名：`--t2-anim-dur` / `--t2-dash-end` 这两个名字与
 * `twin2d.scss` 里的 `.t2-anim-dash` 是一对，改名要两处一起改，所以名字只在
 * `Twin2dEdgeLayer.vue` 里出现一次（`twin2d-css-vars.contract.spec.ts` 守这条）。
 */
export interface Twin2dEdgeFlowTiming {
  durationMs: number
  /** dashoffset 终点（px，负值）。 */
  dashEnd: number
}

/** 一条连线画出来是什么。 */
export interface Twin2dEdgeView {
  id: string
  /** 边色的三级兜底链，描边与箭头靠 `currentColor` 取它。 */
  accent: string
  /** 非活跃档要压的整组透明度；活跃时 null。 */
  opacity: number | null
  /** 流动的时长与终点；不动时 null。 */
  flow: Twin2dEdgeFlowTiming | null
  path: string
  strokes: readonly Twin2dEdgeStrokeView[]
  markers: readonly Twin2dEdgePart[]
  label: Twin2dEdgeLabelView | null
}

/** 一枚引脚符号：一个元素名配多层上色。 */
export interface Twin2dPinView {
  id: string
  tag: Twin2dSvgTag
  transform: string
  layers: readonly Twin2dEdgePart[]
}

/** 画一层连线要的全部输入。 */
export interface Twin2dEdgeLayerInput {
  edges: readonly Twin2dEdge[]
  /** 文档 ∪ 预置库，调用方合并好。 */
  edgeStyles: readonly Twin2dEdgeStyle[]
  nodes: readonly Twin2dNode[]
  nodeStyles: readonly Twin2dNodeStyle[]
  /** 按连线 id 取运行态；没有这一行时按缺省（活跃、不反向、无标签）画。 */
  states: Readonly<Record<string, Twin2dEdgeState>>
  flow: Twin2dFlowInput
}

/** 一个端点解析之后：画布坐标上的落点与出线方向。 */
interface EndView {
  point: Pt
  side: Twin2dSide
}

/** 一个节点实例与它的样式。 */
interface NodePair {
  node: Twin2dNode
  style: Twin2dNodeStyle
}

/** 没有绑定值时的运行态 */
const DEFAULT_STATE: Twin2dEdgeState = Object.freeze({
  active: true,
  reversed: false,
  label: '',
})

// 坐标定到 0.01 像素并去掉尾随零：浮点算出来的十几位小数既没法读也没法断言
function num(value: number): string {
  return String(Number(finiteOr(value, 0).toFixed(COORD_DIGITS)))
}

// ⚠ 世界盒只交换宽高、不转斜：旋转只有四档 90°，镜像不改盒（§4.6）
function worldBoxOf(pair: NodePair): Box {
  const box = centerBoxOf(pair.node, pair.style.size)
  const turned = pair.node.rotate === 90 || pair.node.rotate === 270
  return turned ? { x: box.x, y: box.y, w: box.h, h: box.w } : box
}

// 合并后的端口表：节点上的同 id 覆盖样式里的那一个，其余追加
function portsOf(pair: NodePair): Twin2dPort[] {
  return uniqueBy([...pair.node.ports, ...pair.style.ports], (port) => port.id)
}

// ⚠ 有引脚符号时连线从引脚**外端**起画（`marker.length` 那一头），否则导线会从
// 引脚中段横穿出去，而引脚看着还是画对的
function portEnd(pair: NodePair, portId: string): EndView | null {
  const pos = portWorldPos(pair.node, pair.style, portId)
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
 * ⚠ 周长参数是**节点自己的**盒上的（与端口的 `at.perim` 同一口径），先取点再过位姿；
 * 出线方向由变换后的点反投影到世界盒上求。写成直接在世界盒上取点的表现是：转过
 * 90° 的节点上，端点跑到相邻的那条边上去。
 * ⚠ 端口寻不到时退回朝向对方中心——与 `issues.ts` 的 `dangling-port` 那条提示同一口径。
 * @param end 端点
 * @param pair 节点与它的样式
 * @param toward 对方的中心
 */
function endOf(end: Twin2dEndpoint, pair: NodePair, toward: Pt): EndView {
  const box = worldBoxOf(pair)
  if (end.t !== null) {
    const local = perimeterPoint(centerBoxOf(pair.node, pair.style.size), end.t)
    const point = applyNodeTransform(local.point, pair.node, pair.style.size)
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

// 节点与它的样式配对；任一缺失 → null
function pairOf(
  nodeId: string,
  nodes: ReadonlyMap<string, Twin2dNode>,
  styles: ReadonlyMap<string, Twin2dNodeStyle>,
): NodePair | null {
  const node = nodes.get(nodeId)
  if (node === undefined) return null
  const style = styles.get(node.styleId)
  return style === undefined ? null : { node, style }
}

// 两端一起解析；任一端的节点或样式寻不到时整条不画
function endsOf(
  edge: Twin2dEdge,
  nodes: ReadonlyMap<string, Twin2dNode>,
  styles: ReadonlyMap<string, Twin2dNodeStyle>,
): readonly [EndView, EndView] | null {
  const from = pairOf(edge.from.nodeId, nodes, styles)
  const to = pairOf(edge.to.nodeId, nodes, styles)
  if (from === null || to === null) return null
  const fromBox = worldBoxOf(from)
  const toBox = worldBoxOf(to)
  return [
    endOf(edge.from, from, { x: toBox.x, y: toBox.y }),
    endOf(edge.to, to, { x: fromBox.x, y: fromBox.y }),
  ]
}

// 走线档位：连线上的 auto 跟随样式，样式还是 auto 就收底到正交（§7.9 #63）
function routeOf(edge: Twin2dEdge, style: Twin2dEdgeStyle): Twin2dRouteKind {
  if (edge.route !== 'auto') return edge.route
  return style.route === 'auto' ? FALLBACK_ROUTE : style.route
}

/**
 * dash 的一个完整周期。
 * ⚠ 奇数段时 SVG 自己把序列翻一倍，终点也得跟着翻：只减一份和会让动画每绕一圈在
 * 中途跳一下，看着像「流动卡帧」（§7.9 #67）。
 * @param dash 虚线段长
 */
function dashPeriod(dash: readonly number[]): number {
  const sum = dash.reduce((total, seg) => total + seg, 0)
  return dash.length % 2 === 0 ? sum : sum * 2
}

/**
 * 流动动画的时长与 dashoffset 终点；不动的时候给 null。
 * ⚠ 合成只有这一条：`animate` 是总闸（关掉时样式里怎么配都不动）→ `flow.enabled`
 * 决定这条线动不动与基准时长 → 最终时长 = `durationMs ÷ speed`。非活跃的边一律
 * 不动（§7.9 #67/#68）。
 * ⚠ dashoffset 终点由 dash 求和算出、不写死 -20：改了 dasharray 忘改终点会出现
 * 肉眼可见的抽动。
 * @param style 连线样式
 * @param state 这条线的运行态
 * @param flow 总闸与全局倍率
 */
function flowTimingOf(
  style: Twin2dEdgeStyle,
  state: Twin2dEdgeState,
  flow: Twin2dFlowInput,
): Twin2dEdgeFlowTiming | null {
  if (!flow.animate || !style.flow.enabled || !state.active) return null
  const speed = clamp(
    finiteOr(flow.speed, TWIN_2D_DEFAULT_FLOW_SPEED),
    TWIN_2D_MIN_FLOW_SPEED,
    TWIN_2D_MAX_FLOW_SPEED,
  )
  return {
    durationMs: style.flow.durationMs / speed,
    dashEnd: -dashPeriod(style.flow.dash),
  }
}

// 非活跃档改的是颜色与虚线，流动档只改虚线；两者都落回 svgStrokeAttrs，免得线宽、
// 端帽、透明度在这里出第二份口径
function passFor(
  pass: Twin2dStrokePass,
  inactive: Twin2dEdgeInactive | null,
  dash: readonly number[] | null,
): Twin2dStrokePass {
  const color =
    inactive !== null && inactive.color !== '' ? inactive.color : pass.color
  const off = inactive !== null && inactive.dashOff
  return { ...pass, color, dash: dash ?? (off ? [] : pass.dash) }
}

/**
 * 多遍描边，文档序即从下往上。
 * ⚠ 流动只加在**最上面**那一遍：宽底窄芯的双线里动的是芯线，两遍一起动会看成一条
 * 粗虚线在爬。
 * @param style 连线样式
 * @param active 这条线活跃不活跃
 * @param dash 流动档的虚线；不流动时 null
 */
function strokeViewsOf(
  style: Twin2dEdgeStyle,
  active: boolean,
  dash: readonly number[] | null,
): Twin2dEdgeStrokeView[] {
  const top = style.strokes.length - 1
  return style.strokes.map((pass, order) => ({
    id: pass.id,
    attrs: svgStrokeAttrs(
      passFor(
        pass,
        active ? null : style.inactive,
        order === top ? dash : null,
      ),
    ),
    flowing: dash !== null && order === top,
  }))
}

// 空心箭头的线宽跟随最上面那一遍描边：跟着导线粗细走才不会看着像另一根线
function outlineWidthOf(strokes: readonly Twin2dStrokePass[]): number {
  return strokes[strokes.length - 1]?.width ?? FALLBACK_OUTLINE_WIDTH
}

/**
 * 一个箭头：尖端落在端点上，两翼按行进方向 ±`spread` 张开。
 * @param marker 箭头档的端点标记
 * @param tip 尖端
 * @param from 尖端前面那一个点，两点定出行进方向
 * @param outline 空心时的描边宽度
 */
function arrowAttrs(
  marker: Extract<Twin2dEdgeMarker, { kind: 'arrow' }>,
  tip: Pt,
  from: Pt,
  outline: number,
): Record<string, string> {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const wing = (turn: number): string => {
    const at = angle + turn
    const x = tip.x - Math.cos(at) * marker.size
    const y = tip.y - Math.sin(at) * marker.size
    return `${num(x)},${num(y)}`
  }
  const tail = `${wing(-marker.spread)} ${wing(marker.spread)}`
  const attrs: Record<string, string> = {
    points: `${num(tip.x)},${num(tip.y)} ${tail}`,
    fill: marker.filled ? INHERITED_COLOR : NO_PAINT,
    opacity: String(marker.opacity),
  }
  if (!marker.filled) {
    attrs['stroke'] = INHERITED_COLOR
    attrs['stroke-width'] = num(outline)
  }
  return attrs
}

/**
 * 两处端点标记。
 * ⚠ 起点的箭头朝**外**（由第二个点指向起点）：两处都按行进方向画的话，一条双箭头
 * 的线上两个箭头会一起指向同一端。
 * @param style 连线样式
 * @param points `edgePath` 给出的完整折线点序列
 */
function markerViewsOf(
  style: Twin2dEdgeStyle,
  points: readonly Pt[],
): Twin2dEdgePart[] {
  const last = points.length - 1
  const outline = outlineWidthOf(style.strokes)
  const slots = [
    [TWIN_2D_START_MARKER, style.startMarker, 1, 0],
    [TWIN_2D_END_MARKER, style.endMarker, last - 1, last],
  ] as const
  const views: Twin2dEdgePart[] = []
  for (const [id, marker, fromAt, tipAt] of slots) {
    const from = points[fromAt]
    const tip = points[tipAt]
    if (marker.kind !== 'arrow' || from === undefined || tip === undefined) {
      continue
    }
    views.push({ id, attrs: arrowAttrs(marker, tip, from, outline) })
  }
  return views
}

// 字体五键：缺席的键一个声明都不产，那一项就跟随主题。⚠ 文字上色走 fill 而不是
// color——SVG 里 color 只在 fill 是 currentColor 时才间接生效
function labelFontCss(font: FontValue): Record<string, string> {
  const style: Record<string, string> = {
    fill: sanitizeCssValue(font.color, INHERITED_COLOR),
  }
  const family = sanitizeCssValue(font.family, '')
  if (family !== '') style['font-family'] = family
  if (font.size !== undefined) style['font-size'] = `${font.size}px`
  if (font.weight !== undefined) style['font-weight'] = String(font.weight)
  if (font.letterSpacing !== undefined) {
    style['letter-spacing'] = `${font.letterSpacing}px`
  }
  return style
}

// ⚠ SVG 的 rect 只有一个 rx：四角分别给时取左上那一个，药丸按半高
function labelRadiusOf(radius: Twin2dRadius, height: number): number {
  if (radius === 'pill') return height / 2
  return typeof radius === 'number' ? radius : radius[0]
}

// `none` 与零宽都不产描边属性，省得画出一圈 SVG 默认的黑线
function labelBorderAttrs(border: Twin2dBorder): Record<string, string> {
  if (border.style === 'none' || border.width <= 0) return {}
  return {
    stroke: sanitizeCssValue(border.color, INHERITED_COLOR),
    'stroke-width': num(border.width),
  }
}

/**
 * 标签底板。
 * ⚠ 宽度按**字数估算**：量真实文字要 `getComputedTextLength` 与真布局，happy-dom 下
 * 测不了——为了几像素的精度换掉整块可测性不值（同 §8 `labelAt` 的取舍）。
 * @param box 底板配置，null = 不画底板
 * @param at 标签锚点
 * @param size 字号
 * @param chars 文字长度
 */
function labelBoxAttrs(
  box: Twin2dEdgeLabelBox | null,
  at: Pt,
  size: number,
  chars: number,
): Record<string, string> | null {
  if (box === null) return null
  const [top, right, bottom, left] = box.pad
  const width = chars * size * LABEL_EM_RATIO + left + right
  const height = size * LABEL_LINE_RATIO + top + bottom
  return {
    x: num(at.x - width / 2),
    y: num(at.y - height / 2),
    width: num(width),
    height: num(height),
    rx: num(labelRadiusOf(box.radius, height)),
    fill: sanitizeCssValue(box.fill, NO_PAINT),
    ...labelBorderAttrs(box.border),
  }
}

/**
 * 一条连线的标签；文字为空时不画。
 * @param style 连线样式
 * @param at `edgePath` 给出的沿路径锚点
 * @param text 标签文字
 */
function labelViewOf(
  style: Twin2dEdgeStyle,
  at: Pt,
  text: string,
): Twin2dEdgeLabelView | null {
  if (text === '') return null
  const size = style.label.font.size ?? LABEL_FONT_SIZE
  return {
    text,
    attrs: {
      x: num(at.x),
      y: num(at.y),
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    },
    style: labelFontCss(style.label.font),
    box: labelBoxAttrs(style.label.box, at, size, text.length),
  }
}

/**
 * 一条连线的完整绘制输入。
 * ⚠ 反向渲染（端点互换 + side 互换 + 拐点整体反序）全在 `edgePath` 里，这里只把
 * `reversed` 递进去：在外面自己换一遍就是第二份口径，而带拐点的路径会自己交叉
 * （§7.9 #66）。
 * @param edge 连线实例
 * @param style 连线样式
 * @param ends 两端解析结果
 * @param state 这条线的运行态
 * @param flow 流动总闸与全局倍率
 */
function edgeViewOf(
  edge: Twin2dEdge,
  style: Twin2dEdgeStyle,
  ends: readonly [EndView, EndView],
  state: Twin2dEdgeState,
  flow: Twin2dFlowInput,
): Twin2dEdgeView {
  const geom = edgePath({
    start: ends[0].point,
    end: ends[1].point,
    startSide: ends[0].side,
    endSide: ends[1].side,
    waypoints: edge.waypoints,
    route: routeOf(edge, style),
    radius: style.cornerRadius,
    labelAt: edge.labelAt,
    reversed: state.reversed,
  })
  const timing = flowTimingOf(style, state, flow)
  const dash = timing === null ? null : style.flow.dash
  return {
    id: edge.id,
    // 边色三级兜底链；描边与箭头一律 currentColor 取它（§7.9 #61）
    accent: resolveAccent(edge.accent, style.accent),
    // ⚠ 非活跃档压的是整组的透明度：压在每一遍描边上会与标签、箭头的透明度乘两次
    opacity: state.active ? null : style.inactive.opacity,
    flow: timing,
    path: geom.path,
    strokes: strokeViewsOf(style, state.active, dash),
    markers: markerViewsOf(style, geom.points),
    label: labelViewOf(style, geom.label, state.label || edge.label),
  }
}

/**
 * 一层连线的全部绘制输入，文档序即绘制序。
 * ⚠ 样式寻不到或两端挂不上的连线整条不画，不画一条到 (0,0) 的斜线：那看起来像
 * 「拐点算错了」而不像「那个节点被删了」（`normalizeEdges` 同款取舍）。
 * @param input 连线、样式、节点、运行态与流动两键
 */
export function buildEdgeViews(input: Twin2dEdgeLayerInput): Twin2dEdgeView[] {
  const nodes = new Map(input.nodes.map((node) => [node.id, node]))
  const styles = new Map(input.nodeStyles.map((style) => [style.id, style]))
  const edgeStyles = new Map(input.edgeStyles.map((one) => [one.id, one]))
  const views: Twin2dEdgeView[] = []
  for (const edge of input.edges) {
    const style = edgeStyles.get(edge.styleId)
    const ends = endsOf(edge, nodes, styles)
    if (style === undefined || ends === null) continue
    const state = input.states[edge.id] ?? DEFAULT_STATE
    views.push(edgeViewOf(edge, style, ends, state, input.flow))
  }
  return views
}

/**
 * 一枚引脚符号；这个端口没有 marker 或端口寻不到时不画。
 * ⚠ 几何按 `unit` 档解释：0..1 是引脚自己的 `length` 见方、+x 指向出线方向，所以
 * `length` 一个数就定死了引脚伸出多长，而线宽仍是设计像素（`unit` 档只乘几何坐标、
 * 不乘线宽）——§4.4 那条「引脚的线宽最要紧」才成立。
 * @param pair 节点与它的样式
 * @param port 端口
 */
function pinViewOf(pair: NodePair, port: Twin2dPort): Twin2dPinView | null {
  const marker = port.marker
  if (marker === null) return null
  const pos = portWorldPos(pair.node, pair.style, port.id)
  // ⚠ 这一支按构造走不到（`portsOf` 与 `portWorldPos` 读的是同一份合并端口表），
  // 留着只为收住可空签名——别去为它找一条用例
  if (pos === null) return null
  const turn = SIDE_TURN[portWorldSide(pair.node, pair.style, port.id)]
  const shape = svgShapeAttrs(
    marker.shape,
    'unit',
    marker.length,
    marker.length,
  )
  const layers = svgPaintLayers(marker.fill, marker.strokes, [], PIN_ID_PREFIX)
  return {
    id: `${pair.node.id}:${port.id}`,
    tag: svgShapeTag(marker.shape),
    transform: `translate(${num(pos.x)} ${num(pos.y)}) rotate(${turn})`,
    layers: layers.map((layer) => ({
      id: layer.key,
      attrs: { ...shape, ...layer.attrs },
    })),
  }
}

/**
 * 全部端口上的引脚符号。
 * @param nodes 节点实例
 * @param nodeStyles 节点样式（文档 ∪ 预置库）
 */
export function buildPinViews(
  nodes: readonly Twin2dNode[],
  nodeStyles: readonly Twin2dNodeStyle[],
): Twin2dPinView[] {
  const styles = new Map(nodeStyles.map((style) => [style.id, style]))
  const views: Twin2dPinView[] = []
  for (const node of nodes) {
    const style = styles.get(node.styleId)
    if (style === undefined) continue
    for (const port of portsOf({ node, style })) {
      const view = pinViewOf({ node, style }, port)
      if (view !== null) views.push(view)
    }
  }
  return views
}
