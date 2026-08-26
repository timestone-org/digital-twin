/**
 * @fileoverview box 图元的绘制：排布六项、多层填充合成一条 `background`、四边可分关的
 * 边框、三形圆角、多条阴影合成一条 `box-shadow`，以及背景模糊、裁剪与光标。
 * 基类那几项一律取自 paintCommon 的 `paintBase`；口径见
 * docs/MODULE_TWIN_2D_DESIGN.md §4.2、§9.4。
 */
import { sanitizeCssValue } from './cssValue'
import { TWIN_2D_BOX_CONSTANTS, paintBase } from './paintCommon'
import type {
  Twin2dAlign,
  Twin2dBackgroundFit,
  Twin2dFlow,
  Twin2dJustify,
} from './kinds'
import type { Twin2dPaintCtx, Twin2dPaintOut } from './paintCommon'
import type {
  Twin2dBorder,
  Twin2dBoxPrim,
  Twin2dFill,
  Twin2dGradientStop,
  Twin2dLayout,
  Twin2dRadius,
  Twin2dShadow,
} from './typesPrim'

/** 未配色时的取色口径 */
const INHERITED_COLOR = 'currentColor'
/** 归一值转百分数 */
const PERCENT = 100
/** 百分数的量化分母 */
const PCT_QUANT = 10000
/** 药丸圆角的语义 token */
const PILL_RADIUS = 'var(--radius-pill)'
/** 一个合法 CSS 渐变的最少色标数 */
const MIN_GRADIENT_STOPS = 2
/** 逐层不透明度的混合底 */
const TRANSPARENT = 'transparent'

/** 排流三档的 display */
const FLOW_DISPLAY: Readonly<Record<Twin2dFlow, string>> = Object.freeze({
  row: 'flex',
  col: 'flex',
  none: 'grid',
})

/** 两档 flex 排流的主轴 */
const FLEX_DIRECTION: Readonly<Record<'row' | 'col', string>> = Object.freeze({
  row: 'row',
  col: 'column',
})

/** 交叉轴对齐五档 */
const ALIGN_ITEMS: Readonly<Record<Twin2dAlign, string>> = Object.freeze({
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  baseline: 'baseline',
  stretch: 'stretch',
})

/** 主轴分布五档 */
const JUSTIFY_CONTENT: Readonly<Record<Twin2dJustify, string>> = Object.freeze({
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
})

/** 底图铺法四档的「位置 / 尺寸 平铺」 */
const IMAGE_FIT: Readonly<Record<Twin2dBackgroundFit, string>> = Object.freeze({
  cover: 'center center / cover no-repeat',
  contain: 'center center / contain no-repeat',
  stretch: 'center center / 100% 100% no-repeat',
  tile: 'left top / auto repeat',
})

/** 边框四边的文档序 */
const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const

