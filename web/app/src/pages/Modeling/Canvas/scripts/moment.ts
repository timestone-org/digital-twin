/**
 * @fileoverview 时刻字段的三种写法：相对（`-90d`）、绝对（UTC RFC3339）、留空。
 *
 * ⚠ 相对与绝对**都要保留**：相对写法让一条流水线导出到别的环境仍然有意义，
 * 绝对写法用来复现某一段历史。只给日历选择器的话前者根本没法表达
 * （MODELING_DESIGN §8.3）。
 */

/** 相对写法：负号 + 数字 + 单位。 */
const RELATIVE = /^-\d+(s|m|h|d|w|mo|y)$/

/** 三种取值方式。 */
export type MomentMode = 'blank' | 'relative' | 'absolute'

/** 相对写法的常用档。列在下拉里，用户也可以自己敲别的。 */
export const RELATIVE_PRESETS: readonly { value: string; label: string }[] = [
  { value: '-1d', label: '最近 1 天' },
  { value: '-7d', label: '最近 7 天' },
  { value: '-30d', label: '最近 30 天' },
  { value: '-90d', label: '最近 90 天' },
  { value: '-180d', label: '最近 180 天' },
  { value: '-1y', label: '最近 1 年' },
]

/** 这个取值是哪一种写法。 */
export function modeOf(value: string): MomentMode {
  if (value.trim() === '') return 'blank'
  return RELATIVE.test(value.trim()) ? 'relative' : 'absolute'
}

/** 这个相对写法合不合法。不合法时参数面板当场标红，不等运行时才报。 */
export function isRelative(value: string): boolean {
  return RELATIVE.test(value.trim())
}

/** 换一种写法时给的初值：相对给最近 90 天，另两种给空。 */
export function seedFor(mode: MomentMode): string {
  return mode === 'relative' ? '-90d' : ''
}
