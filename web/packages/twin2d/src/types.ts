/**
 * @fileoverview 2D 孪生文档契约：画布、槽位、变体、端口、节点样式、连线样式与三类实例。
 * 落在大屏节点的 `configJson.twin2d` 里；图元那一族在 typesPrim.ts。
 * 逐字口径见 docs/MODULE_TWIN_2D_DESIGN.md §4。
 */
import type {
  Twin2dBackgroundFit,
  Twin2dBadgeShape,
  Twin2dDefaultStatus,
  Twin2dEdgeRoute,
  Twin2dLabelPos,
  Twin2dMarkAlignH,
  Twin2dMarkAlignV,
  Twin2dMarkKind,
  Twin2dMarkLabelPos,
  Twin2dMarkZOrder,
  Twin2dNodeRotation,
  Twin2dPattern,
  Twin2dPortDir,
  Twin2dPortSide,
  Twin2dSlotKind,
  Twin2dStatus,
} from './kinds'
import type {
  Twin2dBorder,
  Twin2dCondition,
  Twin2dExpr,
  Twin2dPad,
  Twin2dPaint,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dRadius,
  Twin2dRootPatch,
  Twin2dShape,
  Twin2dStrokePass,
} from './typesPrim'
import type { BindingDataType, FontValue } from '@dt/contracts'

/**
 * 画布：一张图自己的坐标系。
 * ⚠ 与大屏的 `designWidth/Height` 无关，上到大屏后按 §9.1 等比缩放贴进模块矩形。
 * 两者混为一谈的表现是「换了大屏分辨率，图上所有线宽都变了」。
 */
export interface Twin2dCanvas {
  width: number
  height: number
  grid: number
  showGrid: boolean
  /** `''` | `asset:<uuid>` | `http(s)://` | `data:` | CSS background 简写。 */
  background: string
  backgroundFit: Twin2dBackgroundFit
  pattern: Twin2dPattern
  patternColor: string
  patternGap: number
  patternWidth: number
}

/** 一个槽位：图上一处读数的身份、口径与占位符。 */
export interface Twin2dSlot {
  key: string
  label: string
  kind: Twin2dSlotKind
  dataType: BindingDataType
  unit: string
  /** null = 整数直出、小数走一位；给了数就定点。 */
  precision: number | null
  /**
   * 数值 → 文案的映射。
   * ⚠ 键是**字符串**：JSON 的键永远是字符串，标成 number 时 `Object.entries`
   * 出来的键与数值点位值比较会静默不相等。
   */
  enumMap: Record<string, string>
  /** 缺省 `'—'`。 */
  placeholder: string
  primary: boolean
  /** `kind: 'derived'` 时的算式，其余档为 null。 */
  expr: Twin2dExpr | null
}

/**
 * 一条变体：命中条件后按图元 id 打浅覆盖补丁。
 * ⚠ 求值顺序 = 文档序，后者覆盖前者。
 */
export interface Twin2dVariant {
  id: string
  when: Twin2dCondition
  patch: Record<string, Twin2dPrimPatch>
  rootPatch: Twin2dRootPatch
}

/** 引脚符号：一个受限的 vec，必须带线宽与颜色。 */
export interface Twin2dPinMarker {
  shape: Twin2dShape
  strokes: readonly Twin2dStrokePass[]
  fill: Twin2dPaint
  /** 沿 `side` 方向伸出多长（设计像素）。 */
  length: number
}

/** 引脚落点：周长参数或本节点盒内的 0..1 归一坐标。 */
export type Twin2dPortAt =
  { kind: 'perim'; t: number } | { kind: 'xy'; x: number; y: number }

/** 一个端口（引脚）：连线按 `id` 挂。 */
export interface Twin2dPort {
  id: string
  /** 引脚名：1 / 2 / A / K / VCC / GND。 */
  name: string
  at: Twin2dPortAt
  dir: Twin2dPortDir
  /**
   * 出线方向，决定贝塞尔控制点与正交首段朝向。
   * ⚠ `'auto'` 必须在几何层解析成四档 Side 之后才进路由（§4.4）。
   */
  side: Twin2dPortSide
  showName: boolean
  marker: Twin2dPinMarker | null
}

/** 节点在画布上的整数尺寸（设计坐标）。 */
export interface Twin2dNodeSize {
  w: number
  h: number
}

/**
 * 一个节点样式：图元树、端口、槽位与变体的集合。
 * 预置库与用户自建的样式走同一条路径，同 id 以文档为准（§13.4）。
 */
export interface Twin2dNodeStyle {
  id: string
  name: string
  /** ⚠ 只用于调色板分栏，不参与任何渲染判断（§7 #55）。 */
  category: string
  accent: string
  /** `'hidden'` = 整个状态点不渲染。 */
  defaultStatus: Twin2dDefaultStatus
  /** 从调色板拖进画布时的初始尺寸。 */
  size: Twin2dNodeSize
  prims: readonly Twin2dPrim[]
  ports: readonly Twin2dPort[]
  slots: readonly Twin2dSlot[]
  variants: readonly Twin2dVariant[]
}

