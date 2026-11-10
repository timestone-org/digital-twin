/** @fileoverview 单动画控制配置、点位条件与运行值缝合。 */
import { clampedOr, oneOf } from './normalizeShared'
import { isRecord, toArray, toFiniteNumber, trimmedString } from './sanitize'

import {
  ANIMATION_LOOPS,
  ANIMATION_MODES,
  ANIMATION_OPERATORS,
  ANIMATION_STOPS,
  type TwinAnimationControl,
  type TwinAnimationValues,
} from './animationTypes'
export { ANIMATION_OPERATORS } from './animationTypes'
export type {
  TwinAnimationControl,
  TwinAnimationValues,
} from './animationTypes'

/** 播放倍速区间；再慢看不出在动，再快一闪而过。 */
const MIN_ANIMATION_SPEED = 0.05
const MAX_ANIMATION_SPEED = 4

/**
 * 归一化动画控制清单；同一个剪辑只留第一条。
 * @param raw 落库的控制清单
 */
export function normalizeAnimationControls(
  raw: unknown,
): TwinAnimationControl[] {
  const controls = new Map<string, TwinAnimationControl>()
  for (const entry of toArray(raw)) {
    if (!isRecord(entry)) continue
    const clip = trimmedString(entry.clip)
    if (clip === '' || controls.has(clip)) continue
    controls.set(clip, {
      clip,
      name: trimmedString(entry.name),
      mode: oneOf(entry.mode, ANIMATION_MODES, 'off'),
      operator: oneOf(entry.operator, ANIMATION_OPERATORS, 'eq'),
      threshold: toFiniteNumber(entry.threshold) ?? 1,
      speed: clampedOr(
        entry.speed,
        1,
        MIN_ANIMATION_SPEED,
        MAX_ANIMATION_SPEED,
      ),
      stop: oneOf(entry.stop, ANIMATION_STOPS, 'pause'),
      restart: entry.restart === true,
      loop: oneOf(entry.loop, ANIMATION_LOOPS, 'repeat'),
      missing: oneOf(entry.missing, ANIMATION_STOPS, 'pause'),
    })
  }
  return [...controls.values()]
}

/**
 * 点位条件此刻成不成立；布尔读数按 1 / 0 比。
 * @param control 比较符与阈值
 * @param raw 点位读数
 * @returns 取不到数时给 null
 */
export function animationCondition(
  control: Pick<TwinAnimationControl, 'operator' | 'threshold'>,
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

/**
 * 把绑定行的读数按剪辑名缝起来，行号与控制清单的次序一一对应。
 * @param controls 归一化后的控制清单
 * @param raw 动画绑定槽的整行读数
 */
export function animationValuesOf(
  controls: readonly TwinAnimationControl[],
  raw: unknown,
): TwinAnimationValues {
  const rows = toArray(raw)
  return Object.fromEntries(
    controls.map((control, index) => {
      const row = rows[index]
      return [control.clip, isRecord(row) ? row.value : null]
    }),
  )
}
