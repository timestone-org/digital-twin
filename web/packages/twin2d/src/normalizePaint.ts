/**
 * @fileoverview 上色那一族的归一化：填充层、描边遍、局部渐变、色标、阴影与 SVG 上色。
 * 几何在 normalizeShape.ts，图元本体在 normalizePrims.ts。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§4.4。
 */
import {
  TWIN_2D_BACKGROUND_FITS,
  TWIN_2D_FILL_KINDS,
  TWIN_2D_GRADIENT_KINDS,
  TWIN_2D_PAINT_KINDS,
  TWIN_2D_STROKE_CAPS,
  TWIN_2D_STROKE_JOINS,
} from './kinds'
import {
  boolOr,
  clamp,
  finiteOr,
  idOf,
  isRecord,
  oneOf,
  posDim,
  toArray,
  toFiniteNumber,
  trimmedString,
  uniqueBy,
} from './sanitize'
import type {
  Twin2dFillKind,
  Twin2dGradientKind,
  Twin2dPaintKind,
} from './kinds'
import type {
  Twin2dFill,
  Twin2dGradient,
  Twin2dGradientStop,
  Twin2dPaint,
  Twin2dShadow,
  Twin2dStrokePass,
} from './typesPrim'

/** 未配色时的取色口径 */
const INHERITED_COLOR = 'currentColor'
/** 归一坐标的中点 */
const HALF = 0.5
/** 条纹填充的缝隙缺省 */
const REPEAT_GAP = 4
/** 线宽缺省 */
const STROKE_WIDTH = 1

const NO_PAINT: Twin2dPaint = Object.freeze({ kind: 'none' })

/**
 * 取一个 0..1 的比例；取不到数回缺省，取到了一律夹取。
 * @param value 原始值
 * @param fallback 取不到数时的缺省
 */
export function unitOr(value: unknown, fallback: number): number {
  return clamp(finiteOr(value, fallback), 0, 1)
}

/**
 * 颜色：空串一律回 `currentColor`。
 * ⚠ 回落成空串会让浏览器按 `initial` 取黑色，看着像「主题没生效」。
 * @param value 原始值
 */
export function colorOr(value: unknown): string {
  const text = trimmedString(value)
  return text === '' ? INHERITED_COLOR : text
}

/**
 * 阴影多层；每层都要 id，缺 id 的整条丢弃。
 * ⚠ 拿下标当 `v-for` 的 key 会让改一层顺序时整列重建，所以 id 不许补。
 * @param raw 原始值
 */
export function normalizeShadows(raw: unknown): Twin2dShadow[] {
  const shadows: Twin2dShadow[] = []
  for (const item of toArray(raw)) {
    if (!isRecord(item)) continue
    shadows.push({
      id: idOf(item['id']),
      inset: boolOr(item['inset'], false),
      x: finiteOr(item['x'], 0),
      y: finiteOr(item['y'], 0),
      blur: Math.max(0, finiteOr(item['blur'], 0)),
      spread: finiteOr(item['spread'], 0),
      color: colorOr(item['color']),
    })
  }
  return uniqueBy(shadows, (shadow) => shadow.id)
}

/**
 * 渐变色标；`at` 夹到 0..1。
 * @param raw 原始值
 */
export function normalizeStops(raw: unknown): Twin2dGradientStop[] {
  const stops: Twin2dGradientStop[] = []
  for (const item of toArray(raw)) {
    if (!isRecord(item)) continue
    stops.push({
      id: idOf(item['id']),
      color: colorOr(item['color']),
      at: unitOr(item['at'], 0),
    })
  }
  return uniqueBy(stops, (stop) => stop.id)
}

/** 底图填充；没有 ref 就没有图，整层丢弃。 */
function imageFill(
  raw: Record<string, unknown>,
  id: string,
  opacity: number,
): Twin2dFill | null {
  const ref = trimmedString(raw['ref'])
  if (ref === '') return null
  return {
    kind: 'image',
    id,
    ref,
    fit: oneOf(raw['fit'], TWIN_2D_BACKGROUND_FITS, 'cover'),
    opacity,
  }
}

