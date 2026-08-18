/**
 * @fileoverview 按钮控件的取值表：风格、语义色、形状、图标、排布与动效各一组。
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

/** 底色与描边的四种组合，外加一档大屏专用的科技风。 */
export const BUTTON_VARIANTS = [
  { value: 'solid', label: '实心' },
  { value: 'soft', label: '柔和' },
  { value: 'outline', label: '描边' },
  { value: 'ghost', label: '幽灵' },
  { value: 'hud', label: '科技' },
] as const satisfies readonly ConfigOption[]

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]['value']
export const BUTTON_VARIANT_VALUES = valuesOf(BUTTON_VARIANTS)

/** 语义色。⚠ 一律取主题变量，换肤时整屏按钮跟着走。 */
export const BUTTON_TONES = [
  { value: 'primary', label: '主色' },
  { value: 'success', label: '正常' },
  { value: 'warning', label: '预警' },
  { value: 'danger', label: '危险' },
  { value: 'neutral', label: '中性' },
  { value: 'custom', label: '自定义' },
] as const satisfies readonly ConfigOption[]

export type ButtonTone = (typeof BUTTON_TONES)[number]['value']
export const BUTTON_TONE_VALUES = valuesOf(BUTTON_TONES)

/** 一档语义色的两个色：主色与压在主色上的文字色。 */
export interface ToneColors {
  accent: string
  /** 实心档压在主色底上的文字色，必须与 `accent` 有足够对比。 */
  on: string
}

/**
 * 语义色 → 两个主题变量。
 * ⚠ 预警档的文字色是深色而不是 `--text-on-emphasis`：黄底上的浅字读不出来，
 * 这一档与 DtButton 的口径逐字相同。
 */
export const BUTTON_TONE_COLORS: Record<
  Exclude<ButtonTone, 'custom'>,
  ToneColors
> = {
  primary: { accent: 'var(--accent-primary)', on: 'var(--text-on-emphasis)' },
  success: { accent: 'var(--state-success)', on: 'var(--text-on-emphasis)' },
  warning: { accent: 'var(--state-warning)', on: 'var(--text-inverse)' },
  danger: { accent: 'var(--state-danger)', on: 'var(--text-on-emphasis)' },
  neutral: { accent: 'var(--text-secondary)', on: 'var(--text-inverse)' },
}

/** 轮廓形状。`cut` 是斜切角，大屏上最常配「科技」风格。 */
export const BUTTON_SHAPES = [
  { value: 'rounded', label: '圆角' },
  { value: 'pill', label: '胶囊' },
  { value: 'sharp', label: '直角' },
  { value: 'cut', label: '切角' },
] as const satisfies readonly ConfigOption[]

export type ButtonShape = (typeof BUTTON_SHAPES)[number]['value']
export const BUTTON_SHAPE_VALUES = valuesOf(BUTTON_SHAPES)

/** 图标摆在文字的哪一侧。 */
export const BUTTON_ICON_POSITIONS = [
  { value: 'left', label: '文字左' },
  { value: 'right', label: '文字右' },
  { value: 'top', label: '文字上' },
] as const satisfies readonly ConfigOption[]

export type ButtonIconPosition = (typeof BUTTON_ICON_POSITIONS)[number]['value']
export const BUTTON_ICON_POSITION_VALUES = valuesOf(BUTTON_ICON_POSITIONS)

/** 按钮占满整个模块矩形，还是按内容收缩后摆在矩形里。 */
export const BUTTON_SIZINGS = [
  { value: 'fill', label: '充满模块' },
  { value: 'auto', label: '按内容' },
] as const satisfies readonly ConfigOption[]

export type ButtonSizing = (typeof BUTTON_SIZINGS)[number]['value']
export const BUTTON_SIZING_VALUES = valuesOf(BUTTON_SIZINGS)

