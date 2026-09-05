/**
 * @fileoverview calendar-heat 的取值表：两档铺法、两档色阶、逐日归并的五档算法，
 * 外加格缝与日历张数的可配区间。清单的下拉与取值层的白名单共用这一份。
 * ⚠ 各抄一份的话，加一档必然有一边漏，表现是面板能选、渲染静默回落缺省档——
 * 「选了没反应」最常见的来源。
 * ⚠ 表是 `as const` 只读数组，而 `ConfigField.options` 要的是可变数组：清单里写
 * `options: [...CALENDAR_STYLES]` 摊一次。直接赋值红在 TS4104，且只有 `vue-tsc`
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
 * 两档铺法，读的是同一批「一天一个数」，只在把哪两件事摆成坐标上分叉。
 * ⚠ `calendar` 按周铺（横轴是周、纵轴是星期几），看的是「周中还是周末出的事」；
 * `matrix` 按月铺（横轴是几号、纵轴是年月），看的是「每个月的同一天是不是都这样」。
 * 换档只换坐标，不换任何一个读数。
 */
export const CALENDAR_STYLES = [
  { value: 'calendar', label: '日历' },
  { value: 'matrix', label: '月 × 日矩阵' },
] as const satisfies readonly ConfigOption[]

export type CalendarStyle = (typeof CALENDAR_STYLES)[number]['value']
export const CALENDAR_STYLE_VALUES = valuesOf(CALENDAR_STYLES)

/**
 * 色阶两档。
 * ⚠ `diverging` 只在读数**本身有正负两个方向**时才对（偏差、同比增减）；拿它画
 * 单调递增的能耗，中间那一档颜色会把「中位数」误读成「基准线」。
 */
export const COLOR_SCALES = [
  { value: 'sequential', label: '顺序（低 → 高）' },
  { value: 'diverging', label: '发散（负 → 中 → 正）' },
] as const satisfies readonly ConfigOption[]

export type ColorScale = (typeof COLOR_SCALES)[number]['value']
export const COLOR_SCALE_VALUES = valuesOf(COLOR_SCALES)

/**
 * 一天之内那几百上千个采样归并成一个数的算法。
 * ⚠ 档位不是装饰：电量这类累积量要 `sum` 或 `max`，温度这类瞬时量要 `avg`——
 * 拿平均去读一条累积曲线会画出一张整体偏低的假图，而每一个数本身完全合法。
 */
export const DAY_AGGREGATES = [
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '平均' },
  { value: 'max', label: '最大' },
  { value: 'min', label: '最小' },
  { value: 'last', label: '末值' },
] as const satisfies readonly ConfigOption[]

export type DayAggregate = (typeof DAY_AGGREGATES)[number]['value']
export const DAY_AGGREGATE_VALUES = valuesOf(DAY_AGGREGATES)

/** 逐日归并的缺省档，与清单里那一项的 `default` 共用这一个常量。 */
export const DAY_AGGREGATE_DEFAULT: DayAggregate = 'sum'

/** 格与格之间那道缝，按像素给。 */
export const CELL_GAP_MIN = 0
export const CELL_GAP_MAX = 6
export const CELL_GAP_DEFAULT = 1

/**
 * 一块里最多摆几张日历。
 * ⚠ 上限不是随手定的：多摆一张，每张的高度就少一份，第五张起一格只剩一两个像素，
 * 看得见颜色但读不出是哪一天。要更多指标请再放一块。
 */
export const MAX_METRICS = 4

/** 整块缺省小数位，与逐张那一项的 help 同口径。 */
export const DEFAULT_PRECISION = 2
