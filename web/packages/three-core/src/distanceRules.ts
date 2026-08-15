/**
 * @fileoverview 按相机距离求显隐、淡出与点击门禁。纯函数，不认识 three。
 *
 * 距离不在这里算：每条规则自带参考系（`TwinDistanceRef`），同一个元素上三条
 * 规则可以各用各的参考系，所以调用方传进来的是一个「按参考系取距离」的函数。
 *
 * ⚠ 两处口径**刻意不同**，别顺手统一：
 * 显隐按字面比，`hideAbove: 0` 就是「永远隐藏」；点击门禁则在阈值 ≤ 0 或距离
 * 取不到时一律放行。理由是两种误判的代价不对等——多响应一次点击用户看得见也
 * 能撤销，而一个被错误隐藏的元素既看不见、也无从知道它为什么不见了。
 */
import type {
  TwinClickDistanceRule,
  TwinDistanceRef,
  TwinDistanceRule,
  TwinVisibilityRule,
} from '@dt/twin-config'

/** 按参考系取相机距离；取不到（模型没加载、部件没命中）给 null。 */
export type DistanceResolver = (ref: TwinDistanceRef) => number | null

/** 一个元素这一帧该怎么显示。 */
export interface TwinVisibilityState {
  visible: boolean
  /** 0..1；1 = 不透明。 */
  opacity: number
}

/** 完全不受距离影响时的状态。 */
export const FULLY_VISIBLE: TwinVisibilityState = Object.freeze({
  visible: true,
  opacity: 1,
})

const HIDDEN: TwinVisibilityState = Object.freeze({
  visible: false,
  opacity: 0,
})

/**
 * 点击落在部件上时该怎么办。
 * `approach` = 离得太远，这一下先把镜头拉近，不算真点击。
 */
export type TwinClickGate = 'allow' | 'block' | 'approach'

/**
 * 取一条规则对应的距离；算不出来的一律当「没有距离」。
 * ⚠ NaN 必须在这里挡掉：它参与任何比较都是 false，会让「隐藏」与「不隐藏」
 * 两条分支同时不成立，最后落到哪一档全看代码怎么写的，读代码看不出来。
 */
function distanceFor(
  rule: TwinDistanceRule | null,
  distanceOf: DistanceResolver,
): number | null {
  if (rule === null) return null
  const distance = distanceOf(rule.ref)
  if (distance === null || !Number.isFinite(distance)) return null
  return distance
}

/** 夹进 0..1；NaN 当 1（不透明），绝不让它流进渲染层。 */
function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value))
}

/**
 * 这一帧的显隐与不透明度。
 *
 * ⚠ 距离取不到时**不隐藏**：算不出来就不该动它。反过来做的话，模型还没加载完
 * 的那几帧里所有元素会先闪一下不见，而这既没有报错也没有任何线索。
 *
 * @param rule 归一化后的显隐规则
 * @param distanceOf 按参考系取距离
 */
export function resolveVisibility(
  rule: TwinVisibilityRule,
  distanceOf: DistanceResolver,
): TwinVisibilityState {
  // 作者直接关掉的，距离再怎么样也不显示
  if (!rule.visible) return HIDDEN

  const below = distanceFor(rule.hideBelow, distanceOf)
  if (below !== null && rule.hideBelow !== null && below < rule.hideBelow.value) {
    return HIDDEN
  }
  const above = distanceFor(rule.hideAbove, distanceOf)
  if (above !== null && rule.hideAbove !== null && above > rule.hideAbove.value) {
    return HIDDEN
  }

  const fade = rule.fade
  if (fade === null) return FULLY_VISIBLE
  const at = distanceFor(fade.at, distanceOf)
  if (at === null) return FULLY_VISIBLE
  // 「淡出」是一档不是一段渐变：契约里只有一个阈值，没有渐变区间的起止
  const faded =
    fade.direction === 'below' ? at < fade.at.value : at > fade.at.value
  return faded
    ? { visible: true, opacity: clampOpacity(fade.opacity) }
    : FULLY_VISIBLE
}

/** 一条门禁阈值成立吗；阈值 ≤ 0 或距离取不到一律不成立（= 不限制）。 */
function gateTriggers(
  rule: TwinDistanceRule | null,
  distanceOf: DistanceResolver,
  compare: (distance: number, threshold: number) => boolean,
): boolean {
  if (rule === null || rule.value <= 0) return false
  const distance = distanceFor(rule, distanceOf)
  if (distance === null) return false
  return compare(distance, rule.value)
}

/**
 * 点击部件时的距离门禁。
 *
 * ⚠ 一律往「放行」偏：阈值 ≤ 0、距离取不到、规则没配，全都当不限制。
 * 误挡一次点击的表现是「点了没反应」，用户找不到原因也没法自行恢复。
 *
 * @param rule 归一化后的点击距离规则
 * @param distanceOf 按参考系取距离
 */
export function resolveClickGate(
  rule: TwinClickDistanceRule,
  distanceOf: DistanceResolver,
): TwinClickGate {
  if (gateTriggers(rule.min, distanceOf, (d, t) => d < t)) return 'block'
  if (gateTriggers(rule.max, distanceOf, (d, t) => d > t)) return 'block'
  // 两段式：远于分界时第一下只拉近镜头，再点才是真点击
  if (gateTriggers(rule.farThreshold, distanceOf, (d, t) => d > t)) {
    return 'approach'
  }
  return 'allow'
}
