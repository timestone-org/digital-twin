/**
 * @fileoverview data-table 的取值表：列键、对齐、密度、网格线、行名文字层级，
 * 以及值规则挑列的那一档。清单的下拉与取值层的白名单共用这一份。
 * ⚠ 各抄一份的话，加一档必然有一边漏，表现是面板能选、渲染静默回落缺省档——
 * 「选了没反应」最常见的来源。
 * ⚠ 表是 `as const` 只读数组，而 `ConfigField.options` 要的是可变数组：清单里写
 * `options: [...TABLE_ALIGNS]` 摊一次。直接赋值红在 TS4104，且只有 `vue-tsc` 看得见——
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
 * 八个固定列键。
 * ⚠ 列数不能跟着配置走：`BindingSpec.arrayFields` 是清单里的**静态**声明，
 * 读不到某个节点的 config。于是列固定八个子槽，没在「列」里启用的那几个不渲染
 * ——取舍写在 docs/MODULE_DATA_TABLE_DESIGN.md §3。
 * ⚠ 键是绑定 `fieldKey` 的一半（`cellValues[3].c2`）：改这里的字面量等于让存量
 * 大屏那一列的绑定全部失联。
 */
export const TABLE_COLUMN_KEYS = [
  { value: 'c1', label: '列 1' },
  { value: 'c2', label: '列 2' },
  { value: 'c3', label: '列 3' },
  { value: 'c4', label: '列 4' },
  { value: 'c5', label: '列 5' },
  { value: 'c6', label: '列 6' },
  { value: 'c7', label: '列 7' },
  { value: 'c8', label: '列 8' },
] as const satisfies readonly ConfigOption[]

export type TableColumnKey = (typeof TABLE_COLUMN_KEYS)[number]['value']
export const TABLE_COLUMN_KEY_VALUES = valuesOf(TABLE_COLUMN_KEYS)

/**
 * 每一行的第一个子槽。
 * ⚠ 绑点面板按「该行**第一个**子槽的 fieldKey」查行名（`bindingReport.ts`），
 * 而第一个子槽是清单里 `arrayFields[0]`，与用户启用了哪几列无关。
 */
export const TABLE_FIRST_COLUMN_KEY: TableColumnKey = TABLE_COLUMN_KEYS[0].value

/**
 * 值规则管哪一列。空串 = 全部列。
 * ⚠ 一张表里各列的量纲互不相干（温度、电量、达标率），一条 `> 80` 套到所有列上
 * 就是给别的列乱上色。故规则默认挑一列。
 */
export const TABLE_RULE_COLUMNS = [
  { value: '', label: '全部列' },
  ...TABLE_COLUMN_KEYS,
] as const satisfies readonly ConfigOption[]

export type TableRuleColumn = (typeof TABLE_RULE_COLUMNS)[number]['value']
export const TABLE_RULE_COLUMN_VALUES = valuesOf(TABLE_RULE_COLUMNS)

/** 单元格的水平对齐。 */
export const TABLE_ALIGNS = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
] as const satisfies readonly ConfigOption[]

export type TableAlign = (typeof TABLE_ALIGNS)[number]['value']
export const TABLE_ALIGN_VALUES = valuesOf(TABLE_ALIGNS)

/** 行高档位：一屏塞得下多少行由它决定。 */
export const TABLE_DENSITIES = [
  { value: 'compact', label: '紧凑' },
  { value: 'normal', label: '标准' },
  { value: 'loose', label: '宽松' },
] as const satisfies readonly ConfigOption[]

export type TableDensity = (typeof TABLE_DENSITIES)[number]['value']
export const TABLE_DENSITY_VALUES = valuesOf(TABLE_DENSITIES)

/** 每一档行高对应的上下内边距（px）。 */
export const TABLE_DENSITY_PAD: Record<TableDensity, number> = {
  compact: 3,
  normal: 7,
  loose: 12,
}

/** 网格线画到哪一步。 */
export const TABLE_GRID_LINES = [
  { value: 'none', label: '无' },
  { value: 'horizontal', label: '仅横线' },
  { value: 'both', label: '横竖都画' },
] as const satisfies readonly ConfigOption[]

export type TableGridLine = (typeof TABLE_GRID_LINES)[number]['value']
export const TABLE_GRID_LINE_VALUES = valuesOf(TABLE_GRID_LINES)

/** 行名与表头的文字层级。 */
export const TABLE_TONES = [
  { value: 'secondary', label: '次要' },
  { value: 'primary', label: '正文' },
  { value: 'title', label: '标题' },
  { value: 'muted', label: '弱化' },
] as const satisfies readonly ConfigOption[]

export type TableTone = (typeof TABLE_TONES)[number]['value']
export const TABLE_TONE_VALUES = valuesOf(TABLE_TONES)

/** 文字层级 → 主题变量；换肤时跟着走。 */
export const TABLE_TONE_COLORS: Record<TableTone, string> = {
  secondary: 'var(--text-secondary)',
  primary: 'var(--text-primary)',
  title: 'var(--text-title)',
  muted: 'var(--text-disabled)',
}

/** 字号可配区间，面板与渲染侧共用；`0` 字号会让整张表彻底看不见。 */
export const TABLE_FONT_MIN = 8
export const TABLE_FONT_MAX = 48

/** 列宽上界（px）。`0` = 不定宽，跟其余不定宽的列分剩下的地方。 */
export const TABLE_WIDTH_MAX = 480

/** 小数位可配区间；越界会让 `toLocaleString` 抛 RangeError。 */
export const TABLE_PRECISION_MAX = 6

/** 行数上限的可配区间；`0` = 不限。 */
export const TABLE_MAX_ROWS_CAP = 500
