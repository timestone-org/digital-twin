/**
 * @fileoverview bar-chart 的取值表：几何档、取数档、行级画法与行级挂轴四组枚举，
 * 外加柱宽/圆角的可配区间与几个渲染侧的固定口径。
 * 清单的下拉与取值层、option 层的白名单共用这一份。
 *
 * ⚠ 各抄一份的话，加一档必然有一边漏，表现是面板能选、渲染静默回落缺省档——
 * 「选了没反应」最常见的来源。
 * ⚠ 表是 `as const` 只读数组，而 `ConfigField.options` 要的是可变数组：清单里写
 * `options: [...BAR_STYLES]` 摊一次。直接赋值红在 TS4104，且只有 `vue-tsc` 看得见——
 * `vitest` 的 esbuild 不做类型检查，整包测试会在它红着的时候全绿。
 */
import type { ConfigOption } from '@dt/contracts'

/** 取值数组：`readEnum` 的白名单直接从选项表推，不再手抄一遍。 */
function valuesOf<T extends string>(
  options: readonly { value: T; label: string }[],
): readonly T[] {
  return options.map((option) => option.value)
}

/**
 * 五档几何。
 * ⚠ `percent` 的分母由取值层自己算：交给 echarts 的 `stack` 百分比语义要靠
 * `dataset` 组件，而那个组件没有注册；自己算还能让「一整列全缺」留空而不是画成 0%。
 * ⚠ `diverging` 只把值轴改成正负对称，不动配色：按正负改色会让同一行的柱在
 * 回馈与用电之间来回换色，读者会以为换了一个系列。
 */
export const BAR_STYLES = [
  { value: 'grouped', label: '并排' },
  { value: 'stacked', label: '堆叠' },
  { value: 'percent', label: '百分比堆叠' },
  { value: 'horizontal', label: '横向条形' },
  { value: 'diverging', label: '正负对称' },
] as const satisfies readonly ConfigOption[]

export type BarStyle = (typeof BAR_STYLES)[number]['value']
export const BAR_STYLE_VALUES = valuesOf(BAR_STYLES)

/**
 * 这一块读哪一路。
 * ⚠ 两路都绑了也只读这一档指定的那一路，另一路在图例后缀上标出来——
 * 不标的话用户会以为自己绑错了点位。
 */
export const BAR_VALUE_SOURCES = [
  { value: 'live', label: '实时读数' },
  { value: 'history', label: '历史序列' },
] as const satisfies readonly ConfigOption[]

export type BarValueSource = (typeof BAR_VALUE_SOURCES)[number]['value']
export const BAR_VALUE_SOURCE_VALUES = valuesOf(BAR_VALUE_SOURCES)

/** 行级画法：一行画成柱，还是画成压在柱上的折线。 */
export const BAR_PLOTS = [
  { value: 'bar', label: '柱' },
  { value: 'line', label: '折线' },
] as const satisfies readonly ConfigOption[]

export type BarPlot = (typeof BAR_PLOTS)[number]['value']
export const BAR_PLOT_VALUES = valuesOf(BAR_PLOTS)

/** 行级挂轴：量纲差得远的两路（产量与达标率）各挂一边才读得出来。 */
export const BAR_AXES = [
  { value: 'left', label: '左轴' },
  { value: 'right', label: '右轴' },
] as const satisfies readonly ConfigOption[]

export type BarAxis = (typeof BAR_AXES)[number]['value']
export const BAR_AXIS_VALUES = valuesOf(BAR_AXES)

/** 柱宽按像素给，留空 = 交给 echarts 按类目数自适应。 */
export const BAR_WIDTH_MIN = 1
export const BAR_WIDTH_MAX = 200

/** 柱角圆角，按像素给。 */
export const BAR_RADIUS_MIN = 0
export const BAR_RADIUS_MAX = 40
export const BAR_RADIUS_DEFAULT = 2

/** 百分比档固定一位小数：两位在柱顶读不出差别，只会把标签挤成两行。 */
export const BAR_SHARE_DIGITS = 1

/** 整块缺省小数位，与 `unitPrecisionFields()` 的 help 同口径。 */
export const BAR_DEFAULT_PRECISION = 2
