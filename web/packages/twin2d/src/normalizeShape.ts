/**
 * @fileoverview 五种 SVG 几何的归一化。画不出来的一律判非法（返回 null），
 * 由调用方决定丢弃还是退缺省。口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2。
 */
import { TWIN_2D_SHAPE_KINDS } from './kinds'
import {
  boolOr,
  finiteOr,
  isRecord,
  oneOf,
  toArray,
  toFiniteNumber,
  trimmedString,
} from './sanitize'
import type { Twin2dShapeKind } from './kinds'
import type { Twin2dShape } from './typesPrim'

/** 两个必须为正的几何量；任一不合法则整段几何非法。 */
function posPair(
  raw: Record<string, unknown>,
  first: string,
  second: string,
): readonly [number, number] | null {
  const a = toFiniteNumber(raw[first])
  const b = toFiniteNumber(raw[second])
  if (a === null || a <= 0 || b === null || b <= 0) return null
  return [a, b]
}

/** 矩形；宽高必须为正。 */
function rectShape(raw: Record<string, unknown>): Twin2dShape | null {
  const size = posPair(raw, 'w', 'h')
  if (size === null) return null
  return {
    kind: 'rect',
    x: finiteOr(raw['x'], 0),
    y: finiteOr(raw['y'], 0),
    w: size[0],
    h: size[1],
    rx: Math.max(0, finiteOr(raw['rx'], 0)),
  }
}

/** 椭圆；两个半径必须为正。 */
function ellipseShape(raw: Record<string, unknown>): Twin2dShape | null {
  const radii = posPair(raw, 'rx', 'ry')
  if (radii === null) return null
  return {
    kind: 'ellipse',
    cx: finiteOr(raw['cx'], 0),
    cy: finiteOr(raw['cy'], 0),
    rx: radii[0],
    ry: radii[1],
  }
}

/** 折线；点里任一坐标取不到数就丢弃该点，不足两点就不是一段几何。 */
function polyShape(raw: Record<string, unknown>): Twin2dShape | null {
  const points: (readonly [number, number])[] = []
  for (const item of toArray(raw['points'])) {
    const pair = toArray(item)
    const x = toFiniteNumber(pair[0])
    const y = toFiniteNumber(pair[1])
    if (x === null || y === null) continue
    points.push([x, y])
  }
  if (points.length < 2) return null
  return { kind: 'poly', points, closed: boolOr(raw['closed'], false) }
}

/**
 * 五种几何：`path` / `rect` / `ellipse` / `line` / `poly`。
 * ⚠ 尺寸为 0 的矩形与椭圆一律判非法而不是回缺省：0 宽的形状在 devtools 里
 * 看着一切正常，只是什么都没画出来。
 * @param raw 原始值
 */
export function normalizeShape(raw: unknown): Twin2dShape | null {
  if (!isRecord(raw)) return null
  switch (oneOf<Twin2dShapeKind | ''>(raw['kind'], TWIN_2D_SHAPE_KINDS, '')) {
    case 'path': {
      const d = trimmedString(raw['d'])
      return d === '' ? null : { kind: 'path', d }
    }
    case 'rect':
      return rectShape(raw)
    case 'ellipse':
      return ellipseShape(raw)
    case 'line':
      return {
        kind: 'line',
        x1: finiteOr(raw['x1'], 0),
        y1: finiteOr(raw['y1'], 0),
        x2: finiteOr(raw['x2'], 0),
        y2: finiteOr(raw['y2'], 0),
      }
    case 'poly':
      return polyShape(raw)
    default:
      return null
  }
}
