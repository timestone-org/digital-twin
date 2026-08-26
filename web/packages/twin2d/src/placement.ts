/**
 * @fileoverview 摆位五档 → 内联定位样式。九档锚点走一张固定的「贴边 + 百分比推移」表，
 * `perim` 走周长落点 + 法线推移，两套位移数学各行其是、不许合并（§4.3）。
 * 周长上的点与外法线一律取自 geometry.ts 的 `perimeterPoint`，这里不另算一遍。
 */
import { sanitizeCssValue } from './cssValue'
import { perimeterPoint } from './geometry'
import type { Twin2dAnchor9 } from './kinds'
import { posDim } from './sanitize'
import type { Twin2dInset, Twin2dLen, Twin2dPlacement } from './typesPrim'

/** 摆位五档里的 `perim` 一档。 */
export type Twin2dPerimAt = Extract<Twin2dPlacement, { kind: 'perim' }>

/** 摆位五档里的 `abs` 一档。 */
type Twin2dAbsAt = Extract<Twin2dPlacement, { kind: 'abs' }>

/** 脱离父级流的定位方式 */
const ABSOLUTE = 'absolute'
/** 自身尺寸的半身位 */
const HALF_SELF = 50
/** 归一值转百分数 */
const PERCENT = 100
/** 无位移 */
const ZERO_OFFSET = '0'
/** 盒尺寸的除零护栏 */
const MIN_BOX = 1

/** 一档锚点：四边各自贴不贴（null = 不写这一边）与两轴的百分比推移。 */
interface AnchorSpec {
  left: string | null
  right: string | null
  top: string | null
  bottom: string | null
  tx: string
  ty: string
}

/**
 * 九档锚点表。
 * ⚠ `-115%` / `110%` / `-20%` 这些量是把图元整个顶到节点盒**外侧**的推移量，逐值照抄、
 * 不许凑整也不许换算成 perim 那套：改一个数就是「药丸压在节点身上」，既不报错也不越界。
 */
const ANCHOR_TABLE: Record<Twin2dAnchor9, AnchorSpec> = {
  t: {
    left: '50%',
    right: null,
    top: '0',
    bottom: null,
    tx: '-50%',
    ty: '-115%',
  },
  b: {
    left: '50%',
    right: null,
    top: null,
    bottom: '0',
    tx: '-50%',
    ty: '115%',
  },
  l: {
    left: '0',
    right: null,
    top: '50%',
    bottom: null,
    tx: '-110%',
    ty: '-50%',
  },
  r: {
    left: null,
    right: '0',
    top: '50%',
    bottom: null,
    tx: '110%',
    ty: '-50%',
  },
  tl: {
    left: '0',
    right: null,
    top: '0',
    bottom: null,
    tx: '-20%',
    ty: '-115%',
  },
  tr: {
    left: null,
    right: '0',
    top: '0',
    bottom: null,
    tx: '20%',
    ty: '-115%',
  },
  bl: {
    left: '0',
    right: null,
    top: null,
    bottom: '0',
    tx: '-20%',
    ty: '115%',
  },
  br: { left: null, right: '0', top: null, bottom: '0', tx: '20%', ty: '115%' },
  c: {
    left: '50%',
    right: null,
    top: '50%',
    bottom: null,
    tx: '-50%',
    ty: '-50%',
  },
}

/**
 * 一个长度值的 CSS 串：裸数按设计像素，百分比 / em / `auto` 三形态原样。
 * @param len 长度值
 */
export function lenToCss(len: Twin2dLen): string {
  return typeof len === 'number' ? `${len}px` : len
}

// 一轴的推移：百分比那一项归自身尺寸，像素那一项归 gap 与 dx/dy
function offsetCss(pct: string, px: number): string {
  return `calc(${pct} + ${px}px)`
}

// 两轴推移拼成 transform
function translateCss(x: string, y: string): string {
  return `translate(${x}, ${y})`
}

/**
 * 九档锚点 → 定位样式：按表贴边，再按表把图元推到盒外侧，末了叠上像素微调。
 * @param anchor 九档之一
 * @param dx 横向像素微调
 * @param dy 纵向像素微调
 */
