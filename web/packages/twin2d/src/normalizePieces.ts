/**
 * @fileoverview 图元盒那一族的归一化：长度、尺寸、内边距、圆角、字体、布局、边框、
 * 摆位、动画、过渡、描边字与图标/文本来源。上色在 normalizePaint.ts，几何在
 * normalizeShape.ts。口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§4.3、§5。
 */
import {
  TWIN_2D_ALIGNS,
  TWIN_2D_ANCHORS,
  TWIN_2D_ANIM_KINDS,
  TWIN_2D_BORDER_STYLES,
  TWIN_2D_FLOWS,
  TWIN_2D_ICO_SRC_KINDS,
  TWIN_2D_JUSTIFIES,
  TWIN_2D_PLACEMENT_KINDS,
  TWIN_2D_SPRITE_IDS,
  TWIN_2D_TRANSITION_PROPS,
  TWIN_2D_TXT_SRC_KINDS,
} from './kinds'
import {
  colorOr,
  normalizePaint,
  normalizeStrokes,
  unitOr,
} from './normalizePaint'
import { normalizeShape } from './normalizeShape'
import {
  boolOr,
  finiteOr,
  isRecord,
  isTwin2dLen,
  lenOr,
  oneOf,
  posDim,
  toArray,
  toFiniteNumber,
  trimmedString,
} from './sanitize'
import type {
  Twin2dPlacementKind,
  Twin2dSpriteId,
  Twin2dTransitionProp,
} from './kinds'
import type {
  Twin2dAnim,
  Twin2dBorder,
  Twin2dDrawPart,
  Twin2dIcoSrc,
  Twin2dInset,
  Twin2dLayout,
  Twin2dLen,
  Twin2dPad,
  Twin2dPlacement,
  Twin2dRadius,
  Twin2dSize,
  Twin2dTextOutline,
  Twin2dTransition,
  Twin2dTxtSrc,
} from './typesPrim'
import type { FontValue } from '@dt/contracts'

/** 绝对定位里「不给这一边」的位移缺省 */
const ZERO_OFFSET = '0'
/** 描边字线宽缺省 */
const OUTLINE_WIDTH = 1
/** 过渡时长缺省（毫秒） */
const TRANSITION_MS = 180
/** 过渡缓动缺省 */
const TRANSITION_EASING = 'ease'
/** 循环动画时长缺省（毫秒） */
const ANIM_MS = 1000
/** 手绘图标的 viewBox 边长缺省 */
const DRAW_VIEWBOX = 48

const ZERO_QUAD = Object.freeze([0, 0, 0, 0] as const)
const AUTO_SIZE: Twin2dSize = Object.freeze({ w: 'auto', h: 'auto' })
const FLOW_PLACEMENT: Twin2dPlacement = Object.freeze({ kind: 'flow' })
const NO_ICO: Twin2dIcoSrc = Object.freeze({ kind: 'none' })
const EMPTY_TEXT: Twin2dTxtSrc = Object.freeze({ kind: 'lit', text: '' })
const EMPTY_FONT: FontValue = Object.freeze({})

/**
 * 可缺席的长度：认不出口径就是「这一边不给」，而不是回落成 0。
 * ⚠ 回落成 0 会把 `abs` 的一条边钉死在容器边缘，看着像布局算错了。
 * @param value 原始值
 */
export function optionalLen(value: unknown): Twin2dLen | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = trimmedString(value)
  if (isTwin2dLen(text)) return text
  return toFiniteNumber(text)
}

/** 四元非负数组；长度不是 4 一律整条回缺省。 */
function nonNegQuad(raw: unknown, fallback: Twin2dPad): Twin2dPad {
  const items = toArray(raw)
  if (items.length !== 4) return fallback
  return [
    Math.max(0, finiteOr(items[0], fallback[0])),
    Math.max(0, finiteOr(items[1], fallback[1])),
    Math.max(0, finiteOr(items[2], fallback[2])),
    Math.max(0, finiteOr(items[3], fallback[3])),
  ]
}

