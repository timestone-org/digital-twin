/** @fileoverview 单动画控制的持久化形状与状态值。 */
export const ANIMATION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
] as const
export interface TwinAnimationControl {
  clip: string
  name: string
  mode: 'off' | 'always' | 'point'
  operator: (typeof ANIMATION_OPERATORS)[number]
  threshold: number
  speed: number
  stop: 'pause' | 'reset'
  restart: boolean
  loop: 'repeat' | 'once'
  missing: 'pause' | 'reset'
}
export type TwinAnimationValues = Readonly<Record<string, unknown>>
