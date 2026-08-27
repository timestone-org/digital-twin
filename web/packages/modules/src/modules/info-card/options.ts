/**
 * @fileoverview info-card 的取值表：排布、格外壳、标签、数值、单位、图标、对比、告警各一组。
 * 每一档都对回参考仓 kpi-card / kpi-group / icon-kpi-group 三份源码，源码画不出来的档一个都不加。
 * ⚠ 清单与渲染**共用这一份**。各抄一份的话，加一档必然有一边漏，表现是面板能选、
 * 渲染静默回落默认档——「选了没反应」最常见的来源。
 * ⚠ 表是 `as const` 的只读数组，而 `ConfigField.options` 要的是可变数组：清单里写
 * `options: [...CARD_LAYOUTS]` 摊一次。直接赋值红在 TS4104，且只有 `vue-tsc` 看得见——
 * `vitest` 的 esbuild 不做类型检查，整包测试会在它红着的时候全绿。
 */
import type { ConfigOption } from '@dt/contracts'

import type { ThresholdLevel } from '../../shared/thresholds'

/** 取值数组：`readEnum` 的白名单直接从选项表推，不再手抄一遍。 */
function valuesOf<T extends string>(
  options: readonly { value: T; label: string }[],
): readonly T[] {
  return options.map((option) => option.value)
}

/** 三种排布容器。`auto` = 只有一项时大字居中、多项时按网格。 */
export const CARD_LAYOUTS = [
  { value: 'auto', label: '自动' },
  { value: 'single', label: '单格大字' },
  { value: 'grid', label: '网格' },
] as const satisfies readonly ConfigOption[]

export type CardLayout = (typeof CARD_LAYOUTS)[number]['value']
export const CARD_LAYOUT_VALUES = valuesOf(CARD_LAYOUTS)

/**
 * 网格列数，`auto` = 按最小列宽自适应铺满。
 * ⚠ 档值一律是**字符串**：`readEnum` 只认字面量相等，预设或脏配置里写 `columns: 2`
 * 判不中，静默回落 `'auto'`——墙上少了列数，两边都不报错。
 */
export const CARD_COLUMNS = [
  { value: 'auto', label: '自动' },
  { value: '1', label: '1 列' },
  { value: '2', label: '2 列' },
  { value: '3', label: '3 列' },
  { value: '4', label: '4 列' },
  { value: '5', label: '5 列' },
  { value: '6', label: '6 列' },
] as const satisfies readonly ConfigOption[]

export type CardColumns = (typeof CARD_COLUMNS)[number]['value']
export const CARD_COLUMN_VALUES = valuesOf(CARD_COLUMNS)

/** 一格的外壳。`accent` = 卡片再加一条左侧发光竖条。 */
export const CARD_CELL_SHELLS = [
  { value: 'plain', label: '裸排（无框）' },
  { value: 'card', label: '卡片' },
  { value: 'accent', label: '卡片 + 左色条' },
] as const satisfies readonly ConfigOption[]

export type CardCellShell = (typeof CARD_CELL_SHELLS)[number]['value']
export const CARD_CELL_SHELL_VALUES = valuesOf(CARD_CELL_SHELLS)

/**
 * 悬停反馈。
 * ⚠ 参考仓两个源不同款：kpi-group 的小卡是「描边转强调色 + 上浮 + 投影」，
 * icon-kpi-group 的格是「底色提亮 + 上浮」，且它的开关缺省是关的。收成三档后
 * `tint` 只提亮底色、`lift` 走上浮那一套，两档不叠加。
 */
export const CARD_HOVERS = [
  { value: 'none', label: '无' },
  { value: 'tint', label: '提亮' },
  { value: 'lift', label: '上浮' },
] as const satisfies readonly ConfigOption[]

export type CardHover = (typeof CARD_HOVERS)[number]['value']
export const CARD_HOVER_VALUES = valuesOf(CARD_HOVERS)

/** 格内横向对齐。⚠ 三档：右对齐是参考仓 kpi-card 的 `align` 白名单里就有的一档。 */
export const CARD_ALIGNS = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
] as const satisfies readonly ConfigOption[]

export type CardAlign = (typeof CARD_ALIGNS)[number]['value']
export const CARD_ALIGN_VALUES = valuesOf(CARD_ALIGNS)

