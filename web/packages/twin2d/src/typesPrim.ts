/**
 * @fileoverview 图元那一族的文档类型：长度、填充、描边、几何、摆位、条件、算式，
 * 以及四种图元与它们的浅覆盖补丁。节点/连线/标注等实例类型在 types.ts。
 * 逐字口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2–§4.5 与 §9.5。
 */
import type {
  Twin2dAlign,
  Twin2dAnchor9,
  Twin2dAnimKind,
  Twin2dBackgroundFit,
  Twin2dBorderStyle,
  Twin2dCursor,
  Twin2dFlow,
  Twin2dHasMode,
  Twin2dJustify,
  Twin2dPointerEvents,
  Twin2dSpriteId,
  Twin2dState,
  Twin2dStatus,
  Twin2dStrokeCap,
  Twin2dStrokeJoin,
  Twin2dTextAlign,
  Twin2dTextBaseline,
  Twin2dThresholdOp,
  Twin2dTransitionProp,
  Twin2dVecCoord,
} from './kinds'
import type { FontValue } from '@dt/contracts'

/**
 * 一个长度：裸数是设计像素，另有百分比、`em` 与 `auto` 三种串形。
 * ⚠ 串形只认这三种：`'12px'` 这样的写法编译期就被打回，运行期从 unknown 收窄要走
 * 类型守卫（`isTwin2dLen`），别用断言。
 */
export type Twin2dLen = number | `${number}%` | `${number}em` | 'auto'

/** 图元盒的宽高。 */
export interface Twin2dSize {
  w: Twin2dLen
  h: Twin2dLen
}

/** 四向内缩，顺序 t / r / b / l。 */
export type Twin2dInset = readonly [Twin2dLen, Twin2dLen, Twin2dLen, Twin2dLen]

/** 四向内边距（设计像素），顺序 t / r / b / l。 */
export type Twin2dPad = readonly [number, number, number, number]

/** 圆角：一个数、药丸、或四角分别给（顺序 tl / tr / br / bl）。 */
export type Twin2dRadius =
  number | 'pill' | readonly [number, number, number, number]

/** box 的排布。 */
export interface Twin2dLayout {
  flow: Twin2dFlow
  gap: number
  align: Twin2dAlign
  justify: Twin2dJustify
  wrap: boolean
  pad: Twin2dPad
}

/** 渐变上的一个色标，`at` 是 0..1。 */
export interface Twin2dGradientStop {
  id: string
  color: string
  at: number
}

/**
 * 一层填充，多层从下往上叠。
 * ⚠ 每层都带 `id`：渲染是 `v-for`，拿下标当 key 会让改一层顺序时整列重建。
 */
export type Twin2dFill =
  | { kind: 'solid'; id: string; color: string; opacity: number }
  | {
      kind: 'linear'
      id: string
      angle: number
      stops: readonly Twin2dGradientStop[]
      opacity: number
    }
  | {
      kind: 'radial'
      id: string
      cx: number
      cy: number
      r: number
      stops: readonly Twin2dGradientStop[]
      opacity: number
    }
  | {
      kind: 'repeat'
      id: string
      angle: number
      color: string
      width: number
      gap: number
      opacity: number
    }
  | {
      kind: 'image'
      id: string
      ref: string
      fit: Twin2dBackgroundFit
      opacity: number
    }

/** 四条边各自画不画。 */
export interface Twin2dBorderSides {
  top: boolean
  right: boolean
  bottom: boolean
  left: boolean
}

/** 边框。 */
export interface Twin2dBorder {
  width: number
  style: Twin2dBorderStyle
  color: string
  sides: Twin2dBorderSides
}

/** 一条阴影；`inset` 为真时是内阴影。 */
export interface Twin2dShadow {
  id: string
  inset: boolean
  x: number
  y: number
  blur: number
  spread: number
  color: string
}

/**
 * 一遍描边，多遍从下往上叠（宽底窄芯 = 双线，单遍大 width = 母线）。
 * ⚠ `width` 不能省：只给形状时线宽落到 SVG 默认的 1px，整张图的引脚粗细与导线对不上，
 * 而这既不报错也不像 bug，只像「画得难看」（§4.4）。
 */
export interface Twin2dStrokePass {
  id: string
  width: number
  color: string
  dash: readonly number[]
  cap: Twin2dStrokeCap
  join: Twin2dStrokeJoin
  opacity: number
  nonScaling: boolean
}

/** 图元内的局部渐变；`id` 在本图元内唯一。 */
export type Twin2dGradient =
  | {
      kind: 'linear'
      id: string
      x1: number
      y1: number
      x2: number
      y2: number
      stops: readonly Twin2dGradientStop[]
    }
  | {
      kind: 'radial'
      id: string
      cx: number
      cy: number
      r: number
      fx: number
      fy: number
      stops: readonly Twin2dGradientStop[]
    }

/** SVG 上色：不上色、纯色、或引本图元里的一个渐变。 */
export type Twin2dPaint =
  | { kind: 'none' }
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; id: string }

