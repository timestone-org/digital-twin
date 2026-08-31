/**
 * @fileoverview 页签栏的取值表：风格、语义色、轮廓、指示条、排布与动效各一组，
 * 外加每一格可选的图标菜单。
 * ⚠ 清单与渲染组件**共用这一份**。各抄一份的话，加一档必然有一边漏，
 * 表现是面板能选、渲染静默回落默认档——「选了没反应」最常见的来源。
 */
import type { ConfigOption } from '@dt/contracts'

/** 取值数组：`readEnum` 的白名单直接从选项表推，不再手抄一遍。 */
function valuesOf<T extends string>(
  options: readonly { value: T; label: string }[],
): readonly T[] {
  return options.map((option) => option.value)
}

/** 整条轨道与选中格的五种长相。 */
export const TABS_VARIANTS = [
  { value: 'track', label: '凹槽' },
  { value: 'underline', label: '页签' },
  { value: 'solid', label: '实心' },
  { value: 'hud', label: '科技' },
  { value: 'plain', label: '无底' },
] as const satisfies readonly ConfigOption[]

export type TabsVariant = (typeof TABS_VARIANTS)[number]['value']
export const TABS_VARIANT_VALUES = valuesOf(TABS_VARIANTS)

/** 语义色。⚠ 一律取主题变量，换肤时整屏页签跟着走。 */
export const TABS_TONES = [
  { value: 'primary', label: '主色' },
  { value: 'success', label: '正常' },
  { value: 'warning', label: '预警' },
  { value: 'danger', label: '危险' },
  { value: 'neutral', label: '中性' },
  { value: 'custom', label: '自定义' },
] as const satisfies readonly ConfigOption[]

export type TabsTone = (typeof TABS_TONES)[number]['value']
export const TABS_TONE_VALUES = valuesOf(TABS_TONES)

/** 一档语义色的两个色：主色与压在主色上的文字色。 */
export interface TabsToneColors {
  accent: string
  /** 实心档压在主色底上的文字色，必须与 `accent` 有足够对比。 */
  on: string
}

/**
 * 语义色 → 两个主题变量。
 * ⚠ 预警档的文字色是深色而不是 `--text-on-emphasis`：黄底上的浅字读不出来，
 * 这一档与 DtButton、action-button 的口径逐字相同。
 */
export const TABS_TONE_COLORS: Record<
  Exclude<TabsTone, 'custom'>,
  TabsToneColors
> = {
  primary: { accent: 'var(--accent-primary)', on: 'var(--text-on-emphasis)' },
  success: { accent: 'var(--state-success)', on: 'var(--text-on-emphasis)' },
  warning: { accent: 'var(--state-warning)', on: 'var(--text-inverse)' },
  danger: { accent: 'var(--state-danger)', on: 'var(--text-on-emphasis)' },
  neutral: { accent: 'var(--text-secondary)', on: 'var(--text-inverse)' },
}

/** 每一格的轮廓。`cut` 是斜切角，大屏上最常配「科技」风格。 */
export const TABS_SHAPES = [
  { value: 'rounded', label: '圆角' },
  { value: 'pill', label: '胶囊' },
  { value: 'sharp', label: '直角' },
  { value: 'cut', label: '切角' },
] as const satisfies readonly ConfigOption[]

export type TabsShape = (typeof TABS_SHAPES)[number]['value']
export const TABS_SHAPE_VALUES = valuesOf(TABS_SHAPES)

/** 选中格上那一道指示条画在哪。 */
export const TABS_INDICATORS = [
  { value: 'none', label: '无' },
  { value: 'bar', label: '底部横条' },
  { value: 'edge', label: '首侧竖条' },
] as const satisfies readonly ConfigOption[]

export type TabsIndicator = (typeof TABS_INDICATORS)[number]['value']
export const TABS_INDICATOR_VALUES = valuesOf(TABS_INDICATORS)

/** 横排还是竖排。竖排用来当左侧或右侧的一列导航。 */
export const TABS_ORIENTATIONS = [
  { value: 'row', label: '横排' },
  { value: 'column', label: '竖排' },
] as const satisfies readonly ConfigOption[]

export type TabsOrientation = (typeof TABS_ORIENTATIONS)[number]['value']
export const TABS_ORIENTATION_VALUES = valuesOf(TABS_ORIENTATIONS)