/**
 * 标签相对读数的位置。
 * ⚠ 这一档只管摆在哪儿，不管显不显示：没有标签文字时整行不渲染，档位类名也不挂——
 * 挂了会多出一列空网格 + 一个列间距，读数偏移几像素，没人会把它当 bug 报上来。
 * ⚠ 没有「隐藏」这一档：参考仓 kpi-card 的三档就是上/下/左，要藏一格的标签把这一行的
 * `label` 留空即可，代价是绑点面板上这一行也跟着没了名字。
 */
export const CARD_LABEL_PLACES = [
  { value: 'above', label: '读数上方' },
  { value: 'below', label: '读数下方' },
  { value: 'left', label: '读数左侧' },
] as const satisfies readonly ConfigOption[]

export type CardLabelPlace = (typeof CARD_LABEL_PLACES)[number]['value']
export const CARD_LABEL_PLACE_VALUES = valuesOf(CARD_LABEL_PLACES)

/** 标签的文字层级。 */
export const CARD_LABEL_TONES = [
  { value: 'secondary', label: '次要' },
  { value: 'primary', label: '正文' },
  { value: 'title', label: '标题' },
  { value: 'muted', label: '弱化' },
] as const satisfies readonly ConfigOption[]

export type CardLabelTone = (typeof CARD_LABEL_TONES)[number]['value']
export const CARD_LABEL_TONE_VALUES = valuesOf(CARD_LABEL_TONES)

/** 文字层级 → 主题变量。 */
export const CARD_LABEL_TONE_COLORS: Record<CardLabelTone, string> = {
  secondary: 'var(--text-secondary)',
  primary: 'var(--text-primary)',
  title: 'var(--text-title)',
  muted: 'var(--text-disabled)',
}

/** 数值填充。渐变文字有三个前提，缺一即静默降级成纯色，见 MODULE_INFO_CARD_DESIGN §4.1。 */
export const CARD_VALUE_FILLS = [
  { value: 'solid', label: '纯色' },
  { value: 'gradient', label: '渐变文字' },
] as const satisfies readonly ConfigOption[]

export type CardValueFill = (typeof CARD_VALUE_FILLS)[number]['value']
export const CARD_VALUE_FILL_VALUES = valuesOf(CARD_VALUE_FILLS)

/** 读数用哪套字体。`digit` 是等宽数字体，读数逐帧跳动时列宽不抖。 */
export const CARD_VALUE_FONTS = [
  { value: 'digit', label: '数字字体' },
  { value: 'body', label: '正文字体' },
] as const satisfies readonly ConfigOption[]

export type CardValueFont = (typeof CARD_VALUE_FONTS)[number]['value']
export const CARD_VALUE_FONT_VALUES = valuesOf(CARD_VALUE_FONTS)

/**
 * 单位摆在哪儿：两档都与读数同基线，差的只是那一道小间隙。
 * ⚠ 只有这两档：参考仓三个模块的单位一律是基线对齐 + 3～5px 间隙，`attached` 是同一处
 * 去掉间隙（沿用 info-list 的同名档）。「独占一列」属于三列表，卡片里没有对应形态。
 */
export const CARD_UNIT_PLACES = [
  { value: 'baseline', label: '读数右侧' },
  { value: 'attached', label: '紧跟读数' },
] as const satisfies readonly ConfigOption[]

export type CardUnitPlace = (typeof CARD_UNIT_PLACES)[number]['value']
export const CARD_UNIT_PLACE_VALUES = valuesOf(CARD_UNIT_PLACES)

/** 单位的文字层级，四档与参考仓 kpi-card 的 `unitTone` 逐档对应。 */
export const CARD_UNIT_TONES = [
  { value: 'secondary', label: '次要' },
  { value: 'muted', label: '弱化' },
  { value: 'primary', label: '正文' },
  { value: 'accent', label: '跟随数值色' },
] as const satisfies readonly ConfigOption[]

export type CardUnitTone = (typeof CARD_UNIT_TONES)[number]['value']
export const CARD_UNIT_TONE_VALUES = valuesOf(CARD_UNIT_TONES)

/**
 * 单位层级 → 主题变量。
 * ⚠ `accent` 是空串而不是某个 token：它跟的是这一格算出来的数值色（含命中规则后的告警色），
 * 没有静态 token 表达得了，由取值层拿空串当哨兵、顶上那一格的数值色。填个 token 进来，
 * 单位就不再跟着告警变色了。
 */
