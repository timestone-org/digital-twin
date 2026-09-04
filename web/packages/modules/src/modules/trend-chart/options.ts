/**
 * @fileoverview trend-chart 的取值表：画法、轴别与线型三组枚举，外加线宽与
 * 时间刻度分档的几个常量。清单的下拉与渲染侧的白名单共用这一份。
 * ⚠ 各抄一份的话，加一档必然有一边漏，表现是面板能选、渲染静默回落缺省档——
 * 「选了没反应」最常见的来源。
 * ⚠ 表是 `as const` 只读数组，而 `ConfigField.options` 要的是可变数组：清单里写
 * `options: [...TREND_STYLES]` 摊一次。直接赋值红在 TS4104，且只有 `vue-tsc`
 * 看得见——`vitest` 的 esbuild 不做类型检查，整包测试会在它红着的时候全绿。
 */
import type { ConfigOption } from '@dt/contracts'

/** 取值数组：`readEnum` 的白名单直接从选项表推，不再手抄一遍。 */
function valuesOf<T extends string>(
  options: readonly { value: T; label: string }[],
): readonly T[] {
  return options.map((option) => option.value)
}

/**
 * 五档画法，共用同一条「点序列 → 时间轴」的链，只在折线本身的形状上分叉。
 * ⚠ `stackedArea` 把各条系列的值逐点相加，只有**采样时刻对齐**的几条才叠得对；
 * 而同一块图里两条系列的取数窗口本来就允许不同（窗口住在每条绑定上），
 * 时刻对不上时 echarts 按各自的点各画各的，叠出来的高度没有物理意义。
 */
export const TREND_STYLES = [
  { value: 'line', label: '折线' },
  { value: 'smooth', label: '平滑曲线' },
  { value: 'area', label: '面积' },
  { value: 'stackedArea', label: '堆叠面积' },
  { value: 'step', label: '阶梯' },
] as const satisfies readonly ConfigOption[]

export type TrendStyle = (typeof TREND_STYLES)[number]['value']
export const TREND_STYLE_VALUES = valuesOf(TREND_STYLES)

/** 带面积填充的两档，`areaStyle` 只对它们生效。 */
export const AREA_STYLES: readonly TrendStyle[] = ['area', 'stackedArea']

/**
 * 一条系列挂在哪根 Y 轴上。
 * ⚠ 只有开了双轴才分得出两根轴：没开双轴时右轴根本不存在，这一档静默等同左轴。
 */
export const TREND_AXES = [
  { value: 'left', label: '左轴' },
  { value: 'right', label: '右轴' },
] as const satisfies readonly ConfigOption[]

export type TrendAxis = (typeof TREND_AXES)[number]['value']
export const TREND_AXIS_VALUES = valuesOf(TREND_AXES)

/** 逐条线型，与参考线那一组同名同义。 */
export const TREND_LINE_TYPES = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
] as const satisfies readonly ConfigOption[]

export type TrendLineType = (typeof TREND_LINE_TYPES)[number]['value']
export const TREND_LINE_TYPE_VALUES = valuesOf(TREND_LINE_TYPES)

/** 曲线宽度：1 在墙屏上远看断断续续，3 会把两条挨得近的线糊成一条。 */
export const TREND_LINE_WIDTH = 2

/** 时间轴两端各留的百分比，`boundaryGap` 开着时用。 */
export const TREND_AXIS_GAP = '2%'

/**
 * 时间刻度按实际跨度分三档写法。
 * ⚠ 跨度是**取回来的点**算出来的，不是配置里的窗口：窗口住在每条绑定上，
 * 模块读不到；而同一块图里两条系列的窗口还允许不一样。
 */
export const SPAN_MINUTE_MS = 60_000
export const SPAN_DAY_MS = 86_400_000
export const SPAN_YEAR_MS = 365 * SPAN_DAY_MS

/** 跨度小于它就精确到秒——10 秒周期的点位在分钟刻度上会挤成一坨。 */
export const SPAN_SECOND_LIMIT_MS = 10 * SPAN_MINUTE_MS
