/**
 * @fileoverview pie-chart 的取值表：图表样式与中心读数两组枚举，外加内外半径的可配区间。
 * 清单的下拉与取值层的白名单共用这一份。
 * ⚠ 各抄一份的话，加一档必然有一边漏，表现是面板能选、渲染静默回落缺省档——
 * 「选了没反应」最常见的来源。
 * ⚠ 表是 `as const` 只读数组，而 `ConfigField.options` 要的是可变数组：清单里写
 * `options: [...PIE_STYLES]` 摊一次。直接赋值红在 TS4104，且只有 `vue-tsc` 看得见——
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
 * 三档几何，共用「占比 → 圆心角」这条链，只在半径与半径映射上分叉。
 * ⚠ `rose` 把占比同时映射到圆心角与半径，视觉上会放大小片；它适合「谁最大」
 * 一眼可见的场合，不适合逐片读数——两个片的面积比不再等于它们的占比。
 */
export const PIE_STYLES = [
  { value: 'pie', label: '实心饼' },
  { value: 'donut', label: '环形' },
  { value: 'rose', label: '玫瑰' },
] as const satisfies readonly ConfigOption[]

export type PieStyle = (typeof PIE_STYLES)[number]['value']
export const PIE_STYLE_VALUES = valuesOf(PIE_STYLES)

/**
 * 环心那个读数从哪儿来。
 * ⚠ 四档都是从**当前可画的那几片**派生的，不是第二个绑定槽：多一个槽会让
 * 「配了 6 片先接 2 片」这种常态被判成 unbound 并盖上整格浮层。
 */
export const PIE_CENTER_TEXTS = [
  { value: 'none', label: '不显示' },
  { value: 'sum', label: '合计' },
  { value: 'max', label: '最大片' },
  { value: 'count', label: '片数' },
] as const satisfies readonly ConfigOption[]

export type PieCenterText = (typeof PIE_CENTER_TEXTS)[number]['value']
export const PIE_CENTER_TEXT_VALUES = valuesOf(PIE_CENTER_TEXTS)

/** 环心读数下面那一行小字，与档位一一对应。 */
export const PIE_CENTER_LABELS: Record<
  Exclude<PieCenterText, 'none'>,
  string
> = {
  sum: '合计',
  max: '最大',
  count: '片数',
}

/** 半径按绘图区短边的百分比给，两个旋钮共用这一档区间。 */
export const PIE_RADIUS_MIN = 0
export const PIE_RADIUS_MAX = 100

/** 外半径缺省：留出四周的数据标签与引线。 */
export const PIE_OUTER_RADIUS_DEFAULT = 66

/** 内半径缺省，只有环形与玫瑰吃它。 */
export const PIE_INNER_RADIUS_DEFAULT = 45

/**
 * 环的最小宽度（百分点）。
 * ⚠ 内半径填得不小于外半径时整条环带宽度为 0，屏上一片空白且零报错；
 * 与其画不出来，不如把内半径压到留得下这一档宽度的位置。
 */
export const PIE_MIN_RING = 6