export const CARD_UNIT_TONE_COLORS: Record<CardUnitTone, string> = {
  secondary: 'var(--text-secondary)',
  muted: 'var(--text-disabled)',
  primary: 'var(--text-primary)',
  accent: '',
}

/**
 * 图标怎么画。`corner` 是钉在右上角的小角标，`badge` 是带渐变底与描边的图标容器。
 * ⚠ 两档到头（加上不画共三档）：参考仓 kpi-card 的角标与 icon-kpi-group 的圆容器就是全部，
 * 后者在缺底色时也不退化成裸图标——没有第三种画法可抄。
 */
export const CARD_ICON_MODES = [
  { value: 'none', label: '不画' },
  { value: 'corner', label: '右上角标' },
  { value: 'badge', label: '图标容器' },
] as const satisfies readonly ConfigOption[]

export type CardIconMode = (typeof CARD_ICON_MODES)[number]['value']
export const CARD_ICON_MODE_VALUES = valuesOf(CARD_ICON_MODES)

/** 图标容器摆在文字的哪一侧。⚠ `corner` 档钉死在右上角，不看这一档。 */
export const CARD_ICON_POSITIONS = [
  { value: 'left', label: '文字左侧' },
  { value: 'top', label: '文字上方' },
] as const satisfies readonly ConfigOption[]

export type CardIconPosition = (typeof CARD_ICON_POSITIONS)[number]['value']
export const CARD_ICON_POSITION_VALUES = valuesOf(CARD_ICON_POSITIONS)

/** 图标容器的形状。 */
export const CARD_ICON_SHAPES = [
  { value: 'circle', label: '正圆' },
  { value: 'rounded', label: '圆角方' },
  { value: 'square', label: '直角方' },
] as const satisfies readonly ConfigOption[]

export type CardIconShape = (typeof CARD_ICON_SHAPES)[number]['value']
export const CARD_ICON_SHAPE_VALUES = valuesOf(CARD_ICON_SHAPES)

/** 形状 → 圆角值。圆角方走卡片圆角 token，与整块卡片同一套圆角语言。 */
export const CARD_ICON_RADII: Record<CardIconShape, string> = {
  circle: '50%',
  rounded: 'var(--radius-md)',
  square: '0',
}

/** 涨跌块显示什么。⚠ `percent` 档基数为 0 时回退显绝对差值，不留空。 */
export const CARD_COMPARE_MODES = [
  { value: 'percent', label: '百分比' },
  { value: 'delta', label: '绝对差值' },
  { value: 'both', label: '差值 + 百分比' },
] as const satisfies readonly ConfigOption[]

export type CardCompareMode = (typeof CARD_COMPARE_MODES)[number]['value']
export const CARD_COMPARE_MODE_VALUES = valuesOf(CARD_COMPARE_MODES)

/** 状态点。⚠ `auto` 只在命中规则时画点：没有判据就连「正常」都不该说。 */
export const CARD_STATUS_DOTS = [
  { value: 'none', label: '不画' },
  { value: 'auto', label: '命中规则时' },
] as const satisfies readonly ConfigOption[]

export type CardStatusDot = (typeof CARD_STATUS_DOTS)[number]['value']
export const CARD_STATUS_DOT_VALUES = valuesOf(CARD_STATUS_DOTS)

/**
 * 一格的值按哪种类型解读，三档与本仓 metric-card 的 `kind` 逐字相同。
 * ⚠ 只有 `number` 评估规则：文本与开关量命中不了阈值，也就没有告警色。
 */
export const CARD_VALUE_KINDS = [
  { value: 'number', label: '数值' },
  { value: 'boolean', label: '开关量' },
  { value: 'text', label: '文本' },
] as const satisfies readonly ConfigOption[]

export type CardValueKind = (typeof CARD_VALUE_KINDS)[number]['value']
export const CARD_VALUE_KIND_VALUES = valuesOf(CARD_VALUE_KINDS)

/**
 * 严重度的四个中文词——状态点自己没有文字，靠它给出无障碍名与悬停提示。
 * ⚠ 不复用 `shared/thresholds.ts` 的 `LEVEL_OPTIONS`：那是属性面板的下拉项，
 * label 写成「危险（红）」，念出来就是一个带括注的词。两份词表并存，
 * 改任何一份都不该顺手同步另一份。
 */
export const LEVEL_TEXT: Record<ThresholdLevel, string> = {
  normal: '正常',
  info: '提示',
  warning: '警告',
  danger: '危急',
}
