/** @fileoverview 单动画控制配置、点位条件与运行值缝合。 */
import { clampedOr, oneOf } from './normalizeShared'
import { isRecord, toFiniteNumber, trimmedString } from './sanitize'

import {
  ANIMATION_OPERATORS,
  type TwinAnimationControl,
  type TwinAnimationValues,
} from './animationTypes'
export { ANIMATION_OPERATORS } from './animationTypes'
export type {
  TwinAnimationControl,
  TwinAnimationValues,
} from './animationTypes'

export function normalizeAnimationControls(
  raw: unknown,
): TwinAnimationControl[] {
  if (!Array.isArray(raw)) return []
  const controls = new Map<string, TwinAnimationControl>()
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const clip = trimmedString(entry.clip)
    if (clip === '' || controls.has(clip)) continue
    controls.set(clip, {
      clip,
      name: trimmedString(entry.name),
      mode: oneOf(entry.mode, ['off', 'always', 'point'], 'off'),
      operator: oneOf(entry.operator, ANIMATION_OPERATORS, 'eq'),
      threshold: toFiniteNumber(entry.threshold) ?? 1,
      speed: clampedOr(entry.speed, 1, 0.05, 4),
      stop: oneOf(entry.stop, ['pause', 'reset'], 'pause'),
      restart: entry.restart === true,
      loop: oneOf(entry.loop, ['repeat', 'once'], 'repeat'),
      missing: oneOf(entry.missing, ['pause', 'reset'], 'pause'),
    })
  }
  return [...controls.values()]
}

export function animationCondition(
  control: TwinAnimationControl,
  raw: unknown,
): boolean | null {
  const value = typeof raw === 'boolean' ? Number(raw) : toFiniteNumber(raw)
  if (value === null) return null
  const threshold = control.threshold
  switch (control.operator) {
    case 'eq':
      return value === threshold
    case 'neq':
      return value !== threshold
    case 'gt':
      return value > threshold
    case 'gte':
      return value >= threshold
    case 'lt':
      return value < threshold
    case 'lte':
      return value <= threshold
  }
}

export function animationValuesOf(
  controls: readonly TwinAnimationControl[],
  raw: unknown,
): TwinAnimationValues {
  const rows: unknown[] = Array.isArray(raw) ? raw : []
  return Object.fromEntries(
    controls.map((control, index) => {
      const row = rows[index]
      return [control.clip, isRecord(row) ? row.value : null]
    }),
  )
}