/** 轨道占满整个模块矩形，还是按内容收缩后摆在矩形里。 */
export const TABS_SIZINGS = [
  { value: 'fill', label: '充满模块' },
  { value: 'auto', label: '按内容' },
] as const satisfies readonly ConfigOption[]

export type TabsSizing = (typeof TABS_SIZINGS)[number]['value']
export const TABS_SIZING_VALUES = valuesOf(TABS_SIZINGS)

/** 悬停反馈。触摸屏上只有「按下」那一档看得到，故两档分开配。 */
export const TABS_HOVERS = [
  { value: 'none', label: '无' },
  { value: 'tint', label: '染色' },
  { value: 'brighten', label: '提亮' },
  { value: 'lift', label: '上浮' },
  { value: 'glow', label: '辉光' },
] as const satisfies readonly ConfigOption[]

export type TabsHover = (typeof TABS_HOVERS)[number]['value']
export const TABS_HOVER_VALUES = valuesOf(TABS_HOVERS)

/** 按下反馈。 */
export const TABS_PRESSES = [
  { value: 'none', label: '无' },
  { value: 'sink', label: '下沉' },
  { value: 'shrink', label: '缩小' },
] as const satisfies readonly ConfigOption[]

export type TabsPress = (typeof TABS_PRESSES)[number]['value']
export const TABS_PRESS_VALUES = valuesOf(TABS_PRESSES)

/** 一格之内，图标与文案靠哪一边。竖排导航一般靠左，横排一般居中。 */
export const TABS_ITEM_ALIGNS = [
  { value: 'center', label: '居中' },
  { value: 'left', label: '靠左' },
  { value: 'right', label: '靠右' },
] as const satisfies readonly ConfigOption[]

export type TabsItemAlign = (typeof TABS_ITEM_ALIGNS)[number]['value']
export const TABS_ITEM_ALIGN_VALUES = valuesOf(TABS_ITEM_ALIGNS)

/** 按内容尺寸时，轨道落在模块矩形的哪一处。 */
export const TABS_ALIGNS = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
] as const satisfies readonly ConfigOption[]

export type TabsAlign = (typeof TABS_ALIGNS)[number]['value']
export const TABS_ALIGN_VALUES = valuesOf(TABS_ALIGNS)

export const TABS_VALIGNS = [
  { value: 'top', label: '上' },
  { value: 'center', label: '中' },
  { value: 'bottom', label: '下' },
] as const satisfies readonly ConfigOption[]

export type TabsVAlign = (typeof TABS_VALIGNS)[number]['value']
export const TABS_VALIGN_VALUES = valuesOf(TABS_VALIGNS)

/**
 * 每一格可挂的图标：值是 DtIcon 注册表里的名字。
 * ⚠ 只列已登记的名字，不给一个能自由填的框：DtIcon 遇到没登记的名字
 * **不报错也不渲染**，自由填的结果是「配了图标但那一格永远空着」。
 * 空串是「不要图标」，排在第一档。
 */
export const TABS_ICONS = [
  { value: '', label: '无' },
  { value: 'layout-grid', label: '总览' },
  { value: 'home', label: '首页' },
  { value: 'chart-line', label: '折线图' },
  { value: 'chart-column', label: '柱状图' },
  { value: 'chart-pie', label: '饼图' },
  { value: 'gauge', label: '仪表' },
  { value: 'activity', label: '波形' },
  { value: 'trending-up', label: '趋势' },
  { value: 'table', label: '表格' },
  { value: 'layers', label: '图层' },
  { value: 'building', label: '楼栋' },
  { value: 'server', label: '机柜' },
  { value: 'database', label: '数据库' },
  { value: 'network', label: '拓扑' },
  { value: 'power', label: '电源' },
  { value: 'snowflake', label: '制冷' },
  { value: 'sun', label: '光照' },
  { value: 'wind', label: '风机' },
  { value: 'droplets', label: '水' },
  { value: 'recycle', label: '环保' },
  { value: 'shield', label: '安防' },
  { value: 'users', label: '人员' },
  { value: 'settings', label: '设置' },
  { value: 'route', label: '路线' },
  { value: 'alert-triangle', label: '告警' },
] as const satisfies readonly ConfigOption[]

export type TabsIcon = (typeof TABS_ICONS)[number]['value']
export const TABS_ICON_VALUES = valuesOf(TABS_ICONS)
