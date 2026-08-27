/**
 * @fileoverview 四个检查器与各自的字段控件共用的三件小事：闭合取值表摆成选项、
 * 补丁与现值的比对，以及两个反复出现的数字取值域。
 *
 * ⚠ 收成一份不是为了少写几行：四个检查器是分头写的，同一件事各写一份的话，
 * 有一份改了口径（比如「与现值相同就不记一帧」漏了某一类值）就只有那一个面板出错，
 * 而两个面板看起来一模一样。
 */
import type { DtNumberRange, DtSegmentedOption, FontValue } from '@dt/contracts'

/** 0..1 的量纲：周长参数、不透明度与沿线位置共用，一格 0.05。 */
export const TWIN_2D_UNIT_RANGE: Readonly<DtNumberRange> = Object.freeze({
  min: 0,
  max: 1,
  step: 0.05,
})

/** 设计像素坐标：可正可负，一格一像素。 */
export const TWIN_2D_PX_RANGE: Readonly<DtNumberRange> = Object.freeze({
  step: 1,
})

/**
 * 闭合取值表 → 选项表，档位顺序就是表里的顺序。
 * @param list 闭合取值表
 * @param labels 每一档的中文名
 */
export function enumOptions<T extends string>(
  list: readonly T[],
  labels: Readonly<Record<T, string>>,
): readonly DtSegmentedOption[] {
  return list.map((value) => ({ value, label: labels[value] }))
}

/**
 * 这份补丁里至少有一个字段与现值不同。
 * ⚠ 数字框每次失焦都回抛一次当前值，不比一遍的话「点进去又点出来」就白记一帧撤销。
 * @param current 现值摊平成的记录
 * @param patch 待写入的字段
 */
export function fieldsChanged(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(patch).some(([key, value]) => current[key] !== value)
}

/**
 * 换掉字体里的一个键；空值一律**删键**而不是写 undefined——缺席才是「跟随排版」，
 * 而 `exactOptionalPropertyTypes` 下显式的 undefined 与缺席是两回事。
 * @param font 现在的字体
 * @param key 哪一个键
 * @param value 新值，`undefined` 与空串都当作清掉
 */
export function twin2dFontWith<K extends keyof FontValue>(
  font: FontValue,
  key: K,
  value: FontValue[K],
): FontValue {
  const next: FontValue = { ...font }
  if (value === undefined || value === '') delete next[key]
  else next[key] = value
  return next
}

/**
 * 五个键逐一比过。
 * ⚠ 字体每次都是新对象，只比引用等于每次都算改过，于是「点进去又点出来」就白记一帧。
 * @param a 一份字体
 * @param b 另一份字体
 */
export function twin2dSameFont(a: FontValue, b: FontValue): boolean {
  return (
    a.family === b.family &&
    a.size === b.size &&
    a.weight === b.weight &&
    a.letterSpacing === b.letterSpacing &&
    a.color === b.color
  )
}