/** 五种几何。 */
export type Twin2dShape =
  | { kind: 'path'; d: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | {
      kind: 'poly'
      points: readonly (readonly [number, number])[]
      closed: boolean
    }

/**
 * 摆位五档。
 * ⚠ `anchor` 与 `perim` 的位移数学不同，不许统一：九档走一张固定的 tx/ty 百分比表，
 * `perim` 用法线把图元整体推出去半个自身尺寸。统一成一种会让贴在角上的药丸整体挪位，
 * 而这在「两个都能用」的表面下看不出来（§4.3）。
 */
export type Twin2dPlacement =
  | { kind: 'flow' }
  | { kind: 'fill'; inset: Twin2dInset }
  | {
      kind: 'abs'
      left: Twin2dLen | null
      right: Twin2dLen | null
      top: Twin2dLen | null
      bottom: Twin2dLen | null
      tx: string
      ty: string
    }
  | { kind: 'anchor'; anchor: Twin2dAnchor9; dx: number; dy: number }
  | { kind: 'perim'; t: number; gap: number; dx: number; dy: number }

/** keyframes 循环动画。 */
export interface Twin2dAnim {
  kind: Twin2dAnimKind
  durationMs: number
}

/**
 * 属性过渡。
 * ⚠ 与 `anim` 是两件事，不能互相顶：这一档是属性变化的补间，`anim` 那一档是循环播放。
 * 少了它的表现是「哪儿都能配、就是手感不一样」——没有一处报错（§4.2）。
 */
export interface Twin2dTransition {
  props: readonly Twin2dTransitionProp[]
  durationMs: number
  easing: string
}

/**
 * 派生槽算式，可递归三层。
 * ⚠ `ratio` 的分母 ≤ 0 或非有限时整式为空（§9.5）。
 */
export type Twin2dExpr =
  | { kind: 'slot'; slot: string }
  | { kind: 'lit'; value: number | string }
  | { kind: 'first'; of: readonly Twin2dExpr[] }
  | { kind: 'ratio'; num: Twin2dExpr; den: Twin2dExpr; scale: number }
  | { kind: 'sum'; of: readonly Twin2dExpr[] }
  | { kind: 'scale'; of: Twin2dExpr; by: number }
  | { kind: 'join'; of: readonly Twin2dExpr[]; sep: string }

/**
 * 变体条件六档。
 * ⚠ `tag` 的键与值都是自由字符串，不做白名单：做了就等于把子类重新钉死成枚举，
 * 这一档就白加了（§6.3）。
 */
export type Twin2dCondition =
  | { kind: 'state'; state: Twin2dState }
  | { kind: 'status'; in: readonly Twin2dStatus[] }
  | { kind: 'tag'; key: string; in: readonly string[] }
  | {
      kind: 'slot'
      slot: string
      op: Twin2dThresholdOp
      value: number | null
      value2: number | null
    }
  | { kind: 'has'; slots: readonly string[]; mode: Twin2dHasMode }
  | { kind: 'not'; of: Twin2dCondition }

/** 图元共有的十五项。 */
export interface Twin2dPrimBase {
  /** 样式内唯一：节点级覆盖、变体补丁都按它寻址，也是 `v-for` 的 key。 */
  id: string
  at: Twin2dPlacement
  size: Twin2dSize
  minWidth: Twin2dLen | null
  maxWidth: Twin2dLen | null
  z: number
  opacity: number
  hidden: boolean
  /** 不满足则整枝不渲染。 */
  when: Twin2dCondition | null
  anim: Twin2dAnim | null
  transition: Twin2dTransition | null
  /** 绕 `transformOrigin` 转多少度。 */
  rotate: number
  /**
   * 绕 `transformOrigin` 等比缩放，缺省 1（与 `rotate` 共用同一个基点）。
   * ⚠ 只有等比一档，没有分轴的 sx/sy：分轴缩放会把描边宽度也拉成椭圆的，
   * 而参考项目那四处 hover 放大要的正是「整枝一起大一点」（§7 #10）。
   */
  scale: number
  transformOrigin: string
  /** ⚠ 悬浮卡不设成 `none` 会 hover 自我抖动，每秒十几次而每一帧都是「对」的（§9.3）。 */
  pointerEvents: Twin2dPointerEvents
  /** 节点整体旋转时本图元反向旋转保持正立（电路图的元件标号惯例）。 */
  keepUpright: boolean
}

/** 盒：布局、多层填充、边框、圆角、阴影、裁剪与子树。 */
export interface Twin2dBoxPrim extends Twin2dPrimBase {
  kind: 'box'
  layout: Twin2dLayout
  fills: readonly Twin2dFill[]
  border: Twin2dBorder
  radius: Twin2dRadius
  shadows: readonly Twin2dShadow[]
  backdropBlur: number
  clip: boolean
  cursor: Twin2dCursor
  children: readonly Twin2dPrim[]
}

/** 矢量：一段几何、一个填充、多遍描边与局部渐变。 */
export interface Twin2dVecPrim extends Twin2dPrimBase {
  kind: 'vec'
  coord: Twin2dVecCoord
  shape: Twin2dShape
  fill: Twin2dPaint
  strokes: readonly Twin2dStrokePass[]
  gradients: readonly Twin2dGradient[]
  /** viewBox 是否按 `preserveAspectRatio="none"` 拉伸。 */
  stretch: boolean
}

/** `draw` 一档的一笔：一个受限的 vec（无子树、无摆位、无变体）。 */
export interface Twin2dDrawPart {
  shape: Twin2dShape
  fill: Twin2dPaint
  strokes: readonly Twin2dStrokePass[]
}

/** 图标四来源加一个空档。 */
export type Twin2dIcoSrc =
  | { kind: 'none' }
  | { kind: 'name'; name: string }
  | { kind: 'sprite'; id: Twin2dSpriteId }
  | { kind: 'asset'; ref: string }
  | {
      kind: 'draw'
      viewBox: readonly [number, number]
      parts: readonly Twin2dDrawPart[]
    }

/** 图标。 */
export interface Twin2dIcoPrim extends Twin2dPrimBase {
  kind: 'ico'
  src: Twin2dIcoSrc
  /**
   * 缺省 `'currentColor'`。
   * ⚠ 对 `TWIN_2D_FIXED_COLOR_SPRITES` 那 4 枚无效——它们的颜色是插画的一部分，
   * 写死在 sprite 里（§5）。
   */
  color: string
}

/** 文本四来源。 */
export type Twin2dTxtSrc =
  | { kind: 'lit'; text: string }
  | { kind: 'slot'; slot: string }
  | { kind: 'label' }
  | { kind: 'id' }

/** 描边字（标注标签用）：SVG 的 `paint-order: stroke` 那一套。 */
export interface Twin2dTextOutline {
  width: number
  color: string
}

/** 文本。 */
export interface Twin2dTxtPrim extends Twin2dPrimBase {
  kind: 'txt'
  src: Twin2dTxtSrc
  /** 缺席键 = 跟随主题。 */
  font: FontValue
  align: Twin2dTextAlign
  baseline: Twin2dTextBaseline
  nowrap: boolean
  ellipsis: boolean
  /** 溢出时把完整文本挂到 `title` 属性上。 */
  titleAttr: boolean
  shadows: readonly Twin2dShadow[]
  outline: Twin2dTextOutline | null
}

/** 四种图元，闭合。 */
export type Twin2dPrim =
  Twin2dBoxPrim | Twin2dVecPrim | Twin2dIcoPrim | Twin2dTxtPrim

/**
 * 图元的浅覆盖补丁：只覆盖显式给出的键，缺席的键沿用原值。
 * ⚠ `id` / `kind` / `children` 不可补丁：换 `kind` 会把渲染分支整条换掉，
 * 换 `children` 等于重建整棵子树——而变体产出补丁的全部理由就是不重建（§9.2）。
 * 子图元要改就按它自己的 id 再写一条补丁。
 */
export interface Twin2dPrimPatch {
  at?: Twin2dPlacement
  size?: Twin2dSize
  minWidth?: Twin2dLen | null
  maxWidth?: Twin2dLen | null
  z?: number
  opacity?: number
  hidden?: boolean
  when?: Twin2dCondition | null
  anim?: Twin2dAnim | null
  transition?: Twin2dTransition | null
  rotate?: number
  scale?: number
  transformOrigin?: string
  pointerEvents?: Twin2dPointerEvents
  keepUpright?: boolean
  layout?: Twin2dLayout
  fills?: readonly Twin2dFill[]
  border?: Twin2dBorder
  radius?: Twin2dRadius
  shadows?: readonly Twin2dShadow[]
  backdropBlur?: number
  clip?: boolean
  cursor?: Twin2dCursor
  coord?: Twin2dVecCoord
  shape?: Twin2dShape
  fill?: Twin2dPaint
  strokes?: readonly Twin2dStrokePass[]
  gradients?: readonly Twin2dGradient[]
  stretch?: boolean
  /** ico 或 txt 的来源——补丁按图元 id 寻址，类型面上分不出是哪一种。 */
  src?: Twin2dIcoSrc | Twin2dTxtSrc
  color?: string
  font?: FontValue
  align?: Twin2dTextAlign
  baseline?: Twin2dTextBaseline
  nowrap?: boolean
  ellipsis?: boolean
  titleAttr?: boolean
  outline?: Twin2dTextOutline | null
}

/** 作用在节点根上的覆盖：抬升、等比缩放、外发光、边框色、层级与强调色。 */
export interface Twin2dRootPatch {
  /** 沿 y 轴负方向的位移（设计像素）。 */
  lift?: number
  /**
   * 整个节点的等比缩放；缺席 = 不覆盖。
   * ⚠ 与 `lift` 是**同一条** transform 上的两段：hover 那一档
   * `translateY(-3px) scale(1.025)` 两样都要给，只给 `lift` 就是「抬起来了但没变大」（§7 #9）。
   */
  scale?: number
  shadows?: readonly Twin2dShadow[]
  borderColor?: string
  /** ⚠ hover 变体必须同时抬它，否则悬浮卡被右邻节点整块盖住（§9.3）。 */
  z?: number
  accent?: string
}