/** 连线端点标记：末端箭头或没有。 */
export type Twin2dEdgeMarker =
  | { kind: 'none' }
  | {
      kind: 'arrow'
      size: number
      /** 张开半角，弧度。 */
      spread: number
      filled: boolean
      opacity: number
    }

/**
 * 流动动画。
 * ⚠ 最终时长 = `durationMs` ÷ 模块的 `flowSpeed`，而 dashoffset 终点由 `dash` 求和
 * 算出，不写死：改了 dasharray 忘改终点会出现肉眼可见的抽动（§7 #67）。
 */
export interface Twin2dEdgeFlow {
  enabled: boolean
  dash: readonly number[]
  durationMs: number
}

/** 非活跃边的画法；`color` 为空串时沿用边色。 */
export interface Twin2dEdgeInactive {
  opacity: number
  /** 真 = 虚线拉直成实线。 */
  dashOff: boolean
  color: string
}

/** 连线标签底板。 */
export interface Twin2dEdgeLabelBox {
  fill: string
  border: Twin2dBorder
  radius: Twin2dRadius
  pad: Twin2dPad
}

/** 连线标签的排版；`box` 为 null 时不画底板。 */
export interface Twin2dEdgeLabel {
  font: FontValue
  box: Twin2dEdgeLabelBox | null
}

/** 一个连线样式。 */
export interface Twin2dEdgeStyle {
  id: string
  name: string
  accent: string
  /** 多遍描边，从下往上：宽底窄芯 = 双线，单遍大 width = 母线。 */
  strokes: readonly Twin2dStrokePass[]
  route: Twin2dEdgeRoute
  /** 圆角折线的拐角半径。 */
  cornerRadius: number
  startMarker: Twin2dEdgeMarker
  endMarker: Twin2dEdgeMarker
  flow: Twin2dEdgeFlow
  inactive: Twin2dEdgeInactive
  label: Twin2dEdgeLabel
}

/**
 * 一个节点实例。
 * ⚠ `x/y` 是**左上角**，而几何层的盒以中心为参考：换算漏了的表现是全图连线整体偏
 * 半个节点，而它看起来像「锚点算错了」（§4.6）。
 */
export interface Twin2dNode {
  id: string
  styleId: string
  x: number
  y: number
  w: number
  h: number
  rotate: Twin2dNodeRotation
  flipX: boolean
  flipY: boolean
  label: string
  labelPos: Twin2dLabelPos
  /** `''` = 由样式的 `defaultStatus` 决定。 */
  status: Twin2dStatus | ''
  /** `''` = 用样式的强调色。 */
  accent: string
  badge: string
  badgeColor: string
  badgeShape: Twin2dBadgeShape
  /** 子类等「不改结构只改外观」的维度，变体的 `tag` 一档读它（§6.3）。 */
  tags: Record<string, string>
  /** 追加槽位。 */
  slots: readonly Twin2dSlot[]
  /** 追加图元。 */
  layers: readonly Twin2dPrim[]
  /** 按图元 id 覆盖样式里的图元。 */
  patch: Record<string, Twin2dPrimPatch>
  /** 追加或按 id 覆盖样式里的端口。 */
  ports: readonly Twin2dPort[]
}

/**
 * 连线端点。
 * ⚠ 解析优先级三级：`t`（周长参数）> `portId` > 朝向对方中心。
 */
export interface Twin2dEndpoint {
  nodeId: string
  portId: string
  t: number | null
}

/** 画布上的一个拐点。 */
export interface Twin2dWaypoint {
  x: number
  y: number
}

/** 一条连线实例。 */
export interface Twin2dEdge {
  id: string
  styleId: string
  from: Twin2dEndpoint
  to: Twin2dEndpoint
  route: Twin2dEdgeRoute
  waypoints: readonly Twin2dWaypoint[]
  accent: string
  label: string
  /** 0..1 沿折线弧长（§8）。 */
  labelAt: number
}

/** 一条标注。`rect` 用 `w/h`，`line` 用 `x2/y2`，`text` 只用 `text`。 */
export interface Twin2dMark {
  id: string
  kind: Twin2dMarkKind
  x: number
  y: number
  w: number
  h: number
  x2: number
  y2: number
  text: string
  font: FontValue
  labelPos: Twin2dMarkLabelPos
  labelAlignH: Twin2dMarkAlignH
  labelAlignV: Twin2dMarkAlignV
  stroke: string
  fill: string
  strokeWidth: number
  strokeDash: boolean
  opacity: number
  zOrder: Twin2dMarkZOrder
  /**
   * ⚠ 缺省 false（= 描边随舞台缩放）。做成显式开关是因为不这么做的话
   * 「小尺寸模块上线突然变粗」查不出所以然（§4.7）。
   */
  nonScalingStroke: boolean
}

/** 一份 2D 孪生文档。 */
export interface Twin2dConfig {
  version: number
  canvas: Twin2dCanvas
  /** 用户新建或改过的节点样式；未出现在这里的 id 落回预置库。 */
  styles: readonly Twin2dNodeStyle[]
  edgeStyles: readonly Twin2dEdgeStyle[]
  nodes: readonly Twin2dNode[]
  edges: readonly Twin2dEdge[]
  marks: readonly Twin2dMark[]
}
