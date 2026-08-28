/**
 * @fileoverview 内置预置的出厂尺度：各族按参考尺度产样式，这一道把**长度类**取值等比
 * 缩到 1080p 大屏上的观感档。缩哪些、不缩哪些与为什么见
 * docs/MODULE_TWIN_2D_DESIGN.md §7.13。
 */
import type { Twin2dVecCoord } from '../kinds'
import type {
  Twin2dNodeStyle,
  Twin2dOutline,
  Twin2dPinMarker,
  Twin2dPort,
  Twin2dVariant,
} from '../types'
import type {
  Twin2dBoxPrim,
  Twin2dFill,
  Twin2dIcoPrim,
  Twin2dInset,
  Twin2dLen,
  Twin2dPad,
  Twin2dPrim,
  Twin2dPrimBase,
  Twin2dPrimPatch,
  Twin2dRadius,
  Twin2dRootPatch,
  Twin2dShadow,
  Twin2dShape,
  Twin2dSize,
  Twin2dStrokePass,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../typesPrim'
import type { FontValue } from '@dt/contracts'

/**
 * 内置预置相对参考尺度的出厂缩放档。
 * ⚠ 存量数据的迁移脚本必须读这一个数：另写一份字面量就是第二份真源，而两份漂开之后
 * 迁移过的图与新拖进画布的节点尺寸对不上，一处都不报错。
 */
export const TWIN_2D_PRESET_SCALE = 0.75

/** 字号地板：缩到这个数就不再往下缩 */
export const TWIN_2D_PRESET_MIN_FONT_SIZE = 12

/** 长度缩完定到 0.01 设计像素 */
const LENGTH_DIGITS = 2
/** 节点盒的最小边长 */
const MIN_NODE_SIDE = 1

// 缩完定到 0.01 设计像素：浮点乘出来的十几位小数既读不了也断言不了
function scaled(value: number, scale: number): number {
  return Number((value * scale).toFixed(LENGTH_DIGITS))
}

/**
 * 一个长度：裸数按比例缩，百分比 / `em` / `auto` 三种串形原样。
 * ⚠ 三种串形本就是相对量——百分比归父盒、`em` 归字号，而两者都已经缩过一遍了，
 * 再缩一次就是同一个比例乘了两遍。
 * @param len 长度值
 * @param scale 缩放比
 */
function scaleLen(len: Twin2dLen, scale: number): Twin2dLen {
  return typeof len === 'number' ? scaled(len, scale) : len
}

// null 是「不设限」，与显式 0 区分得开，故不能并成一档
function scaleLenOrNull(
  len: Twin2dLen | null,
  scale: number,
): Twin2dLen | null {
  return len === null ? null : scaleLen(len, scale)
}

function scaleSize(size: Twin2dSize, scale: number): Twin2dSize {
  return { w: scaleLen(size.w, scale), h: scaleLen(size.h, scale) }
}

function scaleInset(inset: Twin2dInset, scale: number): Twin2dInset {
  return [
    scaleLen(inset[0], scale),
    scaleLen(inset[1], scale),
    scaleLen(inset[2], scale),
    scaleLen(inset[3], scale),
  ]
}

function scalePad(pad: Twin2dPad, scale: number): Twin2dPad {
  return [
    scaled(pad[0], scale),
    scaled(pad[1], scale),
    scaled(pad[2], scale),
    scaled(pad[3], scale),
  ]
}

// 'pill' 是「半个短边」这个规则本身，不是一个长度
function scaleRadius(radius: Twin2dRadius, scale: number): Twin2dRadius {
  if (typeof radius === 'number') return scaled(radius, scale)
  if (radius === 'pill') return radius
  return [
    scaled(radius[0], scale),
    scaled(radius[1], scale),
    scaled(radius[2], scale),
    scaled(radius[3], scale),
  ]
}

/**
 * 摆位五档里的长度。
 * ⚠ `abs` 的 `tx` / `ty` 一格不动：它们是**相对自身尺寸**的位移串，里面还夹着
 * `calc(-100% - 4px)` 这样的常量留白，要缩就得在这里再写一个 CSS 解析器。
 * ⚠ `perim` 的 `t` 是 0..1 的周长参数，不是长度。
 * @param at 摆位
 * @param scale 缩放比
 */
function scalePlacement(
  at: Twin2dPrimBase['at'],
  scale: number,
): Twin2dPrimBase['at'] {
  switch (at.kind) {
    case 'flow':
      return at
    case 'fill':
      return { kind: 'fill', inset: scaleInset(at.inset, scale) }
    case 'abs':
      return {
        ...at,
        left: scaleLenOrNull(at.left, scale),
        right: scaleLenOrNull(at.right, scale),
        top: scaleLenOrNull(at.top, scale),
        bottom: scaleLenOrNull(at.bottom, scale),
      }
    case 'anchor':
      return { ...at, dx: scaled(at.dx, scale), dy: scaled(at.dy, scale) }
    case 'perim':
      return {
        ...at,
        gap: scaled(at.gap, scale),
        dx: scaled(at.dx, scale),
        dy: scaled(at.dy, scale),
      }
  }
}

/**
 * 一层填充：只有 `repeat` 一档带长度。
 * ⚠ `radial` 的 `cx` / `cy` / `r` 与色标的 `at` 都是 0..1 归一值，`linear` 的 `angle`
 * 是角度——跟着缩会让高光整个跑出形状外，而画面上只表现为「底色变了」。
 * @param fill 一层填充
 * @param scale 缩放比
 */
function scaleFill(fill: Twin2dFill, scale: number): Twin2dFill {
  if (fill.kind !== 'repeat') return fill
  return {
    ...fill,
    width: scaled(fill.width, scale),
    gap: scaled(fill.gap, scale),
  }
}

function scaleShadow(shadow: Twin2dShadow, scale: number): Twin2dShadow {
  return {
    ...shadow,
    x: scaled(shadow.x, scale),
    y: scaled(shadow.y, scale),
    blur: scaled(shadow.blur, scale),
    spread: scaled(shadow.spread, scale),
  }
}

function scaleShadows(
  shadows: readonly Twin2dShadow[],
  scale: number,
): readonly Twin2dShadow[] {
  return shadows.map((shadow) => scaleShadow(shadow, scale))
}

function scaleLayout(
  layout: Twin2dBoxPrim['layout'],
  scale: number,
): Twin2dBoxPrim['layout'] {
  return {
    ...layout,
    gap: scaled(layout.gap, scale),
    pad: scalePad(layout.pad, scale),
  }
}

/**
 * 一段几何：只有 `px` 档要缩，`unit` 档是 0..1 归一值、乘的是实例盒尺寸。
 * ⚠ `px` 档的 `path` 原样出——`d` 是一段串，逐数缩不了。要跟着尺寸走的路径只能写成
 * `unit` 档，写成 `px` 的表现是「整张图缩了、就这一枚没缩」，一处都不报错。
 * @param shape 五种几何之一
 * @param coord 坐标口径
 * @param scale 缩放比
 */
function scaleShape(
  shape: Twin2dShape,
  coord: Twin2dVecCoord,
  scale: number,
): Twin2dShape {
  if (coord === 'unit') return shape
  switch (shape.kind) {
    case 'path':
      return shape
    case 'rect':
      return {
        ...shape,
        x: scaled(shape.x, scale),
        y: scaled(shape.y, scale),
        w: scaled(shape.w, scale),
        h: scaled(shape.h, scale),
        rx: scaled(shape.rx, scale),
      }
    case 'ellipse':
      return {
        ...shape,
        cx: scaled(shape.cx, scale),
        cy: scaled(shape.cy, scale),
        rx: scaled(shape.rx, scale),
        ry: scaled(shape.ry, scale),
      }
    case 'line':
      return {
        ...shape,
        x1: scaled(shape.x1, scale),
        y1: scaled(shape.y1, scale),
        x2: scaled(shape.x2, scale),
        y2: scaled(shape.y2, scale),
      }
    case 'poly':
      return {
        ...shape,
        points: shape.points.map(([x, y]) => [
          scaled(x, scale),
          scaled(y, scale),
        ]),
      }
  }
}

/**
 * 一遍描边：只缩虚线段长。
 * ⚠ **线宽不缩**：0.75 档下 1px 的引线会掉到 0.75px，在非整数设备像素比上渲成一条
 * 发虚的灰线；而 `nonScaling` 的那几遍本就声明了「不随任何缩放走」，缩它等于自相矛盾。
 * @param stroke 一遍描边
 * @param scale 缩放比
 */
function scaleStroke(
  stroke: Twin2dStrokePass,
  scale: number,
): Twin2dStrokePass {
  return { ...stroke, dash: stroke.dash.map((seg) => scaled(seg, scale)) }
}

// 地板不抬字号：本就小于地板的原样留着，只挡「越缩越读不清」这一个方向
function scaleFontSize(size: number, scale: number): number {
  const floor = Math.min(size, TWIN_2D_PRESET_MIN_FONT_SIZE)
  return Math.max(scaled(size, scale), floor)
}

/**
 * 字体：字号缩到地板为止，字距按比例缩。
 * ⚠ 缺席键就是「跟随主题」，不能补上再缩：补一个数进去等于把主题里的字体钉死在
 * 这份预置上（§4.2）。
 * @param font 字体各项
 * @param scale 缩放比
 */
function scaleFont(font: FontValue, scale: number): FontValue {
  const out: FontValue = { ...font }
  if (font.size !== undefined) out.size = scaleFontSize(font.size, scale)
  if (font.letterSpacing !== undefined) {
    out.letterSpacing = scaled(font.letterSpacing, scale)
  }
  return out
}

// 图元共有的四项长度；其余十二项（层级、透明度、旋转、等比缩放、过渡…）都不是长度
function scaleBaseFields(
  prim: Twin2dPrimBase,
  scale: number,
): Pick<Twin2dPrimBase, 'at' | 'size' | 'minWidth' | 'maxWidth'> {
  return {
    at: scalePlacement(prim.at, scale),
    size: scaleSize(prim.size, scale),
    minWidth: scaleLenOrNull(prim.minWidth, scale),
    maxWidth: scaleLenOrNull(prim.maxWidth, scale),
  }
}

/**
 * 盒：排布、填充、圆角、阴影、背景模糊与整棵子树。
 * ⚠ `border.width` 不缩，与描边同一条规矩。
 */
function scaleBoxPrim(prim: Twin2dBoxPrim, scale: number): Twin2dBoxPrim {
  return {
    ...prim,
    ...scaleBaseFields(prim, scale),
    layout: scaleLayout(prim.layout, scale),
    fills: prim.fills.map((fill) => scaleFill(fill, scale)),
    radius: scaleRadius(prim.radius, scale),
    shadows: scaleShadows(prim.shadows, scale),
    backdropBlur: scaled(prim.backdropBlur, scale),
    children: prim.children.map((child) => scalePrim(child, scale)),
  }
}

/**
 * 矢量：几何按坐标档决定缩不缩，描边只缩虚线段长。
 * ⚠ `gradients` 的坐标是**对象包围盒**的 0..1 归一值（`svgGradientAttrs` 的口径），
 * 跟着缩会让渐变整个跑到形状外面去，画面上只剩纯色。
 */
function scaleVecPrim(prim: Twin2dVecPrim, scale: number): Twin2dVecPrim {
  return {
    ...prim,
    ...scaleBaseFields(prim, scale),
    shape: scaleShape(prim.shape, prim.coord, scale),
    strokes: prim.strokes.map((stroke) => scaleStroke(stroke, scale)),
  }
}

/**
 * 图标：只缩基类那四项。
 * ⚠ `src` 的 `draw` 一档一格不动：那一档自带 `viewBox`，是一套自洽的坐标系，
 * 图标画多大由图元的 `size` 说了算——跟着缩等于把同一个比例乘了两遍，画面上是
 * 「图标在自己的框里缩成一小团」。
 */
function scaleIcoPrim(prim: Twin2dIcoPrim, scale: number): Twin2dIcoPrim {
  return { ...prim, ...scaleBaseFields(prim, scale) }
}

/**
 * 文本：字体与字晕。
 * ⚠ `lineHeight` 是**倍数**不是长度，`outline.width` 是描边宽，两样都不缩。
 */
function scaleTxtPrim(prim: Twin2dTxtPrim, scale: number): Twin2dTxtPrim {
  return {
    ...prim,
    ...scaleBaseFields(prim, scale),
    font: scaleFont(prim.font, scale),
    shadows: scaleShadows(prim.shadows, scale),
  }
}

function scalePrim(prim: Twin2dPrim, scale: number): Twin2dPrim {
  switch (prim.kind) {
    case 'box':
      return scaleBoxPrim(prim, scale)
    case 'vec':
      return scaleVecPrim(prim, scale)
    case 'ico':
      return scaleIcoPrim(prim, scale)
    case 'txt':
      return scaleTxtPrim(prim, scale)
  }
}

// 补丁只覆盖显式给出的键：缺席与显式给 undefined 是两件事，故逐键判在不在
function applyBasePatchScale(patch: Twin2dPrimPatch, scale: number): void {
  if (patch.at !== undefined) patch.at = scalePlacement(patch.at, scale)
  if (patch.size !== undefined) patch.size = scaleSize(patch.size, scale)
  if (patch.minWidth !== undefined) {
    patch.minWidth = scaleLenOrNull(patch.minWidth, scale)
  }
  if (patch.maxWidth !== undefined) {
    patch.maxWidth = scaleLenOrNull(patch.maxWidth, scale)
  }
}

function applyBoxPatchScale(patch: Twin2dPrimPatch, scale: number): void {
  if (patch.layout !== undefined) {
    patch.layout = scaleLayout(patch.layout, scale)
  }
  if (patch.fills !== undefined) {
    patch.fills = patch.fills.map((fill) => scaleFill(fill, scale))
  }
  if (patch.radius !== undefined) {
    patch.radius = scaleRadius(patch.radius, scale)
  }
  if (patch.shadows !== undefined) {
    patch.shadows = scaleShadows(patch.shadows, scale)
  }
  if (patch.backdropBlur !== undefined) {
    patch.backdropBlur = scaled(patch.backdropBlur, scale)
  }
}

function applyLeafPatchScale(
  patch: Twin2dPrimPatch,
  coord: Twin2dVecCoord,
  scale: number,
): void {
  if (patch.shape !== undefined) {
    patch.shape = scaleShape(patch.shape, patch.coord ?? coord, scale)
  }
  if (patch.strokes !== undefined) {
    patch.strokes = patch.strokes.map((stroke) => scaleStroke(stroke, scale))
  }
  if (patch.font !== undefined) patch.font = scaleFont(patch.font, scale)
}

/**
 * 一条图元补丁。
 * @param patch 浅覆盖补丁
 * @param coord 被补丁那枚 vec 的坐标档；补丁自己声明了 `coord` 时以补丁的为准
 * @param scale 缩放比
 */
function scalePrimPatch(
  patch: Twin2dPrimPatch,
  coord: Twin2dVecCoord,
  scale: number,
): Twin2dPrimPatch {
  const out: Twin2dPrimPatch = { ...patch }
  applyBasePatchScale(out, scale)
  applyBoxPatchScale(out, scale)
  applyLeafPatchScale(out, coord, scale)
  return out
}

/**
 * 节点根覆盖：只有抬升与阴影是长度。
 * ⚠ `scale` 一格不动：那是 hover 的等比放大**倍数**，缩它会让「抬起来还变大」变成
 * 「抬起来但缩了一点」，而每一项取值看着都对（§7 #9）。
 */
function scaleRootPatch(root: Twin2dRootPatch, scale: number): Twin2dRootPatch {
  const out: Twin2dRootPatch = { ...root }
  if (root.lift !== undefined) out.lift = scaled(root.lift, scale)
  if (root.shadows !== undefined) {
    out.shadows = scaleShadows(root.shadows, scale)
  }
  return out
}

function scaleVariant(
  variant: Twin2dVariant,
  coords: ReadonlyMap<string, Twin2dVecCoord>,
  scale: number,
): Twin2dVariant {
  const patch: Record<string, Twin2dPrimPatch> = {}
  for (const [id, one] of Object.entries(variant.patch)) {
    patch[id] = scalePrimPatch(one, coords.get(id) ?? 'px', scale)
  }
  return {
    ...variant,
    patch,
    rootPatch: scaleRootPatch(variant.rootPatch, scale),
  }
}

// 引脚符号的几何与 `px` 档 vec 是同一把尺子；线宽同样不缩
function scalePinMarker(
  marker: Twin2dPinMarker,
  scale: number,
): Twin2dPinMarker {
  return {
    ...marker,
    shape: scaleShape(marker.shape, 'px', scale),
    strokes: marker.strokes.map((stroke) => scaleStroke(stroke, scale)),
    length: scaled(marker.length, scale),
  }
}

/**
 * 一个端口。
 * ⚠ `at` 两档都是归一值（周长参数 / 盒内 0..1 坐标），一格都不缩：缩了引脚会整体
 * 往左上角挤，而连线照样接得上——只是接在符号上没有的地方。
 */
function scalePort(port: Twin2dPort, scale: number): Twin2dPort {
  if (port.marker === null) return port
  return { ...port, marker: scalePinMarker(port.marker, scale) }
}

// `round` 之外三档不读 r，跟着缩不改变任何渲染结果，故不为它分档
function scaleOutline(outline: Twin2dOutline, scale: number): Twin2dOutline {
  return { ...outline, r: scaled(outline.r, scale) }
}

// 节点盒必须是正整数：`normalizeNodeStyle` 对 size 就是 `posDim` 之后 `Math.round`，
// 留小数会让「预置过一遍归一化恒等」不再成立，而拖进画布走的正是那条路
function scaleNodeSide(side: number, scale: number): number {
  return Math.max(MIN_NODE_SIDE, Math.round(side * scale))
}

// vec 的 id → 坐标档：变体补丁按图元 id 寻址，判几何缩不缩要回来问这张表
function vecCoordsOf(
  prims: readonly Twin2dPrim[],
  into: Map<string, Twin2dVecCoord>,
): Map<string, Twin2dVecCoord> {
  for (const prim of prims) {
    if (prim.kind === 'vec') into.set(prim.id, prim.coord)
    if (prim.kind === 'box') vecCoordsOf(prim.children, into)
  }
  return into
}

/**
 * 一份节点样式整体缩一档：长度类取值等比缩小，比例、时长、透明度、颜色与线宽不动。
 * @param style 参考尺度的样式
 * @param scale 缩放比，出厂档取 `TWIN_2D_PRESET_SCALE`
 */
export function twin2dScaleNodeStyle(
  style: Twin2dNodeStyle,
  scale: number,
): Twin2dNodeStyle {
  const coords = vecCoordsOf(style.prims, new Map<string, Twin2dVecCoord>())
  return {
    ...style,
    size: {
      w: scaleNodeSide(style.size.w, scale),
      h: scaleNodeSide(style.size.h, scale),
    },
    outline: scaleOutline(style.outline, scale),
    prims: style.prims.map((prim) => scalePrim(prim, scale)),
    ports: style.ports.map((port) => scalePort(port, scale)),
    variants: style.variants.map((one) => scaleVariant(one, coords, scale)),
  }
}
