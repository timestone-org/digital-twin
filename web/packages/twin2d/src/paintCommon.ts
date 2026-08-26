/**
 * @fileoverview 图元基类那几项（摆位、层级、透明度、旋转与等比缩放、过渡、指针事件、
 * 宽度上下限）与节点根上的 `--t2-*` 注入。四种 paint* 都从 `paintBase` 起手，输出统一成
 * 内联样式 + 类名 + SVG 属性。口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§9.3、§9.4。
 */
import { cssVarChain, resolveAccent, sanitizeCssValue } from './cssValue'
import { lenToCss, placementCss } from './placement'
import { keepUprightCss } from './transform'
import type { Twin2dAnimKind, Twin2dDefaultStatus } from './kinds'
import type { Twin2dNode, Twin2dNodeStyle } from './types'
import type { Twin2dLen, Twin2dPrim, Twin2dTransition } from './typesPrim'

/**
 * 一个图元画出来是什么。
 * ⚠ `style` 的键是**真实 CSS 属性名**（kebab-case，自定义属性带 `--` 前缀），
 * 不是 DOM 的 camelCase：两种写法混在一份 map 里时 `--t2-*` 这类键根本没有 camel 形，
 * 而 Vue 的 `:style` 两种都收，于是「同一个属性被写了两遍、后写的赢」不报任何错。
 * `attrs` 只有 vec 用得上，其余三种恒为空对象。
 */
export interface Twin2dPaintOut {
  style: Record<string, string>
  classes: readonly string[]
  attrs: Record<string, string>
}

/** 画一个图元要知道的上下文。 */
export interface Twin2dPaintCtx {
  /** 所在的节点实例：`keepUpright` 的反向变换按它的位姿算。 */
  node: Twin2dNode
  /** 父级盒的宽（设计像素），`perim` 摆位的周长落点按它算。 */
  boxW: number
  /** 父级盒的高（设计像素）。 */
  boxH: number
  /** 本次挂载的实例前缀，SVG 的局部 id 加它防跨图冲突。 */
  idPrefix: string
}

/**
 * `box` 恒定输出的三样（§9.4）。
 * ⚠ 不做成可配置项，也**不是** `minWidth` 字段的缺省值：flex 子项默认的
 * `min-width: auto` 会让 `ellipsis` 静默失效——文字不省略而是把父级撑破，
 * 看起来像「宽度算错了」。显式给了 `minWidth` 才覆盖这里的 0。
 */
export const TWIN_2D_BOX_CONSTANTS: Readonly<Record<string, string>> =
  Object.freeze({
    'min-width': '0',
    'min-height': '0',
    'box-sizing': 'border-box',
  })

/**
 * 状态四档加一个不渲染档的配色。
 * ⚠ `offline` 走 `--state-idle` 而不是 `--state-offline`：本仓没有后者，写错了整条
 * 声明报废，状态点回落成继承色（§7 #54）。
 */
const STATUS_COLORS: Readonly<Record<Twin2dDefaultStatus, string | null>> =
  Object.freeze({
    online: 'var(--state-success)',
    offline: 'var(--state-idle)',
    warning: 'var(--state-warning)',
    alarm: 'var(--state-danger)',
    hidden: null,
  })

/** keyframes 五档对应的固定类名，`none` 不挂类 */
const ANIM_CLASSES: Readonly<Record<Twin2dAnimKind, string>> = Object.freeze({
  none: '',
  pulse: 't2-anim-pulse',
  blink: 't2-anim-blink',
  breathe: 't2-anim-breathe',
  dash: 't2-anim-dash',
})

/** 节点渐变低端 */
const FILL_A = 'var(--surface-panel)'
/** 节点渐变高端 */
const FILL_B = 'var(--surface-raised)'
/** 根上的 keyframes 时长缺省 */
const ROOT_ANIM_DURATION_MS = 1000
/** 旋转中心缺省 */
const DEFAULT_TRANSFORM_ORIGIN = '50% 50%'
/** 缓动缺省 */
const DEFAULT_EASING = 'ease'
/** 反向变换的空档 */
const NO_TRANSFORM = 'none'

/**
 * 状态 → 状态点颜色；`hidden` 回 null，调用方按「整个点不渲染」处理。
 * @param status 生效状态（四档或 `hidden`）
 */
export function statusColor(status: Twin2dDefaultStatus): string | null {
  return STATUS_COLORS[status]
}

// 过渡六档闭合属性名各出一条；props 为空与 transition 为 null 一样不产声明
function transitionCss(transition: Twin2dTransition | null): string | null {
  if (transition === null || transition.props.length === 0) return null
  const easing = sanitizeCssValue(transition.easing, DEFAULT_EASING)
  return transition.props
    .map((prop) => `${prop} ${transition.durationMs}ms ${easing}`)
    .join(', ')
}