/**
 * 四向内边距（设计像素），顺序 t / r / b / l。
 * @param raw 原始值
 */
export function normalizePad(raw: unknown): Twin2dPad {
  return nonNegQuad(raw, ZERO_QUAD)
}

/**
 * 图元盒的宽高；缺席的一边是 `auto`。
 * @param raw 原始值
 */
export function normalizeSize(raw: unknown): Twin2dSize {
  if (!isRecord(raw)) return AUTO_SIZE
  return { w: lenOr(raw['w'], 'auto'), h: lenOr(raw['h'], 'auto') }
}

/** 四向内缩，顺序 t / r / b / l；缺席的一边是 0。 */
function normalizeInset(raw: unknown): Twin2dInset {
  const items = toArray(raw)
  return [
    lenOr(items[0], 0),
    lenOr(items[1], 0),
    lenOr(items[2], 0),
    lenOr(items[3], 0),
  ]
}

/**
 * 圆角三形：一个数、`'pill'`、或四角分别给（顺序 tl / tr / br / bl）。
 * @param raw 原始值
 */
export function normalizeRadius(raw: unknown): Twin2dRadius {
  if (raw === 'pill') return 'pill'
  const items = toArray(raw)
  if (items.length === 4) return nonNegQuad(items, ZERO_QUAD)
  return Math.max(0, finiteOr(raw, 0))
}

/** 字重：`'bold'` 这类关键字与数字都收。 */
function fontWeight(value: unknown): number | string | null {
  if (typeof value === 'string') {
    const text = value.trim()
    return text === '' ? null : text
  }
  return toFiniteNumber(value)
}

/**
 * 字体：键都可缺席，缺席即跟随主题，所以不合口径的键一律不写出来。
 * ⚠ 不许把缺席键写成 `undefined`——`exactOptionalPropertyTypes` 下那是两回事，
 * 而一个显式的 undefined 落到渲染层会盖掉主题值。
 * @param raw 原始值
 */
export function normalizeFont(raw: unknown): FontValue {
  if (!isRecord(raw)) return EMPTY_FONT
  const family = trimmedString(raw['family'])
  const size = toFiniteNumber(raw['size'])
  const weight = fontWeight(raw['weight'])
  const letterSpacing = toFiniteNumber(raw['letterSpacing'])
  const color = trimmedString(raw['color'])
  return {
    ...(family === '' ? {} : { family }),
    ...(size === null || size <= 0 ? {} : { size }),
    ...(weight === null ? {} : { weight }),
    ...(letterSpacing === null ? {} : { letterSpacing }),
    ...(color === '' ? {} : { color }),
  }
}

/**
 * box 的排布。
 * @param raw 原始值
 */
export function normalizeLayout(raw: unknown): Twin2dLayout {
  const rec = isRecord(raw) ? raw : {}
  return {
    flow: oneOf(rec['flow'], TWIN_2D_FLOWS, 'row'),
    gap: Math.max(0, finiteOr(rec['gap'], 0)),
    align: oneOf(rec['align'], TWIN_2D_ALIGNS, 'start'),
    justify: oneOf(rec['justify'], TWIN_2D_JUSTIFIES, 'start'),
    wrap: boolOr(rec['wrap'], false),
    pad: normalizePad(rec['pad']),
  }
}

/**
 * 边框；四条边缺省全画，宽度缺省 0 即「没配边框」。
 * @param raw 原始值
 */
export function normalizeBorder(raw: unknown): Twin2dBorder {
  const rec = isRecord(raw) ? raw : {}
  const sides = isRecord(rec['sides']) ? rec['sides'] : {}
  return {
    width: Math.max(0, finiteOr(rec['width'], 0)),
    style: oneOf(rec['style'], TWIN_2D_BORDER_STYLES, 'solid'),
    color: colorOr(rec['color']),
    sides: {
      top: boolOr(sides['top'], true),
      right: boolOr(sides['right'], true),
      bottom: boolOr(sides['bottom'], true),
      left: boolOr(sides['left'], true),
    },
  }
}