/** 会把 `url()` 提前闭合的字符 */
const URL_UNSAFE_RE = /["'()\\\s]/
/** 底图地址允许的前缀 */
const IMAGE_PREFIXES = ['https://', 'http://', 'data:', '/'] as const

// 归一值转百分数，量化掉浮点尾巴
function pct(unit: number): string {
  return `${Math.round(unit * PERCENT * PCT_QUANT) / PCT_QUANT}%`
}

// ⚠ 逐层的 opacity 折进颜色里：CSS 的 background 简写没有逐层不透明度，
// 另开一条 `opacity` 会把整个盒连同子树一起变淡
function withOpacity(color: string, opacity: number): string {
  const safe = sanitizeCssValue(color, INHERITED_COLOR)
  if (opacity >= 1) return safe
  return `color-mix(in srgb, ${safe} ${pct(opacity)}, ${TRANSPARENT})`
}

// ⚠ 少于两个色标的渐变是非法 CSS：留着它会让整条 background 声明连同其余层一起报废，
// 表现是「加了一层空渐变，整个盒的底色全没了」
function stopsCss(
  stops: readonly Twin2dGradientStop[],
  opacity: number,
): string | null {
  if (stops.length < MIN_GRADIENT_STOPS) return null
  return stops
    .map((stop) => `${withOpacity(stop.color, opacity)} ${pct(stop.at)}`)
    .join(', ')
}

// ⚠ 地址按前缀白名单收：未解析的 `asset:<uuid>` 落不进 url()，整层丢弃而不是发一个必 404
// 的请求；引号/括号/空白一律拒，它们能把 url() 提前闭合
function imageLayer(ref: string, fit: Twin2dBackgroundFit): string | null {
  if (URL_UNSAFE_RE.test(ref)) return null
  if (!IMAGE_PREFIXES.some((prefix) => ref.startsWith(prefix))) return null
  return `url("${ref}") ${IMAGE_FIT[fit]}`
}

// 一层填充的 CSS 值；表达不出来的层回 null 由调用方整层丢弃
function fillLayer(fill: Twin2dFill): string | null {
  switch (fill.kind) {
    case 'solid': {
      // ⚠ 纯色也写成渐变：background 简写里只有最后一层能是颜色，写成颜色的层一挪位就非法
      const color = withOpacity(fill.color, fill.opacity)
      return `linear-gradient(${color}, ${color})`
    }
    case 'linear': {
      const stops = stopsCss(fill.stops, fill.opacity)
      return stops === null
        ? null
        : `linear-gradient(${fill.angle}deg, ${stops})`
    }
    case 'radial': {
      const stops = stopsCss(fill.stops, fill.opacity)
      if (stops === null) return null
      // ⚠ 用 ellipse 双百分比而不是 circle：circle 的显式半径只能是长度，写百分比整条非法
      const size = `${pct(fill.r)} ${pct(fill.r)}`
      return `radial-gradient(ellipse ${size} at ${pct(fill.cx)} ${pct(fill.cy)}, ${stops})`
    }
    case 'repeat': {
      const color = withOpacity(fill.color, fill.opacity)
      const line = `${color} ${fill.gap}px ${fill.gap + fill.width}px`
      return `repeating-linear-gradient(${fill.angle}deg, ${TRANSPARENT} 0 ${fill.gap}px, ${line})`
    }
    case 'image':
      // ⚠ 这一档的 opacity 表达不出来（简写里图片层没有不透明度），要淡就在图上淡
      return imageLayer(fill.ref, fill.fit)
  }
}

// ⚠ 文档里的 fills 是**从下往上**，而 background 简写里先写的在上面：不反过来的表现是
// 「底色盖住了图案」——每一层都对，只有叠序错
function fillsCss(fills: readonly Twin2dFill[]): Record<string, string> {
  const layers = [...fills]
    .reverse()
    .map((fill) => fillLayer(fill))
    .filter((layer): layer is string => layer !== null)
  return layers.length === 0 ? {} : { background: layers.join(', ') }
}

/**
 * 排布：display 与主轴、间隙、内边距，以及两档 flex 排流才有的对齐、分布与折行。
 * @param layout 已归一化的排布六项
 */
function layoutCss(layout: Twin2dLayout): Record<string, string> {
  const style: Record<string, string> = {
    display: FLOW_DISPLAY[layout.flow],
    gap: `${layout.gap}px`,
    padding: layout.pad.map((side) => `${side}px`).join(' '),
  }
  // ⚠ `none` 一档是「只摆一个孩子并居中」的 grid，align/justify 在这一档没有意义
  if (layout.flow === 'none') {
    style['place-items'] = 'center'
    return style
  }
  style['flex-direction'] = FLEX_DIRECTION[layout.flow]
  style['align-items'] = ALIGN_ITEMS[layout.align]
  style['justify-content'] = JUSTIFY_CONTENT[layout.justify]
  style['flex-wrap'] = layout.wrap ? 'wrap' : 'nowrap'
  return style
}

/**
 * 边框：四边全开走一条简写，关掉的边**不产声明**。
 * ⚠ 关掉的边产 `border-top: none` 会把外层给的边框一起压掉，而那正是「配了一边、
 * 另外三边莫名其妙没了」的来源。
 * @param border 已归一化的边框
 */
function borderCss(border: Twin2dBorder): Record<string, string> {
  if (border.style === 'none') return {}
  const color = sanitizeCssValue(border.color, INHERITED_COLOR)
  const value = `${border.width}px ${border.style} ${color}`
  const on = BORDER_SIDES.filter((side) => border.sides[side])
  if (on.length === BORDER_SIDES.length) return { border: value }
  const style: Record<string, string> = {}
  for (const side of on) style[`border-${side}`] = value
  return style
}

// 圆角三形：一个数、药丸、或四角分别给（CSS 的角序正是 tl / tr / br / bl）
function radiusCss(radius: Twin2dRadius): string {
  if (radius === 'pill') return PILL_RADIUS
  if (typeof radius === 'number') return `${radius}px`
  return radius.map((corner) => `${corner}px`).join(' ')
}

// 一条阴影；inset 与外阴影只差一个前缀
function shadowCss(shadow: Twin2dShadow): string {
  const color = sanitizeCssValue(shadow.color, INHERITED_COLOR)
  const geom = `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px`
  return shadow.inset ? `inset ${geom} ${color}` : `${geom} ${color}`
}

// 多条阴影按文档序合成一条；空数组不产声明，产空串会让浏览器丢掉整条规则
function shadowsCss(shadows: readonly Twin2dShadow[]): Record<string, string> {
  if (shadows.length === 0) return {}
  return { 'box-shadow': shadows.map((shadow) => shadowCss(shadow)).join(', ') }
}

// 背景模糊、裁剪与光标：三项都只在偏离缺省时才产声明
function effectsCss(prim: Twin2dBoxPrim): Record<string, string> {
  const style: Record<string, string> = {}
  if (prim.backdropBlur > 0) {
    style['backdrop-filter'] = `blur(${prim.backdropBlur}px)`
  }
  if (prim.clip) style['overflow'] = 'hidden'
  // ⚠ `default` 一档不产声明：产了会把可点节点根上的 pointer 压回箭头，零报错
  if (prim.cursor !== 'default') style['cursor'] = prim.cursor
  return style
}

/**
 * 画一个 box：基类那几项 + 恒定三样 + 排布、填充、边框、圆角、阴影与三样效果。
 * ⚠ 恒定三样写在最前，让显式给了 `minWidth` 的图元盖得住这里的 `min-width: 0`——
 * 反过来写的表现是悬浮卡那 188px 下限静默失效（§9.4）。
 * @param prim 已归一化的 box 图元
 * @param ctx 节点实例、父级盒尺寸与实例前缀
 */
export function paintBox(
  prim: Twin2dBoxPrim,
  ctx: Twin2dPaintCtx,
): Twin2dPaintOut {
  const base = paintBase(prim, ctx)
  // hidden 的枝由渲染层整枝摘掉，这里连样式都不产
  if (prim.hidden) return base
  return {
    style: {
      ...TWIN_2D_BOX_CONSTANTS,
      ...base.style,
      ...layoutCss(prim.layout),
      ...fillsCss(prim.fills),
      ...borderCss(prim.border),
      'border-radius': radiusCss(prim.radius),
      ...shadowsCss(prim.shadows),
      ...effectsCss(prim),
    },
    classes: base.classes,
    attrs: {},
  }
}
