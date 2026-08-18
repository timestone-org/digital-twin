/**
 * @fileoverview 按钮的配置 → 形态：一次读完 config，收成一份 `ButtonSpec`
 * （文案、行为、类名、CSS 变量、外层排布）。纯函数，渲染组件只负责摆模板。
 * ⚠ 数值一律夹到清单声明的范围：`min` / `max` 只约束属性面板，脏配置里的
 * `-8` 会让整条 CSS 声明被浏览器丢掉，而 `0` 字号会让按钮彻底看不见。
 */
import type { CSSProperties } from 'vue'

import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
  readTrimmedText,
} from '../../shared/config'
import {
  BUTTON_ALIGN_VALUES,
  BUTTON_HOVER_VALUES,
  BUTTON_ICON_POSITION_VALUES,
  BUTTON_ICON_VALUES,
  BUTTON_PRESS_VALUES,
  BUTTON_SHAPE_VALUES,
  BUTTON_SIZING_VALUES,
  BUTTON_TONE_COLORS,
  BUTTON_TONE_VALUES,
  BUTTON_VALIGN_VALUES,
  BUTTON_VARIANT_VALUES,
  type ButtonShape,
  type ToneColors,
} from './options'

/** 出厂文案：脱开运行时单独挂载时也该看到一个像样的按钮而不是空壳。 */
export const BUTTON_TEXT_DEFAULT = '按钮'

/** 胶囊档的圆角：比任何可能的高度都大，浏览器自己夹到半高。 */
const PILL_RADIUS_PX = 999

/** 图标字号的哨兵 0 = 跟着文字走，取字号的这个倍数。 */
const ICON_TO_FONT_RATIO = 1.2

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

type ButtonVarName =
  | '--btn-accent'
  | '--btn-on'
  | '--btn-text'
  | '--btn-radius'
  | '--btn-cut'
  | '--btn-border-w'
  | '--btn-font-size'
  | '--btn-weight'
  | '--btn-tracking'
  | '--btn-gap'
  | '--btn-px'
  | '--btn-py'
  | '--btn-glow'
  | '--btn-pulse'

/** 按钮自己的一组 CSS 变量；样式表只认变量，不认配置键。 */
export type ButtonVars = CSSProperties & Partial<Record<ButtonVarName, string>>