export function anchor9Css(
  anchor: Twin2dAnchor9,
  dx: number,
  dy: number,
): Record<string, string> {
  const spec = ANCHOR_TABLE[anchor]
  const style: Record<string, string> = { position: ABSOLUTE }
  if (spec.left !== null) style.left = spec.left
  if (spec.right !== null) style.right = spec.right
  if (spec.top !== null) style.top = spec.top
  if (spec.bottom !== null) style.bottom = spec.bottom
  style.transform = translateCss(offsetCss(spec.tx, dx), offsetCss(spec.ty, dy))
  return style
}

/**
 * `perim` 摆位 → 定位样式：`left/top` 是周长落点占盒的百分比，`transform` 由**外法线**
 * 把图元推出半个自身尺寸，再沿法线推 `gap` 像素并叠上 dx/dy。
 * ⚠ 角点的法线是 45°（±√½），所以贴在角上时两轴各推 `50/√2 ≈ 35.36%` 而不是 50%——
 * 少了这个 √2，四个角上的图元会整体外飘出去一截，而四条边上的全对。
 * @param at `perim` 一档的落点、间隙与像素微调
 * @param boxW 节点盒宽（设计像素），非正数按 1 兜底
 * @param boxH 节点盒高（设计像素），非正数按 1 兜底
 */
export function perimCss(
  at: Twin2dPerimAt,
  boxW: number,
  boxH: number,
): Record<string, string> {
  const w = posDim(boxW, MIN_BOX)
  const h = posDim(boxH, MIN_BOX)
  const { point, normal } = perimeterPoint({ x: w / 2, y: h / 2, w, h }, at.t)
  const tx = `${-HALF_SELF + normal.x * HALF_SELF}%`
  const ty = `${-HALF_SELF + normal.y * HALF_SELF}%`
  return {
    position: ABSOLUTE,
    left: `${(point.x / w) * PERCENT}%`,
    top: `${(point.y / h) * PERCENT}%`,
    transform: translateCss(
      offsetCss(tx, normal.x * at.gap + at.dx),
      offsetCss(ty, normal.y * at.gap + at.dy),
    ),
  }
}

// 绝对铺满：四值按 top / right / bottom / left 的文档序直出 inset 简写
function fillCss(inset: Twin2dInset): Record<string, string> {
  return { position: ABSOLUTE, inset: inset.map(lenToCss).join(' ') }
}

// 绝对定位：四边各自可缺席，只写给了的那几边
function absCss(at: Twin2dAbsAt): Record<string, string> {
  const style: Record<string, string> = { position: ABSOLUTE }
  if (at.left !== null) style.left = lenToCss(at.left)
  if (at.right !== null) style.right = lenToCss(at.right)
  if (at.top !== null) style.top = lenToCss(at.top)
  if (at.bottom !== null) style.bottom = lenToCss(at.bottom)
  // ⚠ tx/ty 是用户填的自由串，归一化只 trim 过，进 transform 之前必须过消毒
  style.transform = translateCss(
    sanitizeCssValue(at.tx, ZERO_OFFSET),
    sanitizeCssValue(at.ty, ZERO_OFFSET),
  )
  return style
}

/**
 * 摆位 → 定位样式；`flow` 一档不产任何样式，图元就留在父级的 flex 流里。
 * ⚠ 只出定位这几项：z / opacity / rotate / transition 那几样归基类，混进来会让
 * 同一个属性在两处各写一遍、后写的那处静默赢（§4.2）。
 * @param at 摆位五档
 * @param boxW 节点盒宽（设计像素），只有 `perim` 一档用得上
 * @param boxH 节点盒高（设计像素），只有 `perim` 一档用得上
 */
export function placementCss(
  at: Twin2dPlacement,
  boxW: number,
  boxH: number,
): Record<string, string> {
  switch (at.kind) {
    case 'flow':
      return {}
    case 'fill':
      return fillCss(at.inset)
    case 'abs':
      return absCss(at)
    case 'anchor':
      return anchor9Css(at.anchor, at.dx, at.dy)
    case 'perim':
      return perimCss(at, boxW, boxH)
  }
}