/** 悬停反馈。触摸屏上只有「按下」那一档看得到，故两档分开配。 */
export const BUTTON_HOVERS = [
  { value: 'none', label: '无' },
  { value: 'brighten', label: '提亮' },
  { value: 'lift', label: '上浮' },
  { value: 'glow', label: '辉光' },
  { value: 'sweep', label: '扫光' },
] as const satisfies readonly ConfigOption[]

export type ButtonHover = (typeof BUTTON_HOVERS)[number]['value']
export const BUTTON_HOVER_VALUES = valuesOf(BUTTON_HOVERS)

/** 按下反馈。 */
export const BUTTON_PRESSES = [
  { value: 'none', label: '无' },
  { value: 'sink', label: '下沉' },
  { value: 'shrink', label: '缩小' },
] as const satisfies readonly ConfigOption[]

export type ButtonPress = (typeof BUTTON_PRESSES)[number]['value']
export const BUTTON_PRESS_VALUES = valuesOf(BUTTON_PRESSES)

/** 按内容尺寸时，按钮落在模块矩形的哪一处。 */
export const BUTTON_ALIGNS = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
] as const satisfies readonly ConfigOption[]

export type ButtonAlign = (typeof BUTTON_ALIGNS)[number]['value']
export const BUTTON_ALIGN_VALUES = valuesOf(BUTTON_ALIGNS)

export const BUTTON_VALIGNS = [
  { value: 'top', label: '上' },
  { value: 'center', label: '中' },
  { value: 'bottom', label: '下' },
] as const satisfies readonly ConfigOption[]

export type ButtonVAlign = (typeof BUTTON_VALIGNS)[number]['value']
export const BUTTON_VALIGN_VALUES = valuesOf(BUTTON_VALIGNS)

/**
 * 图标选项：值是 DtIcon 注册表里的名字。
 * ⚠ 只列已登记的名字，不给一个能自由填的框：DtIcon 遇到没登记的名字
 * **不报错也不渲染**，自由填的结果是「配了图标但那一格永远空着」。
 * 空串是「不要图标」，排在第一档。
 */
export const BUTTON_ICONS = [
  { value: '', label: '无' },
  { value: 'arrow-right', label: '箭头' },
  { value: 'chevron-right', label: '右尖角' },
  { value: 'chevron-left', label: '左尖角' },
  { value: 'home', label: '首页' },
  { value: 'route', label: '路线' },
  { value: 'layers', label: '图层' },
  { value: 'layout-grid', label: '宫格' },
  { value: 'table', label: '表格' },
  { value: 'chart-line', label: '折线图' },
  { value: 'chart-column', label: '柱状图' },
  { value: 'chart-pie', label: '饼图' },
  { value: 'gauge', label: '仪表' },
  { value: 'activity', label: '波形' },
  { value: 'trending-up', label: '趋势' },
  { value: 'building', label: '楼栋' },
  { value: 'server', label: '机柜' },
  { value: 'database', label: '数据库' },
  { value: 'network', label: '拓扑' },
  { value: 'power', label: '电源' },
  { value: 'power-off', label: '停机' },
  { value: 'snowflake', label: '制冷' },
  { value: 'sun', label: '光照' },
  { value: 'play', label: '播放' },
  { value: 'refresh-cw', label: '刷新' },
  { value: 'search', label: '查询' },
  { value: 'settings', label: '设置' },
  { value: 'alert-triangle', label: '告警' },
  { value: 'shield', label: '安防' },
  { value: 'eye', label: '查看' },
  { value: 'download', label: '下载' },
  { value: 'share', label: '分享' },
  { value: 'calendar', label: '日期' },
  { value: 'users', label: '人员' },
  { value: 'check', label: '确认' },
  { value: 'close', label: '关闭' },
] as const satisfies readonly ConfigOption[]

export type ButtonIcon = (typeof BUTTON_ICONS)[number]['value']
export const BUTTON_ICON_VALUES = valuesOf(BUTTON_ICONS)