/** 一个按钮从配置里读出来的全部形态。 */
export interface ButtonSpec {
  text: string
  subText: string
  /** DtIcon 的注册名；空串 = 不画图标。 */
  icon: string
  iconSize: number
  /** 悬停提示，空串 = 不挂 title。 */
  hint: string
  /** 无可见文案时给读屏的名字；有文案时是 undefined（可见文字就是名字）。 */
  ariaLabel: string | undefined
  /** 点击上抛的联动值，空串 = 只抛一个不带值的点击。 */
  linkValue: string
  isDisabled: boolean
  /** 科技风才画四角刻线。 */
  isHud: boolean
  /** 扫光需要一层单独的动画元素，其余悬停档不需要。 */
  hasSweep: boolean
  /** 有没有可见文案；一个字都没有时按钮收成方形，只摆图标。 */
  hasLabel: boolean
  classes: string[]
  vars: ButtonVars
  /** 外层容器的排布：按内容尺寸时决定按钮落在模块矩形的哪一处。 */
  hostStyle: CSSProperties
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 主色与压在主色上的文字色。
 * ⚠ 自定义档推不出对比色：给深色底稿，看不清时由「文字色」显式覆盖。
 */
function toneColors(config: Record<string, unknown>): ToneColors {
  const tone = readEnum(config.tone, BUTTON_TONE_VALUES, 'primary')
  if (tone !== 'custom') return BUTTON_TONE_COLORS[tone]
  const accent = readTrimmedText(config.accent)
  return {
    accent: accent === '' ? 'var(--accent-primary)' : accent,
    on: 'var(--text-inverse)',
  }
}

/** 圆角与切角是同一个旋钮的两种用法：形状档决定它落在哪一个上。 */
function cornerOf(config: Record<string, unknown>): {
  shape: ButtonShape
  radius: number
  cut: number
} {
  const shape = readEnum(config.shape, BUTTON_SHAPE_VALUES, 'rounded')
  const size = clamp(readNumber(config.radius, 8), 0, 40)
  if (shape === 'pill') return { shape, radius: PILL_RADIUS_PX, cut: 0 }
  if (shape === 'sharp') return { shape, radius: 0, cut: 0 }
  if (shape === 'cut') return { shape, radius: 0, cut: size }
  return { shape, radius: size, cut: 0 }
}

function fontSizeOf(config: Record<string, unknown>): number {
  return clamp(readNumber(config.fontSize, 16), 8, 64)
}

/** 配 0 = 跟着字号走：配一次字号，图标与文字一起缩放。 */
function iconSizeOf(config: Record<string, unknown>): number {
  const configured = clamp(readNumber(config.iconSize, 0), 0, 64)
  if (configured > 0) return Math.round(configured)
  return Math.round(fontSizeOf(config) * ICON_TO_FONT_RATIO)
}

function cssVars(config: Record<string, unknown>): ButtonVars {
  const colors = toneColors(config)
  const corner = cornerOf(config)
  const textColor = readTrimmedText(config.textColor)
  const vars: ButtonVars = {
    '--btn-accent': colors.accent,
    '--btn-on': colors.on,
    '--btn-radius': `${corner.radius}px`,
    '--btn-cut': `${corner.cut}px`,
    '--btn-border-w': `${clamp(readNumber(config.borderWidth, 1), 0, 4)}px`,
    '--btn-font-size': `${fontSizeOf(config)}px`,
    '--btn-weight': `${clamp(readNumber(config.fontWeight, 600), 100, 900)}`,
    '--btn-tracking': `${clamp(readNumber(config.letterSpacing, 0), 0, 20)}px`,
    '--btn-gap': `${clamp(readNumber(config.gap, 8), 0, 32)}px`,
    '--btn-px': `${clamp(readNumber(config.paddingX, 20), 0, 64)}px`,
    '--btn-py': `${clamp(readNumber(config.paddingY, 10), 0, 48)}px`,
  }
  // 以下三项「没配 = 不注入」：注入了就再也回落不到各风格自己的缺省
  if (textColor !== '') vars['--btn-text'] = textColor
  if (readBoolean(config.glow)) {
    vars['--btn-glow'] = `${clamp(readNumber(config.glowRadius, 12), 0, 40)}px`
  }
  if (readBoolean(config.pulse)) {
    vars['--btn-pulse'] =
      `${clamp(readNumber(config.pulseDuration, 2), 0.6, 6)}s`
  }
  return vars
}

/** 主副文案都空 = 图标按钮：横向内边距要收掉，否则一枚图标被撑成扁矩形。 */
function hasLabel(config: Record<string, unknown>): boolean {
  return (
    readText(config.text, BUTTON_TEXT_DEFAULT).trim() !== '' ||
    readText(config.subText).trim() !== ''
  )
}

function classesOf(config: Record<string, unknown>): string[] {
  const classes = [
    `dt-button--${readEnum(config.variant, BUTTON_VARIANT_VALUES, 'solid')}`,
    `dt-button--${cornerOf(config).shape}`,
    `dt-button--icon-${readEnum(config.iconPosition, BUTTON_ICON_POSITION_VALUES, 'left')}`,
    `dt-button--hover-${readEnum(config.hover, BUTTON_HOVER_VALUES, 'brighten')}`,
    `dt-button--press-${readEnum(config.press, BUTTON_PRESS_VALUES, 'sink')}`,
  ]
  if (readEnum(config.sizing, BUTTON_SIZING_VALUES, 'fill') === 'fill') {
    classes.push('dt-button--fill')
  }
  if (readBoolean(config.glow)) classes.push('dt-button--glow')
  if (readBoolean(config.pulse)) classes.push('dt-button--pulse')
  if (!hasLabel(config)) classes.push('dt-button--icon-only')
  return classes
}

/**
 * 充满模块时不需要对齐——按钮就是那个矩形本身（宽高由 `--fill` 类给）。
 * ⚠ 横轴写 `flex-start` 而不是 `stretch`：flex 容器的 `justify-content` 没有
 * stretch 这一档，写了整条声明会被浏览器丢掉，读源码的人却以为它生效了。
 */
function hostStyle(config: Record<string, unknown>): CSSProperties {
  if (readEnum(config.sizing, BUTTON_SIZING_VALUES, 'fill') === 'fill') {
    return { justifyContent: 'flex-start', alignItems: 'stretch' }
  }
  return {
    justifyContent:
      JUSTIFY[readEnum(config.align, BUTTON_ALIGN_VALUES, 'center')],
    alignItems:
      ALIGN_ITEMS[readEnum(config.vAlign, BUTTON_VALIGN_VALUES, 'center')],
  }
}

/**
 * 读屏用的名字：只有一个字都不显示时才给。
 * ⚠ 有可见文字时必须给 undefined——`aria-label` 会**盖掉**可见文案，
 * 两者不一致时读屏读到的与屏幕上写的就是两回事。
 * @param text 按钮上的可见文案
 * @param hint 悬停提示，图标按钮拿它当名字
 */
function ariaLabelOf(text: string, hint: string): string | undefined {
  if (text.trim() !== '') return undefined
  return hint === '' ? BUTTON_TEXT_DEFAULT : hint
}

/**
 * 读一份按钮形态。
 * @param config 该节点落库的配置（已铺清单缺省）
 */
export function readButtonSpec(config: Record<string, unknown>): ButtonSpec {
  const text = readText(config.text, BUTTON_TEXT_DEFAULT)
  const hint = readTrimmedText(config.hint)
  return {
    text,
    subText: readText(config.subText),
    icon: readEnum(config.icon, BUTTON_ICON_VALUES, ''),
    iconSize: iconSizeOf(config),
    hint,
    ariaLabel: ariaLabelOf(text, hint),
    linkValue: readTrimmedText(config.linkValue),
    isDisabled: readBoolean(config.disabled),
    isHud: readEnum(config.variant, BUTTON_VARIANT_VALUES, 'solid') === 'hud',
    hasSweep:
      readEnum(config.hover, BUTTON_HOVER_VALUES, 'brighten') === 'sweep',
    hasLabel: hasLabel(config),
    classes: classesOf(config),
    vars: cssVars(config),
    hostStyle: hostStyle(config),
  }
}
