/**
 * @fileoverview info-list 的取值表：行排版、行外壳、段位件、徽章、进度件、筛选与排序各一组。
 * ⚠ 清单与渲染**共用这一份**。各抄一份的话，加一档必然有一边漏，表现是面板能选、
 * 渲染静默回落默认档——「选了没反应」最常见的来源。
 */
import type { ConfigOption } from '@dt/contracts'

import type { ThresholdLevel } from '../../shared/thresholds'

/** 取值数组：`readEnum` 的白名单直接从选项表推，不再手抄一遍。 */
function valuesOf<T extends string>(
  options: readonly { value: T; label: string }[],
): readonly T[] {
  return options.map((option) => option.value)
}

/** 行的两条排版路：声明式段位，或名称/数值/单位三列对齐。 */
export const LIST_ROW_LAYOUTS = [
  { value: 'stack', label: '段位编排' },
  { value: 'columns', label: '三列对齐' },
] as const satisfies readonly ConfigOption[]

export type ListRowLayout = (typeof LIST_ROW_LAYOUTS)[number]['value']
export const LIST_ROW_LAYOUT_VALUES = valuesOf(LIST_ROW_LAYOUTS)

/** 行外壳。告警态是叠在它之上的一层修饰，不是第六档。 */
export const LIST_ROW_SHELLS = [
  { value: 'plain', label: '无' },
  { value: 'divider', label: '分隔线' },
  { value: 'card', label: '卡片' },
  { value: 'accent', label: '卡片 + 左色条' },
  { value: 'edge', label: '左色边 + 底纹' },
] as const satisfies readonly ConfigOption[]

export type ListRowShell = (typeof LIST_ROW_SHELLS)[number]['value']
export const LIST_ROW_SHELL_VALUES = valuesOf(LIST_ROW_SHELLS)

/** 分隔线的线型。 */
export const LIST_DIVIDER_STYLES = [
  { value: 'dotted', label: '点线' },
  { value: 'dashed', label: '虚线' },
  { value: 'solid', label: '实线' },
  { value: 'none', label: '无' },
] as const satisfies readonly ConfigOption[]

export type ListDividerStyle = (typeof LIST_DIVIDER_STYLES)[number]['value']
export const LIST_DIVIDER_STYLE_VALUES = valuesOf(LIST_DIVIDER_STYLES)

/** 悬停反馈。 */
export const LIST_HOVERS = [
  { value: 'none', label: '无' },
  { value: 'tint', label: '提亮' },
  { value: 'lift', label: '上浮' },
] as const satisfies readonly ConfigOption[]

export type ListHover = (typeof LIST_HOVERS)[number]['value']
export const LIST_HOVER_VALUES = valuesOf(LIST_HOVERS)

/** 分组形态。分组键是行内的自由字符串 `group`。 */
export const LIST_GROUPINGS = [
  { value: 'none', label: '不分组' },
  { value: 'section', label: '分段组头' },
  { value: 'tabs', label: '分类页签' },
] as const satisfies readonly ConfigOption[]

export type ListGrouping = (typeof LIST_GROUPINGS)[number]['value']
export const LIST_GROUPING_VALUES = valuesOf(LIST_GROUPINGS)

/** 行名的文字层级。 */
export const LIST_LABEL_TONES = [
  { value: 'secondary', label: '次要' },
  { value: 'primary', label: '正文' },
  { value: 'title', label: '标题' },
  { value: 'muted', label: '弱化' },
] as const satisfies readonly ConfigOption[]

export type ListLabelTone = (typeof LIST_LABEL_TONES)[number]['value']
export const LIST_LABEL_TONE_VALUES = valuesOf(LIST_LABEL_TONES)

/** 文字层级 → 主题变量。 */
export const LIST_LABEL_TONE_COLORS: Record<ListLabelTone, string> = {
  secondary: 'var(--text-secondary)',
  primary: 'var(--text-primary)',
  title: 'var(--text-title)',
  muted: 'var(--text-disabled)',
}

