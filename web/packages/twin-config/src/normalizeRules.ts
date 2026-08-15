/**
 * @fileoverview 距离规则、可见性规则与点击门禁的归一化。
 *
 * ⚠ 「没配」与「配了个零」必须分得开：`hideBelow` 为 null 是不做近距隐藏，
 * 而 `{ ref: 'orbit', value: 0 }` 是「距离小于 0 时隐藏」——后者永不成立。
 * 把没配归一成 0 会让两者变成同一件事，而错的那一半永远不会被察觉。
 */
import { boolOr, clampedOr, oneOf } from './normalizeShared'
import { isRecord, toFiniteNumber } from './sanitize'
import {
  TWIN_DISTANCE_REFS,
  TWIN_FADE_DIRECTIONS,
  type TwinClickDistanceRule,
  type TwinDistanceRef,
  type TwinDistanceRule,
  type TwinVisibilityFade,
  type TwinVisibilityRule,
} from './types'

/** 一条都没配的可见性：看得见，不随距离变。 */
export const ALWAYS_VISIBLE: TwinVisibilityRule = Object.freeze({
  visible: true,
  hideBelow: null,
  hideAbove: null,
  fade: null,
})

/** 一条都没配的点击门禁：任何距离都能点。 */
export const NO_CLICK_LIMIT: TwinClickDistanceRule = Object.freeze({
  min: null,
  max: null,
  farThreshold: null,
})

/**
 * 一条距离规则；不是对象或阈值取不到就是「没配」。
 * @param raw 落库的规则
 * @param fallbackRef 这一处的缺省参考系
 */
export function normalizeDistance(
  raw: unknown,
  fallbackRef: TwinDistanceRef,
): TwinDistanceRule | null {
  if (!isRecord(raw)) return null
  const value = toFiniteNumber(raw.value)
  if (value === null) return null
  return {
    ref: oneOf(raw.ref, TWIN_DISTANCE_REFS, fallbackRef),
    value,
  }
}

function normalizeFade(raw: unknown): TwinVisibilityFade | null {
  if (!isRecord(raw)) return null
  const at = normalizeDistance(raw.at, 'orbit')
  // 阈值缺了整条作废：半条规则插不出透明度，留着只会假装配好了
  if (at === null) return null
  return {
    at,
    direction: oneOf(raw.direction, TWIN_FADE_DIRECTIONS, 'above'),
    opacity: clampedOr(raw.opacity, 0, 0, 1),
  }
}

/**
 * 一个元素的可见性规则。
 * ⚠ `visible` 缺省是**看得见**：缺省不可见会让一份没配过的场景整个空掉，
 * 而用户看到的是「模型加载了但什么都没有」。
 * @param raw 落库的规则
 * @param legacyVisible 同层的老写法 `visible: boolean`，只在 `raw` 缺席时看
 */
export function normalizeVisibility(
  raw: unknown,
  legacyVisible?: unknown,
): TwinVisibilityRule {
  if (!isRecord(raw)) {
    return { ...ALWAYS_VISIBLE, visible: legacyVisible !== false }
  }
  return {
    visible: boolOr(raw.visible, legacyVisible !== false),
    hideBelow: normalizeDistance(raw.hideBelow, 'orbit'),
    hideAbove: normalizeDistance(raw.hideAbove, 'orbit'),
    fade: normalizeFade(raw.fade),
  }
}

/**
 * 部件点击的距离门禁。三个阈值的缺省参考系都是部件包围盒中心——
 * 「离这个部件多远」才是点它时人脑子里想的那个距离。
 * @param raw 落库的门禁
 */
export function normalizeClickDistance(raw: unknown): TwinClickDistanceRule {
  if (!isRecord(raw)) return NO_CLICK_LIMIT
  return {
    min: normalizeDistance(raw.min, 'part-center'),
    max: normalizeDistance(raw.max, 'part-center'),
    farThreshold: normalizeDistance(raw.farThreshold, 'part-center'),
  }
}
