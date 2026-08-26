/**
 * @fileoverview vec 图元的 SVG 侧属性：五种几何 → 元素名与几何属性、多遍描边的分层、
 * 局部渐变的实例前缀，以及根 `<svg>` 的 viewBox 与拉伸档。只出属性对象、不拼 SVG 串
 * （元素由渲染件写）。口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§5、§7.5。
 */
import { sanitizeCssValue } from './cssValue'
import { paintBase } from './paintCommon'
import { finiteOr, posDim } from './sanitize'
import type { Twin2dVecCoord } from './kinds'
import type { Twin2dPaintCtx, Twin2dPaintOut } from './paintCommon'
import type {
  Twin2dGradient,
  Twin2dGradientStop,
  Twin2dPaint,
  Twin2dShape,
  Twin2dStrokePass,
  Twin2dVecPrim,
} from './typesPrim'

/** SVG 的「不上色」 */
const NO_PAINT = 'none'
/** 未配色时的取色口径 */
const INHERITED_COLOR = 'currentColor'
/** 几何坐标精度 */
const COORD_DIGITS = 2
/** 盒尺寸的除零护栏 */
const MIN_BOX = 1
/** 两轴各自缩放 */
const FREE_ASPECT = 'none'
/** 描边不随舞台缩放 */
const NON_SCALING_STROKE = 'non-scaling-stroke'
/** 局部渐变 id 的固定引子 */
const GRADIENT_ID_PREFIX = 't2g-'
/** 实例前缀与图元内 id 的分隔 */
const ID_SEP = '-'
/** 填充层的 key */
const FILL_LAYER_KEY = 'f:'
/** 描边层的 key 引子 */
const STROKE_LAYER_KEY = 's:'
/** id 里不能出现的字符 */
const UNSAFE_ID_CHAR_RE = /[^A-Za-z0-9_-]/g
/** 非法字符的替身 */
const SAFE_ID_CHAR = '_'

/** 五种几何摊到 SVG 上的六个元素名。 */
export type Twin2dSvgTag =
  'path' | 'rect' | 'ellipse' | 'line' | 'polygon' | 'polyline'

/**
 * 一遍绘制：一个 SVG 元素的上色属性与它的 `v-for` key。
 * ⚠ key 带 `f:` / `s:` 引子，为的是让填充层与一个恰好叫 `f` 的描边遍分得开——
 * 撞了 key 的表现是改一遍描边时另一层跟着重建，一处报错都没有。
 */
export interface Twin2dSvgLayer {
  key: string
  attrs: Record<string, string>
}

/** 两轴的缩放比：`px` 档恒 1，`unit` 档是本次的盒尺寸。 */
interface Scale {
  sx: number
  sy: number
}

// 几何坐标：定到 0.01 像素并去掉尾随零，浮点乘出来的十几位小数既没法读也没法断言
function num(value: number): string {
  return String(Number(finiteOr(value, 0).toFixed(COORD_DIGITS)))
}

// unit 档的 0..1 归一值按盒尺寸放大，px 档直用
function scaleOf(coord: Twin2dVecCoord, boxW: number, boxH: number): Scale {
  if (coord === 'px') return { sx: 1, sy: 1 }
  return { sx: posDim(boxW, MIN_BOX), sy: posDim(boxH, MIN_BOX) }
}

// ⚠ rx 只有一个值，两轴各按自己的比例缩放：unit 档非方形盒上只缩 x 的话，
// 圆角在纵向会被拉成扁的，而每一个数值看着都「对」
function rectAttrs(
  shape: Extract<Twin2dShape, { kind: 'rect' }>,
  s: Scale,
): Record<string, string> {
  return {
    x: num(shape.x * s.sx),
    y: num(shape.y * s.sy),
    width: num(shape.w * s.sx),
    height: num(shape.h * s.sy),
    rx: num(shape.rx * s.sx),
    ry: num(shape.rx * s.sy),
  }
}

function ellipseAttrs(
  shape: Extract<Twin2dShape, { kind: 'ellipse' }>,
  s: Scale,
): Record<string, string> {
  return {
    cx: num(shape.cx * s.sx),
    cy: num(shape.cy * s.sy),
    rx: num(shape.rx * s.sx),
    ry: num(shape.ry * s.sy),
  }
}

function lineAttrs(
  shape: Extract<Twin2dShape, { kind: 'line' }>,
  s: Scale,
): Record<string, string> {
  return {
    x1: num(shape.x1 * s.sx),
    y1: num(shape.y1 * s.sy),
    x2: num(shape.x2 * s.sx),
    y2: num(shape.y2 * s.sy),
  }
}