// 摆位的位移、keepUpright 的反向、图元自己的 rotate 与 scale 合成一条 transform
// ⚠ 串内顺序 `平移 → 旋转 → 缩放` 与节点级的 `nodeTransformCss` 同族（§8）：CSS 的变换
//   列表从右往左作用到点上，等比缩放排在最右即最先作用，于是摆位的位移量不被它放大，
//   而等比缩放与旋转可交换，keepUpright 的反向角也不受它影响
function transformCss(
  placed: string | undefined,
  prim: Twin2dPrim,
  node: Twin2dNode,
): string | null {
  const parts: string[] = []
  if (placed !== undefined) parts.push(placed)
  if (prim.keepUpright) {
    const upright = keepUprightCss(node)
    if (upright !== NO_TRANSFORM) parts.push(upright)
  }
  if (prim.rotate !== 0) parts.push(`rotate(${prim.rotate}deg)`)
  if (prim.scale !== 1) parts.push(`scale(${prim.scale})`)
  return parts.length === 0 ? null : parts.join(' ')
}

// fill 一档的几何由四向 inset 定死，再给宽高会与 right/bottom 打架
function sizeCss(prim: Twin2dPrim): Record<string, string> {
  if (prim.at.kind === 'fill') return {}
  return { width: lenToCss(prim.size.w), height: lenToCss(prim.size.h) }
}

// 宽度上下限：null 是「不设限」，与显式 0 区分得开，故不给缺省
function widthLimitCss(
  minWidth: Twin2dLen | null,
  maxWidth: Twin2dLen | null,
): Record<string, string> {
  const style: Record<string, string> = {}
  if (minWidth !== null) style['min-width'] = lenToCss(minWidth)
  if (maxWidth !== null) style['max-width'] = lenToCss(maxWidth)
  return style
}

/**
 * 图元基类的内联样式：摆位、尺寸、宽度上下限、层级、透明度、旋转与等比缩放及其基点、
 * 过渡、指针事件、keyframes 类。
 * ⚠ `pointerEvents` / `transformOrigin` / `minWidth` / `maxWidth` 这四项漏一项的表现
 * 都是「配了没反应」，一处报错都没有，所以四项各有一条用例钉着。
 * ⚠ 悬浮卡那种盖在指针上的图元必须配 `pointerEvents: 'none'`：卡片弹出来盖住指针 →
 * 节点失去 hover → 卡片收起 → 指针回到节点 → 再弹出，**每秒抖十几次**，
 * 而每一帧的样式都是「对」的（§9.3）。
 * @param prim 已归一化的图元
 * @param ctx 节点实例、父级盒尺寸与实例前缀
 */
export function paintBase(
  prim: Twin2dPrim,
  ctx: Twin2dPaintCtx,
): Twin2dPaintOut {
  // hidden 的枝由渲染层整枝摘掉，这里连样式都不产
  if (prim.hidden) return { style: {}, classes: [], attrs: {} }
  const placed = placementCss(prim.at, ctx.boxW, ctx.boxH)
  const style: Record<string, string> = {
    ...placed,
    ...sizeCss(prim),
    ...widthLimitCss(prim.minWidth, prim.maxWidth),
    'z-index': String(prim.z),
    opacity: String(prim.opacity),
    'transform-origin': sanitizeCssValue(
      prim.transformOrigin,
      DEFAULT_TRANSFORM_ORIGIN,
    ),
    'pointer-events': prim.pointerEvents,
  }
  const transform = transformCss(placed['transform'], prim, ctx.node)
  if (transform !== null) style['transform'] = transform
  // ⚠ transition 为 null 时不产声明，不是产 'none'：写 'none' 会把外层给的过渡也压掉
  const transition = transitionCss(prim.transition)
  if (transition !== null) style['transition'] = transition
  const classes: string[] = []
  const anim = prim.anim
  if (anim !== null && anim.kind !== 'none') {
    classes.push(ANIM_CLASSES[anim.kind])
    style['--t2-anim-dur'] = `${anim.durationMs}ms`
  }
  return { style, classes, attrs: {} }
}

/**
 * 节点根上的六个 `--t2-*`。
 * ⚠ 只做**字符串拼接**，一处都不读 token 取值、不监听换肤：解析一次就得把 `@dt/tokens`
 * 加进本包的 deps，而那正是这条决定要避开的耦合（§6.1）。
 * ⚠ `--t2-status` 在 `hidden` 档**不产**：产一个空值会让 `var(--t2-status)` 整条声明
 * 报废，而那一档本来就该整个状态点不渲染。
 * @param node 节点实例
 * @param style 该节点用的样式
 * @param accentOverride 变体 `rootPatch.accent` 的覆盖，`''` = 不覆盖
 * @param status 生效状态（override ?? node.status ?? style.defaultStatus 之后的那一个）
 */
export function injectVars(
  node: Twin2dNode,
  style: Twin2dNodeStyle,
  accentOverride: string,
  status: Twin2dDefaultStatus,
): Record<string, string> {
  const override = sanitizeCssValue(accentOverride, '')
  const accent = resolveAccent(
    override !== '' ? override : node.accent,
    style.accent,
  )
  const vars: Record<string, string> = {
    '--t2-accent': accent,
    '--t2-badge': cssVarChain(sanitizeCssValue(node.badgeColor, ''), accent),
    '--t2-fill-a': FILL_A,
    '--t2-fill-b': FILL_B,
    '--t2-anim-dur': `${ROOT_ANIM_DURATION_MS}ms`,
  }
  const dot = statusColor(status)
  if (dot !== null) vars['--t2-status'] = dot
  return vars
}
