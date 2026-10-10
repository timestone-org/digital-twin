/** @fileoverview 部件状态效果的配置、触发判断与周期强度。 */
import { animationCondition } from './animationControl'
import { boolOr, clampedOr, oneOf } from './normalizeShared'
import { isRecord, normalizeColorSpec, toFiniteNumber } from './sanitize'
import { ANIMATION_OPERATORS } from './animationTypes'
import { TWIN_PART_EFFECT_MODES, TWIN_PART_EFFECT_PATTERNS } from './types'
import type { TwinPart, TwinPartEffect } from './types'

export const DEFAULT_PART_EFFECT: Readonly<TwinPartEffect> = Object.freeze({
  enabled: true,
  mode: 'point',
  operator: 'eq',
  threshold: 1,
  pattern: 'pulse',
  color: '--state-warning',
  blend: 0.85,
  glow: 1.2,
  periodMs: 1600,
})

export const MIN_PART_EFFECT_PERIOD_MS = 600
export const MAX_PART_EFFECT_PERIOD_MS = 10000
const MAX_EFFECT_GLOW = 3

function effectColor(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim() === '') return ''
  return normalizeColorSpec(raw) ?? DEFAULT_PART_EFFECT.color
}

/** 没有配置时返回null，开关关闭时保留整份规则。 */
export function normalizePartEffect(raw: unknown): TwinPartEffect | null {
  if (!isRecord(raw)) return null
  return {
    enabled: boolOr(raw.enabled, DEFAULT_PART_EFFECT.enabled),
    mode: oneOf(raw.mode, TWIN_PART_EFFECT_MODES, DEFAULT_PART_EFFECT.mode),
    operator: oneOf(
      raw.operator,
      ANIMATION_OPERATORS,
      DEFAULT_PART_EFFECT.operator,
    ),
    threshold: toFiniteNumber(raw.threshold) ?? DEFAULT_PART_EFFECT.threshold,
    pattern: oneOf(
      raw.pattern,
      TWIN_PART_EFFECT_PATTERNS,
      DEFAULT_PART_EFFECT.pattern,
    ),
    color: effectColor(raw.color),
    blend: clampedOr(raw.blend, DEFAULT_PART_EFFECT.blend, 0, 1),
    glow: clampedOr(raw.glow, DEFAULT_PART_EFFECT.glow, 0, MAX_EFFECT_GLOW),
    periodMs: clampedOr(
      raw.periodMs,
      DEFAULT_PART_EFFECT.periodMs,
      MIN_PART_EFFECT_PERIOD_MS,
      MAX_PART_EFFECT_PERIOD_MS,
    ),
  }
}

/** 规则存在就保留绑定行，不随enabled或触发方式过滤。 */
export function effectParts(parts: readonly TwinPart[]): TwinPart[] {
  return parts.filter(
    (part) => part.effect !== undefined && part.effect !== null,
  )
}

/** 条件不满足或没有有效数据时不启用效果。 */
export function partEffectActive(
  effect: TwinPartEffect | null | undefined,
  value: unknown,
): boolean {
  if (effect === undefined || effect === null || !effect.enabled) return false
  return effect.mode === 'always' || animationCondition(effect, value) === true
}

/** 从亮相开始的周期强度，低谷回到原来的外观。 */
export function partEffectIntensity(
  effect: TwinPartEffect,
  elapsedMs: number,
): number {
  if (effect.pattern === 'steady') return 1
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const phase = (elapsed % effect.periodMs) / effect.periodMs
  if (effect.pattern === 'blink') return phase < 0.5 ? 1 : 0
  return (1 + Math.cos(phase * Math.PI * 2)) / 2
}