function polyAttrs(
  shape: Extract<Twin2dShape, { kind: 'poly' }>,
  s: Scale,
): Record<string, string> {
  const points = shape.points
    .map(([x, y]) => `${num(x * s.sx)},${num(y * s.sy)}`)
    .join(' ')
  return { points }
}

/**
 * 几何 → SVG 元素名。
 * ⚠ `closed` 决定 `polygon` 还是 `polyline`：开口折线渲成 `polygon` 会被静默补上
 * 首尾那一段，元件符号里那些「缺一口」的形状（继电器触点、开口箭头）就全闭合了。
 * @param shape 五种几何之一
 */
export function svgShapeTag(shape: Twin2dShape): Twin2dSvgTag {
  if (shape.kind === 'poly') return shape.closed ? 'polygon' : 'polyline'
  return shape.kind
}

/**
 * 几何 → SVG 几何属性。
 * ⚠ `unit` 档 x 向乘宽、y 向乘高，两轴不能共用一个比例：写反了在方形盒上一模一样，
 * 只有非方形盒才看得出来。
 * ⚠ `path` 的 `d` 是一段串，没法逐数缩放，`unit` 档改用 `scale()` 变换顶上——
 * 代价是线宽跟着缩，要不变粗细的路径得开 `nonScaling`。
 * ⚠ `d` 原样出、不过 CSS 消毒：它进的是属性不是样式，`url(` 在 path 语法里没有意义。
 * @param shape 五种几何之一
 * @param coord 坐标口径：`unit` 是本图元盒的 0..1 归一值，`px` 是设计像素
 * @param boxW 盒宽（设计像素），非正数按 1 兜底
 * @param boxH 盒高（设计像素），非正数按 1 兜底
 */
export function svgShapeAttrs(
  shape: Twin2dShape,
  coord: Twin2dVecCoord,
  boxW: number,
  boxH: number,
): Record<string, string> {
  const s = scaleOf(coord, boxW, boxH)
  switch (shape.kind) {
    case 'path': {
      const attrs: Record<string, string> = { d: shape.d }
      if (coord === 'unit') {
        attrs['transform'] = `scale(${num(s.sx)}, ${num(s.sy)})`
      }
      return attrs
    }
    case 'rect':
      return rectAttrs(shape, s)
    case 'ellipse':
      return ellipseAttrs(shape, s)
    case 'line':
      return lineAttrs(shape, s)
    case 'poly':
      return polyAttrs(shape, s)
  }
}

// id 只留 [A-Za-z0-9_-]：其余字符会让 url(#…) 选不中那个渐变，整个形状就不上色了
function safeIdPart(raw: string): string {
  return raw.replace(UNSAFE_ID_CHAR_RE, SAFE_ID_CHAR)
}

/**
 * 局部渐变的文档级 id：实例前缀 + 图元内 id。
 * ⚠ 引子恒在最前，所以这套拼法**永不产出** `TWIN_2D_SPRITE_GRADIENT_IDS` 那四个名字
 * （`recoveryFill` / `hxFill` / `pumpFill` / `solarFill`）——它们占着整个 DOM 文档的
 * 命名空间，撞上了是同页另一张图的填充被换掉，两边都不报错（§5）。
 * @param idPrefix 本次挂载的实例前缀
 * @param id 图元内唯一的渐变 id
 */
export function svgGradientDomId(idPrefix: string, id: string): string {
  return `${GRADIENT_ID_PREFIX}${safeIdPart(idPrefix)}${ID_SEP}${safeIdPart(id)}`
}

/**
 * 一个局部渐变 → `<linearGradient>` / `<radialGradient>` 的属性。
 * ⚠ 坐标是**对象包围盒**的 0..1 归一值（SVG 的 `gradientUnits` 缺省档），不随 `coord`
 * 走：跟着乘一遍盒尺寸会让渐变整个跑到形状外面去，画面上只剩纯色。
 * @param gradient 局部渐变
 * @param idPrefix 本次挂载的实例前缀
 */
export function svgGradientAttrs(
  gradient: Twin2dGradient,
  idPrefix: string,
): Record<string, string> {
  const id = svgGradientDomId(idPrefix, gradient.id)
  if (gradient.kind === 'linear') {
    return {
      id,
      x1: num(gradient.x1),
      y1: num(gradient.y1),
      x2: num(gradient.x2),
      y2: num(gradient.y2),
    }
  }
  return {
    id,
    cx: num(gradient.cx),
    cy: num(gradient.cy),
    r: num(gradient.r),
    fx: num(gradient.fx),
    fy: num(gradient.fy),
  }
}

/**
 * 一个色标 → `<stop>` 的属性。
 * @param stop 渐变色标
 */
export function svgStopAttrs(stop: Twin2dGradientStop): Record<string, string> {
  return {
    offset: num(stop.at),
    'stop-color': sanitizeCssValue(stop.color, INHERITED_COLOR),
  }
}

