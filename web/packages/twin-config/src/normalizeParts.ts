/**
 * @fileoverview 部件外观与状态染色的归一化。
 *
 * ⚠ 「没配染色」与「配了一条空规则」必须分得开：`tint` 为 null 时这个部件
 * **不占绑定行**，而 `{ mode: 'stops', stops: [] }` 是「取数但一档都没命中」。
 * 把前者归一成后者会凭空多出一行绑定，而它绑上点位也永远不会有任何效果。
 * ⚠ 档位的**顺序**是配置的一部分（自上而下取第一个命中的），这里只清洗不重排。
 */
import { clampedOr, entityId, normalizeList, oneOf } from './normalizeShared'
import {
  isRecord,
  normalizeColorSpec,
  toFiniteNumber,
  trimmedString,
} from './sanitize'
import {
  TWIN_TINT_MATCHES,
  TWIN_TINT_MODES,
  type TwinPartLook,
  type TwinPartTint,
  type TwinTintGradient,
  type TwinTintStop,
} from './types'

/** 常态染色浓度：染上去还看得出金属/纹理，不至于糊成一块纯色。 */
const DEFAULT_BLEND = 0.85
/** 自发光上限；再高只是把画面烧白。 */
const MAX_GLOW = 3
/** 渐变缺省区间，配成 0–100 让百分比类点位开箱即用。 */
export const DEFAULT_TINT_GRADIENT: TwinTintGradient = Object.freeze({
  min: 0,
  max: 100,
  from: '--state-success',
  to: '--state-danger',
})

/** 一条都没配的常态外观：完全按模型自带的材质走。 */
export const DEFAULT_PART_LOOK: TwinPartLook = Object.freeze({
  opacity: 1,
  color: '',
  blend: DEFAULT_BLEND,
  glow: 0,
})

/**
 * 颜色规格；解析不出来一律空串（= 不染色）。
 * ⚠ 不回落到某个默认色：回落会让「token 名写错了」看起来像「配对了」，
 * 而 3D 画面上没有任何别的迹象能提示这一点。
 */
function colorSpec(raw: unknown): string {
  return normalizeColorSpec(raw) ?? ''
}

/**
 * 部件常态外观。
 * @param raw 落库的外观
 */
export function normalizePartLook(raw: unknown): TwinPartLook {
  if (!isRecord(raw)) return { ...DEFAULT_PART_LOOK }
  return {
    opacity: clampedOr(raw.opacity, 1, 0, 1),
    color: colorSpec(raw.color),
    blend: clampedOr(raw.blend, DEFAULT_BLEND, 0, 1),
    glow: clampedOr(raw.glow, 0, 0, MAX_GLOW),
  }
}

/**
 * 一档取色。
 * ⚠ 颜色空着的档位**照样保留**：它的意思是「命中这一档就保持原色」，
 * 与「没有这一档」不同——有它才能截住后面的档位。
 */
function normalizeStop(raw: unknown, index: number): TwinTintStop | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'stop', index),
    match: oneOf(raw.match, TWIN_TINT_MATCHES, 'range'),
    from: toFiniteNumber(raw.from),
    to: toFiniteNumber(raw.to),
    equals: trimmedString(raw.equals),
    color: colorSpec(raw.color),
    label: trimmedString(raw.label),
  }
}

function normalizeGradient(raw: unknown): TwinTintGradient {
  if (!isRecord(raw)) return { ...DEFAULT_TINT_GRADIENT }
  return {
    min: toFiniteNumber(raw.min) ?? DEFAULT_TINT_GRADIENT.min,
    max: toFiniteNumber(raw.max) ?? DEFAULT_TINT_GRADIENT.max,
    from: colorSpec(raw.from) || DEFAULT_TINT_GRADIENT.from,
    to: colorSpec(raw.to) || DEFAULT_TINT_GRADIENT.to,
  }
}

/**
 * 部件的状态染色规则；不是对象即「这个部件不取数」。
 * @param raw 落库的规则
 */
export function normalizePartTint(raw: unknown): TwinPartTint | null {
  if (!isRecord(raw)) return null
  return {
    mode: oneOf(raw.mode, TWIN_TINT_MODES, 'stops'),
    stops: normalizeList(raw.stops, normalizeStop),
    gradient: normalizeGradient(raw.gradient),
    fallback: colorSpec(raw.fallback),
  }
}
