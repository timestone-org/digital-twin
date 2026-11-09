/** @fileoverview 单动画控制的持久化形状与状态值。 */
export const ANIMATION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
] as const
/** 播放方式：不播 / 一直播 / 按点位条件播。 */
export const ANIMATION_MODES = ['off', 'always', 'point'] as const
/** 条件不成立（或取不到值）时停在原地还是回到首帧。 */
export const ANIMATION_STOPS = ['pause', 'reset'] as const
/** 循环播还是只播一遍。 */
export const ANIMATION_LOOPS = ['repeat', 'once'] as const

export interface TwinAnimationControl {
  clip: string
  name: string
  mode: (typeof ANIMATION_MODES)[number]
  operator: (typeof ANIMATION_OPERATORS)[number]
  threshold: number
  speed: number
  stop: (typeof ANIMATION_STOPS)[number]
  restart: boolean
  loop: (typeof ANIMATION_LOOPS)[number]
  missing: (typeof ANIMATION_STOPS)[number]
}
export type TwinAnimationValues = Readonly<Record<string, unknown>>