/** 单位摆在哪儿。`column` 只在三列对齐档有意义。 */
export const LIST_UNIT_PLACES = [
  { value: 'attached', label: '紧跟读数' },
  { value: 'baseline', label: '读数右侧' },
  { value: 'column', label: '独占一列' },
] as const satisfies readonly ConfigOption[]

export type ListUnitPlace = (typeof LIST_UNIT_PLACES)[number]['value']
export const LIST_UNIT_PLACE_VALUES = valuesOf(LIST_UNIT_PLACES)

/** 副读数取哪一路。三个副读数槽各自独立，见 MODULE_INFO_CARD_DESIGN §2.1。 */
export const LIST_SUB_SOURCES = [
  { value: 'aux', label: '副读数 1' },
  { value: 'aux2', label: '副读数 2' },
  { value: 'aux3', label: '副读数 3' },
  { value: 'target', label: '行内目标值' },
  { value: 'text', label: '绑定文本' },
] as const satisfies readonly ConfigOption[]

export type ListSubSource = (typeof LIST_SUB_SOURCES)[number]['value']
export const LIST_SUB_SOURCE_VALUES = valuesOf(LIST_SUB_SOURCES)

/** 徽章画什么。`severity` 与 `rule` 是两个不同的词，不能合成一档。 */
export const LIST_BADGE_KINDS = [
  { value: 'none', label: '不画' },
  { value: 'device', label: '设备状态' },
  { value: 'severity', label: '严重度' },
  { value: 'rule', label: '命中规则' },
] as const satisfies readonly ConfigOption[]

export type ListBadgeKind = (typeof LIST_BADGE_KINDS)[number]['value']
export const LIST_BADGE_KIND_VALUES = valuesOf(LIST_BADGE_KINDS)

/** 徽章样式。⚠ `device` 档直接渲染 StatusBadge，这一档对它不作用。 */
export const LIST_BADGE_STYLES = [
  { value: 'outline', label: '描边' },
  { value: 'solid', label: '实心' },
  { value: 'dot', label: '圆点' },
] as const satisfies readonly ConfigOption[]

export type ListBadgeStyle = (typeof LIST_BADGE_STYLES)[number]['value']
export const LIST_BADGE_STYLE_VALUES = valuesOf(LIST_BADGE_STYLES)

/** 进度件形态。 */
export const LIST_METER_KINDS = [
  { value: 'none', label: '不画' },
  { value: 'bar', label: '进度条' },
] as const satisfies readonly ConfigOption[]

export type ListMeterKind = (typeof LIST_METER_KINDS)[number]['value']
export const LIST_METER_KIND_VALUES = valuesOf(LIST_METER_KINDS)

/** 进度件取哪一路百分比。 */
export const LIST_METER_SOURCES = [
  { value: 'range', label: '量程占比' },
  { value: 'share', label: '全表占比' },
  { value: 'aux', label: '副读数 1' },
  { value: 'aux2', label: '副读数 2' },
  { value: 'aux3', label: '副读数 3' },
] as const satisfies readonly ConfigOption[]

export type ListMeterSource = (typeof LIST_METER_SOURCES)[number]['value']
export const LIST_METER_SOURCE_VALUES = valuesOf(LIST_METER_SOURCES)

/** 第二条进度件的取值路，比第一条多一个「不画」。 */
export const LIST_METER_SOURCE2S = [
  { value: 'none', label: '不画第二条' },
  ...LIST_METER_SOURCES,
] as const satisfies readonly ConfigOption[]

export type ListMeterSource2 = (typeof LIST_METER_SOURCE2S)[number]['value']
export const LIST_METER_SOURCE2_VALUES = valuesOf(LIST_METER_SOURCE2S)

/** 规则判的是哪一个读数。 */
export const LIST_ALARM_ONS = [
  { value: 'value', label: '主读数' },
  { value: 'sub', label: '副读数' },
] as const satisfies readonly ConfigOption[]