/** 一层填充；kind 认不出或缺 id 一律丢弃该层。 */
function fillOf(raw: unknown): Twin2dFill | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw['id'])
  if (id === '') return null
  const opacity = unitOr(raw['opacity'], 1)
  switch (oneOf<Twin2dFillKind | ''>(raw['kind'], TWIN_2D_FILL_KINDS, '')) {
    case 'solid':
      return { kind: 'solid', id, color: colorOr(raw['color']), opacity }
    case 'linear':
      return {
        kind: 'linear',
        id,
        angle: finiteOr(raw['angle'], 0),
        stops: normalizeStops(raw['stops']),
        opacity,
      }
    case 'radial':
      return {
        kind: 'radial',
        id,
        cx: finiteOr(raw['cx'], HALF),
        cy: finiteOr(raw['cy'], HALF),
        r: finiteOr(raw['r'], HALF),
        stops: normalizeStops(raw['stops']),
        opacity,
      }
    case 'repeat':
      return {
        kind: 'repeat',
        id,
        angle: finiteOr(raw['angle'], 0),
        color: colorOr(raw['color']),
        width: posDim(raw['width'], STROKE_WIDTH),
        gap: posDim(raw['gap'], REPEAT_GAP),
        opacity,
      }
    case 'image':
      return imageFill(raw, id, opacity)
    default:
      return null
  }
}

/**
 * 多层填充，从下往上叠。
 * @param raw 原始值
 */
export function normalizeFills(raw: unknown): Twin2dFill[] {
  const fills: Twin2dFill[] = []
  for (const item of toArray(raw)) {
    const fill = fillOf(item)
    if (fill !== null) fills.push(fill)
  }
  return uniqueBy(fills, (fill) => fill.id)
}

/** 虚线段长：非有限与负数都丢弃该段。 */
function dashOf(raw: unknown): number[] {
  const dash: number[] = []
  for (const item of toArray(raw)) {
    const length = toFiniteNumber(item)
    if (length === null || length < 0) continue
    dash.push(length)
  }
  return dash
}

/**
 * 多遍描边，从下往上叠。
 * ⚠ 线宽必须落到一个正数：给 0 时 SVG 什么都不画，而整张图看着只是「引脚没了」，
 * 既不报错也不像 bug（§4.4）。
 * @param raw 原始值
 */
export function normalizeStrokes(raw: unknown): Twin2dStrokePass[] {
  const strokes: Twin2dStrokePass[] = []
  for (const item of toArray(raw)) {
    if (!isRecord(item)) continue
    strokes.push({
      id: idOf(item['id']),
      width: posDim(item['width'], STROKE_WIDTH),
      color: colorOr(item['color']),
      dash: dashOf(item['dash']),
      cap: oneOf(item['cap'], TWIN_2D_STROKE_CAPS, 'butt'),
      join: oneOf(item['join'], TWIN_2D_STROKE_JOINS, 'miter'),
      opacity: unitOr(item['opacity'], 1),
      nonScaling: boolOr(item['nonScaling'], false),
    })
  }
  return uniqueBy(strokes, (stroke) => stroke.id)
}

/** 一个局部渐变；kind 认不出或缺 id 一律丢弃。 */
function gradientOf(raw: unknown): Twin2dGradient | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw['id'])
  if (id === '') return null
  const stops = normalizeStops(raw['stops'])
  const kind = oneOf<Twin2dGradientKind | ''>(
    raw['kind'],
    TWIN_2D_GRADIENT_KINDS,
    '',
  )
  if (kind === 'linear') {
    return {
      kind,
      id,
      x1: finiteOr(raw['x1'], 0),
      y1: finiteOr(raw['y1'], 0),
      x2: finiteOr(raw['x2'], 1),
      y2: finiteOr(raw['y2'], 0),
      stops,
    }
  }
  if (kind === '') return null
  return {
    kind,
    id,
    cx: finiteOr(raw['cx'], HALF),
    cy: finiteOr(raw['cy'], HALF),
    r: finiteOr(raw['r'], HALF),
    fx: finiteOr(raw['fx'], HALF),
    fy: finiteOr(raw['fy'], HALF),
    stops,
  }
}

/**
 * 图元内的局部渐变表；id 在本图元内唯一。
 * @param raw 原始值
 */
export function normalizeGradients(raw: unknown): Twin2dGradient[] {
  const gradients: Twin2dGradient[] = []
  for (const item of toArray(raw)) {
    const gradient = gradientOf(item)
    if (gradient !== null) gradients.push(gradient)
  }
  return uniqueBy(gradients, (gradient) => gradient.id)
}

/**
 * SVG 上色三档；引不到的渐变退回「不上色」。
 * @param raw 原始值
 */
export function normalizePaint(raw: unknown): Twin2dPaint {
  if (!isRecord(raw)) return NO_PAINT
  switch (oneOf<Twin2dPaintKind | ''>(raw['kind'], TWIN_2D_PAINT_KINDS, '')) {
    case 'color':
      return { kind: 'color', color: colorOr(raw['color']) }
    case 'gradient': {
      const id = idOf(raw['id'])
      return id === '' ? NO_PAINT : { kind: 'gradient', id }
    }
    default:
      return NO_PAINT
  }
}
