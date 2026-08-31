/**
 * @fileoverview 页签栏的配置 → 形态：一次读完 config，收成一份 `TabsSpec`
 * （每一格的文案与联动值、类名、CSS 变量、外层排布）。纯函数，渲染组件只摆模板。
 * ⚠ 数值一律夹到清单声明的范围：`min` / `max` 只约束属性面板，脏配置里的
 * `-8` 会让整条 CSS 声明被浏览器丢掉，而 `0` 字号会让整条轨道彻底看不见。
 */
import type { CSSProperties } from 'vue'

import {
  readArray,
  readBoolean,
  readEnum,
  readNumber,
  readRecord,
  readText,
  readTrimmedText,
} from '../../shared/config'
import {
  TABS_ALIGN_VALUES,
  TABS_HOVER_VALUES,
  TABS_ICON_VALUES,
  TABS_INDICATOR_VALUES,
  TABS_ITEM_ALIGN_VALUES,
  TABS_ORIENTATION_VALUES,
  TABS_PRESS_VALUES,
  TABS_SHAPE_VALUES,
  TABS_SIZING_VALUES,
  TABS_TONE_COLORS,
  TABS_TONE_VALUES,
  TABS_VALIGN_VALUES,
  TABS_VARIANT_VALUES,
  type TabsShape,
  type TabsToneColors,
} from './options'

/** 一格都没配时的占位文案：脱开运行时单独挂载也该看到一条像样的轨道。 */
export const TABS_ITEM_LABEL_DEFAULT = '页签'

/** 胶囊档的圆角：比任何可能的高度都大，浏览器自己夹到半高。 */
const PILL_RADIUS_PX = 999

/** 图标字号的哨兵 0 = 跟着文字走，取字号的这个倍数。 */
const ICON_TO_FONT_RATIO = 1.1

/** 「默认选中第几项」是 1 基的人类计数，落到数组下标要减一。 */
const FIRST_INDEX = 1

const JUSTIFY = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
} as const

const ALIGN_ITEMS = {
  top: 'flex-start',
  center: 'center',
  bottom: 'flex-end',
} as const

type TabsVarName =
  | '--tab-accent'
  | '--tab-on'
  | '--tab-text'
  | '--tab-active-text'
  | '--tab-track'
  | '--tab-radius'
  | '--tab-item-radius'
  | '--tab-cut'
  | '--tab-border-w'
  | '--tab-font-size'
  | '--tab-weight'
  | '--tab-active-weight'
  | '--tab-tracking'
  | '--tab-gap'
  | '--tab-px'
  | '--tab-py'
  | '--tab-pad'
  | '--tab-glow'
  | '--tab-ind'

/** 页签栏自己的一组 CSS 变量；样式表只认变量，不认配置键。 */
export type TabsVars = CSSProperties & Partial<Record<TabsVarName, string>>

/** 变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const TABS_VAR_NAMES: readonly TabsVarName[] = [
  '--tab-accent',
  '--tab-on',
  '--tab-text',
  '--tab-active-text',
  '--tab-track',
  '--tab-radius',
  '--tab-item-radius',
  '--tab-cut',
  '--tab-border-w',
  '--tab-font-size',
  '--tab-weight',
  '--tab-active-weight',
  '--tab-tracking',
  '--tab-gap',
  '--tab-px',
  '--tab-py',
  '--tab-pad',
  '--tab-glow',
  '--tab-ind',
]

/** 一格页签从配置里读出来的全部东西。 */
export interface TabView {
  /** `v-for` 的稳定 key；不参与任何比对。 */
  key: string
  label: string
  /** DtIcon 的注册名；空串 = 不画图标。 */
  icon: string
  /** 点它上抛的联动值，空串 = 这一格点了不上抛。 */
  emitValue: string
  isDisabled: boolean
}