/** 绝对定位；四边各自可缺席，tx / ty 是自身尺寸的位移串。 */
function absPlacement(raw: Record<string, unknown>): Twin2dPlacement {
  const tx = trimmedString(raw['tx'])
  const ty = trimmedString(raw['ty'])
  return {
    kind: 'abs',
    left: optionalLen(raw['left']),
    right: optionalLen(raw['right']),
    top: optionalLen(raw['top']),
    bottom: optionalLen(raw['bottom']),
    tx: tx === '' ? ZERO_OFFSET : tx,
    ty: ty === '' ? ZERO_OFFSET : ty,
  }
}

/**
 * 摆位五档；认不出一律回 `flow`，即参与父级的流。
 * ⚠ `anchor` 与 `perim` 的位移数学不同，不许合并：九档走一张固定的 tx/ty 百分比表，
 * `perim` 走法线推出半个自身尺寸（§4.3）。
 * @param raw 原始值
 */
export function normalizePlacement(raw: unknown): Twin2dPlacement {
  if (!isRecord(raw)) return FLOW_PLACEMENT
  switch (
    oneOf<Twin2dPlacementKind | ''>(raw['kind'], TWIN_2D_PLACEMENT_KINDS, '')
  ) {
    case 'fill':
      return { kind: 'fill', inset: normalizeInset(raw['inset']) }
    case 'abs':
      return absPlacement(raw)
    case 'anchor':
      return {
        kind: 'anchor',
        anchor: oneOf(raw['anchor'], TWIN_2D_ANCHORS, 'c'),
        dx: finiteOr(raw['dx'], 0),
        dy: finiteOr(raw['dy'], 0),
      }
    case 'perim':
      return {
        kind: 'perim',
        t: unitOr(raw['t'], 0),
        gap: finiteOr(raw['gap'], 0),
        dx: finiteOr(raw['dx'], 0),
        dy: finiteOr(raw['dy'], 0),
      }
    default:
      return FLOW_PLACEMENT
  }
}

/**
 * keyframes 循环动画；不是对象就是「没配动画」。
 * @param raw 原始值
 */
export function normalizeAnim(raw: unknown): Twin2dAnim | null {
  if (!isRecord(raw)) return null
  return {
    kind: oneOf(raw['kind'], TWIN_2D_ANIM_KINDS, 'none'),
    durationMs: posDim(raw['durationMs'], ANIM_MS),
  }
}

/**
 * 属性过渡；六档之外的属性名逐个丢弃，全丢光就是「没配过渡」。
 * ⚠ 它与 `anim` 是两件事，不能互相顶：少了它的表现是「哪儿都能配、就是手感不一样」，
 * 没有一处报错（§4.2）。
 * @param raw 原始值
 */
export function normalizeTransition(raw: unknown): Twin2dTransition | null {
  if (!isRecord(raw)) return null
  const props: Twin2dTransitionProp[] = []
  for (const item of toArray(raw['props'])) {
    const prop = oneOf<Twin2dTransitionProp | ''>(
      item,
      TWIN_2D_TRANSITION_PROPS,
      '',
    )
    if (prop === '' || props.includes(prop)) continue
    props.push(prop)
  }
  if (props.length === 0) return null
  const easing = trimmedString(raw['easing'])
  return {
    props,
    durationMs: posDim(raw['durationMs'], TRANSITION_MS),
    easing: easing === '' ? TRANSITION_EASING : easing,
  }
}

/**
 * 描边字；不是对象就是「不描边」。
 * @param raw 原始值
 */
export function normalizeOutline(raw: unknown): Twin2dTextOutline | null {
  if (!isRecord(raw)) return null
  return {
    width: posDim(raw['width'], OUTLINE_WIDTH),
    color: colorOr(raw['color']),
  }
}