export type ListAlarmOn = (typeof LIST_ALARM_ONS)[number]['value']
export const LIST_ALARM_ON_VALUES = valuesOf(LIST_ALARM_ONS)

/** 显示哪些行。`hit` 与 `alarm` 的差就是「正常也算命中」这一条。 */
export const LIST_ROW_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'hit', label: '命中规则' },
  { value: 'alarm', label: '只看告警' },
] as const satisfies readonly ConfigOption[]

export type ListRowFilter = (typeof LIST_ROW_FILTERS)[number]['value']
export const LIST_ROW_FILTER_VALUES = valuesOf(LIST_ROW_FILTERS)

/** 行序。 */
export const LIST_ROW_SORTS = [
  { value: 'docOrder', label: '配置顺序' },
  { value: 'severity', label: '严重度降序' },
] as const satisfies readonly ConfigOption[]

export type ListRowSort = (typeof LIST_ROW_SORTS)[number]['value']
export const LIST_ROW_SORT_VALUES = valuesOf(LIST_ROW_SORTS)

/** 时刻那一列显示的是什么时刻。三档语义不同，见 MODULE_INFO_CARD_DESIGN §2.5。 */
export const LIST_TIME_SOURCES = [
  { value: 'sample', label: '采样时刻' },
  { value: 'alarmSince', label: '告警起始时刻' },
  { value: 'bound', label: '绑定文本' },
] as const satisfies readonly ConfigOption[]

export type ListTimeSource = (typeof LIST_TIME_SOURCES)[number]['value']
export const LIST_TIME_SOURCE_VALUES = valuesOf(LIST_TIME_SOURCES)

/** 前导列只收这三档：一张通用件表会让「把长描述塞进 24px 宽的列」配得出来。 */
export const LIST_LEADS = [
  { value: 'none', label: '无' },
  { value: 'icon', label: '图标' },
  { value: 'badge', label: '徽章' },
] as const satisfies readonly ConfigOption[]

export type ListLead = (typeof LIST_LEADS)[number]['value']
export const LIST_LEAD_VALUES = valuesOf(LIST_LEADS)

/** 尾列只收这几档，理由同 `LIST_LEADS`。 */
export const LIST_TAILS = [
  { value: 'none', label: '无' },
  { value: 'value', label: '主读数' },
  { value: 'sub', label: '副读数' },
  { value: 'badge', label: '徽章' },
  { value: 'time', label: '时刻' },
] as const satisfies readonly ConfigOption[]

export type ListTail = (typeof LIST_TAILS)[number]['value']
export const LIST_TAIL_VALUES = valuesOf(LIST_TAILS)

/** 能放进行内段位的件。 */
export const LIST_SEGMENTS = [
  { value: 'none', label: '空' },
  { value: 'label', label: '行名' },
  { value: 'value', label: '主读数' },
  { value: 'sub', label: '副读数' },
  { value: 'badge', label: '徽章' },
  { value: 'tag', label: '分类标签' },
  { value: 'meter', label: '进度件 1' },
  { value: 'meter2', label: '进度件 2' },
  { value: 'alarmText', label: '命中文案' },
  { value: 'desc', label: '描述' },
  { value: 'time', label: '时刻' },
] as const satisfies readonly ConfigOption[]

export type ListSegment = (typeof LIST_SEGMENTS)[number]['value']
export const LIST_SEGMENT_VALUES = valuesOf(LIST_SEGMENTS)

/**
 * 严重度画到徽章上的四个词。
 * ⚠ 不复用 `shared/thresholds.ts` 的 `LEVEL_OPTIONS`：那是属性面板的下拉项，
 * label 写成「危险（红）」，画到徽章上就是一个带括注的词。
 */
export const LEVEL_TEXT: Record<ThresholdLevel, string> = {
  normal: '正常',
  info: '提示',
  warning: '警告',
  danger: '危急',
}