/**
 * 一遍描边 → SVG 属性。
 * ⚠ 恒带 `fill="none"`：SVG 的填充缺省是**黑色**，描边遍不摘掉它就是一块黑盖在
 * 底下那几遍上，而形状轮廓依旧是对的。
 * ⚠ `nonScaling` 出 `vector-effect`，少了它线宽会随舞台缩放一起变。
 * @param stroke 一遍描边
 */
export function svgStrokeAttrs(
  stroke: Twin2dStrokePass,
): Record<string, string> {
  const attrs: Record<string, string> = {
    fill: NO_PAINT,
    stroke: sanitizeCssValue(stroke.color, INHERITED_COLOR),
    'stroke-width': num(stroke.width),
    'stroke-linecap': stroke.cap,
    'stroke-linejoin': stroke.join,
    'stroke-opacity': String(stroke.opacity),
  }
  if (stroke.dash.length > 0) {
    attrs['stroke-dasharray'] = stroke.dash.map(num).join(' ')
  }
  if (stroke.nonScaling) attrs['vector-effect'] = NON_SCALING_STROKE
  return attrs
}

/** 真要画的那两档上色：`none` 档由调用方整层摘掉，进不到这里。 */
type Twin2dSvgFill = Exclude<Twin2dPaint, { kind: 'none' }>

// 引不到的渐变退回「不上色」：url(#不存在) 在浏览器里就是整个形状不画，
// 而配置面上那一档看着是选中的
function fillAttr(
  fill: Twin2dSvgFill,
  gradients: readonly Twin2dGradient[],
  idPrefix: string,
): string {
  if (fill.kind === 'color') {
    return sanitizeCssValue(fill.color, INHERITED_COLOR)
  }
  const found = gradients.some((gradient) => gradient.id === fill.id)
  if (!found) return NO_PAINT
  return `url(#${svgGradientDomId(idPrefix, fill.id)})`
}

/**
 * 一段几何要画几遍：填充一层在下，多遍描边从下往上叠在上面。
 * ⚠ 层序不能反：宽底窄芯两遍**就是**双线（电路图的母线靠它），倒过来是窄的那遍
 * 被宽的那遍整条盖住，看着只剩一根粗线。
 * ⚠ `fill` 为 `none` 时不产填充层：产一个什么都不画的元素只是白占一个节点。
 * @param fill SVG 上色三档
 * @param strokes 多遍描边，文档序即从下往上
 * @param gradients 本图元的局部渐变表，用来判 `fill` 引得到引不到
 * @param idPrefix 本次挂载的实例前缀
 */
export function svgPaintLayers(
  fill: Twin2dPaint,
  strokes: readonly Twin2dStrokePass[],
  gradients: readonly Twin2dGradient[],
  idPrefix: string,
): readonly Twin2dSvgLayer[] {
  const layers: Twin2dSvgLayer[] = []
  if (fill.kind !== 'none') {
    layers.push({
      key: FILL_LAYER_KEY,
      attrs: { fill: fillAttr(fill, gradients, idPrefix) },
    })
  }
  for (const stroke of strokes) {
    layers.push({
      key: `${STROKE_LAYER_KEY}${stroke.id}`,
      attrs: svgStrokeAttrs(stroke),
    })
  }
  return layers
}

/**
 * vec 图元 → 基类内联样式 + 根 `<svg>` 的属性。
 * ⚠ viewBox 与 `unit` 档的换算取的是**同一个** ctx 盒尺寸，两者必须同源：viewBox 按
 * A 算、坐标按 B 乘，`unit` 的 1.0 就落不到边上，而两处单看都说得通。
 * ⚠ 盒尺寸非正数时兜到 1：`viewBox="0 0 0 0"` 会让整层什么都不画。
 * ⚠ `overflow: visible` 不能省：`<svg>` 的 UA 缺省是裁掉溢出，贴着边画的描边会被
 * 切掉外侧半根，看着像「线画细了」。
 * @param prim 已归一化的 vec 图元
 * @param ctx 节点实例、盒尺寸与实例前缀
 */
export function paintVec(
  prim: Twin2dVecPrim,
  ctx: Twin2dPaintCtx,
): Twin2dPaintOut {
  const base = paintBase(prim, ctx)
  if (prim.hidden) return base
  const w = posDim(ctx.boxW, MIN_BOX)
  const h = posDim(ctx.boxH, MIN_BOX)
  const attrs: Record<string, string> = { viewBox: `0 0 ${num(w)} ${num(h)}` }
  if (prim.stretch) attrs['preserveAspectRatio'] = FREE_ASPECT
  return {
    style: { ...base.style, overflow: 'visible' },
    classes: base.classes,
    attrs,
  }
}