/** 一条页签栏从配置里读出来的全部形态。 */
export interface TabsSpec {
  items: TabView[]
  /** 出厂选中第几格（0 基），已按真实格数夹取。 */
  activeAt: number
  iconSize: number
  classes: string[]
  vars: TabsVars
  /** 外层容器的排布：按内容尺寸时决定轨道落在模块矩形的哪一处。 */
  hostStyle: CSSProperties
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 主色与压在主色上的文字色。
 * ⚠ 自定义档推不出对比色：给深色底稿，看不清时由「选中文字色」显式覆盖。
 */
function toneColors(config: Record<string, unknown>): TabsToneColors {
  const tone = readEnum(config.tone, TABS_TONE_VALUES, 'primary')
  if (tone !== 'custom') return TABS_TONE_COLORS[tone]
  const accent = readTrimmedText(config.accent)
  return {
    accent: accent === '' ? 'var(--accent-primary)' : accent,
    on: 'var(--text-inverse)',
  }
}

/** 圆角与切角是同一个旋钮的两种用法：轮廓档决定它落在哪一个上。 */
function cornerOf(config: Record<string, unknown>): {
  shape: TabsShape
  radius: number
  cut: number
} {
  const shape = readEnum(config.shape, TABS_SHAPE_VALUES, 'rounded')
  const size = clamp(readNumber(config.itemRadius, 6), 0, 40)
  if (shape === 'pill') return { shape, radius: PILL_RADIUS_PX, cut: 0 }
  if (shape === 'sharp') return { shape, radius: 0, cut: 0 }
  if (shape === 'cut') return { shape, radius: 0, cut: size }
  return { shape, radius: size, cut: 0 }
}

function fontSizeOf(config: Record<string, unknown>): number {
  return clamp(readNumber(config.fontSize, 14), 8, 64)
}

/** 配 0 = 跟着字号走：配一次字号，图标与文字一起缩放。 */
function iconSizeOf(config: Record<string, unknown>): number {
  const configured = clamp(readNumber(config.iconSize, 0), 0, 64)
  if (configured > 0) return Math.round(configured)
  return Math.round(fontSizeOf(config) * ICON_TO_FONT_RATIO)
}

/** 一行配置 → 一格页签。 */
function readItem(raw: unknown, index: number): TabView {
  const row = readRecord(raw)
  const label = readText(row.label, `${TABS_ITEM_LABEL_DEFAULT} ${index + 1}`)
  return {
    key: `${index}:${label}`,
    label,
    icon: readEnum(row.icon, TABS_ICON_VALUES, ''),
    emitValue: readTrimmedText(row.emitValue),
    isDisabled: readBoolean(row.disabled),
  }
}

function readItems(config: Record<string, unknown>): TabView[] {
  return readArray(config.items).map(readItem)
}

/**
 * 出厂选中第几格，收成 0 基下标。
 * ⚠ 夹到真实格数之内：配了「第 5 项」又把格删到只剩三格时，不夹的话
 * 一整条轨道上没有任何一格是选中的，看着像模块坏了。
 * @param count 真实格数
 */
function activeAtOf(config: Record<string, unknown>, count: number): number {
  const configured = readNumber(config.activeIndex, FIRST_INDEX)
  return clamp(Math.round(configured) - FIRST_INDEX, 0, Math.max(0, count - 1))
}

function cssVars(config: Record<string, unknown>): TabsVars {
  const colors = toneColors(config)
  const corner = cornerOf(config)
  const vars: TabsVars = {
    '--tab-accent': colors.accent,
    '--tab-on': colors.on,
    '--tab-radius': `${clamp(readNumber(config.trackRadius, 10), 0, 40)}px`,
    '--tab-item-radius': `${corner.radius}px`,
    '--tab-cut': `${corner.cut}px`,
    '--tab-border-w': `${clamp(readNumber(config.borderWidth, 1), 0, 4)}px`,
    '--tab-font-size': `${fontSizeOf(config)}px`,
    '--tab-weight': `${clamp(readNumber(config.fontWeight, 500), 100, 900)}`,
    '--tab-tracking': `${clamp(readNumber(config.letterSpacing, 0), 0, 20)}px`,
    '--tab-gap': `${clamp(readNumber(config.gap, 4), 0, 40)}px`,
    '--tab-px': `${clamp(readNumber(config.itemPaddingX, 16), 0, 64)}px`,
    '--tab-py': `${clamp(readNumber(config.itemPaddingY, 8), 0, 48)}px`,
    '--tab-pad': `${clamp(readNumber(config.trackPadding, 3), 0, 32)}px`,
    '--tab-ind': `${clamp(readNumber(config.indicatorSize, 2), 1, 12)}px`,
  }
  // 以下四项「没配 = 不注入」：注入了就再也回落不到各风格自己的缺省
  const textColor = readTrimmedText(config.textColor)
  if (textColor !== '') vars['--tab-text'] = textColor
  const activeTextColor = readTrimmedText(config.activeTextColor)
  if (activeTextColor !== '') vars['--tab-active-text'] = activeTextColor
  const trackColor = readTrimmedText(config.trackColor)
  if (trackColor !== '') vars['--tab-track'] = trackColor
  const activeWeight = clamp(readNumber(config.activeFontWeight, 0), 0, 900)
  if (activeWeight > 0) vars['--tab-active-weight'] = `${activeWeight}`
  if (readBoolean(config.glow)) {
    vars['--tab-glow'] = `${clamp(readNumber(config.glowRadius, 12), 0, 40)}px`
  }
  return vars
}

function classesOf(config: Record<string, unknown>): string[] {
  const classes = [
    `dt-tabs--${readEnum(config.variant, TABS_VARIANT_VALUES, 'track')}`,
    `dt-tabs--shape-${cornerOf(config).shape}`,
    `dt-tabs--${readEnum(config.orientation, TABS_ORIENTATION_VALUES, 'row')}`,
    `dt-tabs--ind-${readEnum(config.indicator, TABS_INDICATOR_VALUES, 'bar')}`,
    `dt-tabs--just-${readEnum(config.itemAlign, TABS_ITEM_ALIGN_VALUES, 'center')}`,
    `dt-tabs--hover-${readEnum(config.hover, TABS_HOVER_VALUES, 'tint')}`,
    `dt-tabs--press-${readEnum(config.press, TABS_PRESS_VALUES, 'none')}`,
  ]
  if (readEnum(config.sizing, TABS_SIZING_VALUES, 'fill') === 'fill') {
    classes.push('dt-tabs--fill')
  }
  if (readBoolean(config.stretch, true)) classes.push('dt-tabs--stretch')
  if (readBoolean(config.divider)) classes.push('dt-tabs--divider')
  if (readBoolean(config.glow)) classes.push('dt-tabs--glow')
  return classes
}

/**
 * 充满模块时不需要对齐——轨道就是那个矩形本身（宽高由 `--fill` 类给）。
 * ⚠ 横轴写 `flex-start` 而不是 `stretch`：flex 容器的 `justify-content` 没有
 * stretch 这一档，写了整条声明会被浏览器丢掉，读源码的人却以为它生效了。
 */
function hostStyle(config: Record<string, unknown>): CSSProperties {
  if (readEnum(config.sizing, TABS_SIZING_VALUES, 'fill') === 'fill') {
    return { justifyContent: 'flex-start', alignItems: 'stretch' }
  }
  return {
    justifyContent:
      JUSTIFY[readEnum(config.align, TABS_ALIGN_VALUES, 'center')],
    alignItems:
      ALIGN_ITEMS[readEnum(config.vAlign, TABS_VALIGN_VALUES, 'center')],
  }
}

/**
 * 读一份页签栏形态。
 * @param config 该节点落库的配置（已铺清单缺省）
 */
export function readTabsSpec(config: Record<string, unknown>): TabsSpec {
  const items = readItems(config)
  return {
    items,
    activeAt: activeAtOf(config, items.length),
    iconSize: iconSizeOf(config),
    classes: classesOf(config),
    vars: cssVars(config),
    hostStyle: hostStyle(config),
  }
}