/**
 * 手绘图标的一笔一笔：一个受限的 vec，没有子树也没有摆位。
 * 画不出几何的那一笔整条丢弃。
 * @param raw 原始值
 */
export function normalizeDrawParts(raw: unknown): Twin2dDrawPart[] {
  const parts: Twin2dDrawPart[] = []
  for (const item of toArray(raw)) {
    if (!isRecord(item)) continue
    const shape = normalizeShape(item['shape'])
    if (shape === null) continue
    parts.push({
      shape,
      fill: normalizePaint(item['fill']),
      strokes: normalizeStrokes(item['strokes']),
    })
  }
  return parts
}

/** 内置图标集一档；id 不在名单里等于永远渲染空白，退回空档。 */
function spriteIcoSrc(raw: Record<string, unknown>): Twin2dIcoSrc {
  const id = oneOf<Twin2dSpriteId | ''>(raw['id'], TWIN_2D_SPRITE_IDS, '')
  return id === '' ? NO_ICO : { kind: 'sprite', id }
}

/** 手绘一档；一笔都没有就等于什么都不画，退回空档。 */
function drawIcoSrc(raw: Record<string, unknown>): Twin2dIcoSrc {
  const parts = normalizeDrawParts(raw['parts'])
  if (parts.length === 0) return NO_ICO
  const box = toArray(raw['viewBox'])
  return {
    kind: 'draw',
    viewBox: [posDim(box[0], DRAW_VIEWBOX), posDim(box[1], DRAW_VIEWBOX)],
    parts,
  }
}

/**
 * 图标四来源加一个空档。
 * ⚠ `sprite` 的 id 必须落在 `TWIN_2D_SPRITE_IDS` 里：名单外的 id 在渲染层是一个
 * 解析不到的 `<use href>`，图标静默消失而 DOM 元素还在（§5）。
 * @param raw 原始值
 */
export function normalizeIcoSrc(raw: unknown): Twin2dIcoSrc {
  if (!isRecord(raw)) return NO_ICO
  switch (oneOf(raw['kind'], TWIN_2D_ICO_SRC_KINDS, 'none')) {
    case 'name': {
      const name = trimmedString(raw['name'])
      return name === '' ? NO_ICO : { kind: 'name', name }
    }
    case 'sprite':
      return spriteIcoSrc(raw)
    case 'asset': {
      const ref = trimmedString(raw['ref'])
      return ref === '' ? NO_ICO : { kind: 'asset', ref }
    }
    case 'draw':
      return drawIcoSrc(raw)
    default:
      return NO_ICO
  }
}

/** 字面文本原样保留首尾空白：那是排版的一部分。 */
function literalText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 文本五来源；认不出与取不到槽键的都退成空字面量。
 * ⚠ 退成 `label` 会让一处配错的文本图元冒出节点名，看着像「显示名重复了」。
 * @param raw 原始值
 */
export function normalizeTxtSrc(raw: unknown): Twin2dTxtSrc {
  if (!isRecord(raw)) return EMPTY_TEXT
  switch (oneOf(raw['kind'], TWIN_2D_TXT_SRC_KINDS, 'lit')) {
    case 'slot': {
      const slot = trimmedString(raw['slot'])
      return slot === '' ? EMPTY_TEXT : { kind: 'slot', slot }
    }
    case 'label':
      return { kind: 'label' }
    case 'id':
      return { kind: 'id' }
    case 'badge':
      return { kind: 'badge' }
    default:
      return { kind: 'lit', text: literalText(raw['text']) }
  }
}

/**
 * 行高倍数；非正数与非有限数一律回 null（= 跟随主题）。
 * ⚠ 0 不当有效值：`line-height: 0` 会把整行压成一条缝而不报错，而用户想表达的
 * 「不设行高」在这里的写法是不给这一键（§7.7 #51）。
 * @param value 原始值
 */
export function normalizeLineHeight(value: unknown): number | null {
  const parsed = toFiniteNumber(value)
  return parsed === null || parsed <= 0 ? null : parsed
}
