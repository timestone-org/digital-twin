/**
 * @fileoverview info-card 的配置 → 形态：一次读完外观那一半 config，收成一份 `CardLook`
 * （修饰类、`--ic-*` 变量、夹取后的数值与外层网格）。纯函数，模板只摆件不判档位。
 * ⚠ 数值一律夹回清单声明的范围：`min` / `max` 只约束属性面板，脏配置里的 `-8` 会让整条
 * CSS 声明被浏览器丢掉，而 `0` 字号会让读数彻底看不见。
 * ⚠ 外层网格走 `gridStyle` 而不是 CSS 变量：列模板、格间距与整块内边距只有容器一个消费者，
 * 摊成变量就要靠另一个文件写对名字才生效，而变量名拼错既不报错也不生效。
 */
import type { CSSProperties } from 'vue'

import {
  readArray,
  readEnum,
  readNumber,
  readRecord,
  readTrimmedText,
} from '../../shared/config'
import {
  CARD_ALIGN_VALUES,
  CARD_CELL_SHELL_VALUES,
  CARD_COLUMN_VALUES,
  CARD_HOVER_VALUES,
  CARD_ICON_MODE_VALUES,
  CARD_ICON_POSITION_VALUES,
  CARD_ICON_RADII,
  CARD_ICON_SHAPE_VALUES,
  CARD_LABEL_PLACE_VALUES,
  CARD_LABEL_TONE_COLORS,
  CARD_LABEL_TONE_VALUES,
  CARD_LAYOUT_VALUES,
  CARD_UNIT_PLACE_VALUES,
  CARD_UNIT_TONE_COLORS,
  CARD_UNIT_TONE_VALUES,
  CARD_VALUE_FILL_VALUES,
  CARD_VALUE_FONT_VALUES,
  type CardColumns,
  type CardIconMode,
  type CardIconPosition,
  type CardLabelPlace,
  type CardLayout,
} from './options'

/** 已按格数收敛过的排布：`auto` 到这里已经变成两档之一。 */
export type CardGridLayout = Exclude<CardLayout, 'auto'>

/**
 * 渐变文字的缺省色标。
 * ⚠ 参考仓用的是 `--chart-value-g1…g4` 四支，本仓没有这一族 token（`packages/tokens`
 * 里一个 `--chart-*` 都没有），改用主题的两支强调色。少于两个色标的渐变在部分浏览器
 * 直接是非法值，所以缺省必须给满两支。
 */
export const CARD_VALUE_STOPS = [
  'var(--accent-secondary)',
  'var(--accent-primary)',
] as const

/** 数值纯色的缺省，与参考仓 kpi-card 的 `accent` 缺省同值。 */
const DEFAULT_VALUE_COLOR = 'var(--accent-primary)'

// 图标容器的三处缺省：参考仓那三个 --card-icon-* token 本仓没有，按强调色调出来
const ICON_BG_FROM =
  'color-mix(in srgb, var(--accent-primary) 26%, transparent)'
const ICON_BG_TO = 'color-mix(in srgb, var(--accent-primary) 8%, transparent)'
const ICON_BORDER = 'color-mix(in srgb, var(--accent-primary) 35%, transparent)'
const ICON_GLOW = 'color-mix(in srgb, var(--accent-primary) 45%, transparent)'

/** 自适应列的最小列宽，逐字取自参考仓 kpi-group 与 icon-kpi-group。 */
const AUTO_MIN_COL = 120

// 属性面板声明的取值范围，`look` 这一层再夹一次
const MAX_PAD = 40
const MIN_FONT = 8
const MAX_LABEL_FONT = 48
const MAX_UNIT_FONT = 32
const MAX_VALUE_FONT = 200
const MAX_GLOW = 24
const MIN_ICON = 16
const MAX_ICON = 96
const MIN_ICON_FONT = 8
const MAX_ICON_FONT = 48
const MIN_OPACITY = 0.2
const OPAQUE = 1
const DEGREES = 360

type IcVarName =
  | '--ic-cell-px'
  | '--ic-cell-py'
  | '--ic-label-size'
  | '--ic-label-color'
  | '--ic-label-opacity'
  | '--ic-value-size'
  | '--ic-value-color'
  | '--ic-value-glow'
  | '--ic-value-gradient'
  | '--ic-unit-size'
  | '--ic-unit-color'
  | '--ic-unit-opacity'
  | '--ic-icon-size'
  | '--ic-icon-radius'
  | '--ic-icon-bg'
  | '--ic-icon-border'
  | '--ic-icon-glow'
  | '--ic-icon-font'
  | '--ic-icon-gap'
  | '--ic-icon-opacity'

/**
 * 本模块自己的一组 CSS 变量；样式表只认变量，不认配置键。
 * ⚠ 这套变量没有全局闸看着（`css-variables.contract.spec.ts` 扫不到 `packages/modules/src`），
 * 拼错既不报错也不生效，只能靠 `look.test.ts` 里那条与 scss 双向吻合的断言。
 */
export type CardVars = CSSProperties & Partial<Record<IcVarName, string>>

/** 变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const IC_VAR_NAMES: readonly IcVarName[] = [
  '--ic-cell-px',
  '--ic-cell-py',
  '--ic-label-size',
  '--ic-label-color',
  '--ic-label-opacity',
  '--ic-value-size',
  '--ic-value-color',
  '--ic-value-glow',
  '--ic-value-gradient',
  '--ic-unit-size',
  '--ic-unit-color',
  '--ic-unit-opacity',
  '--ic-icon-size',
  '--ic-icon-radius',
  '--ic-icon-bg',
  '--ic-icon-border',
  '--ic-icon-glow',
  '--ic-icon-font',
  '--ic-icon-gap',
  '--ic-icon-opacity',
]

/** 图标画不画、画在哪一侧；形状与配色已经摊进变量里了。 */
export interface CardIconLook {
  mode: CardIconMode
  /** ⚠ `corner` 档钉死在右上角，不看这一档。 */
  position: CardIconPosition
}

/** 解析并夹取之后的数值，变量由它派生；断言尺寸时读这一份而不是解析 px 串。 */
export interface CardNums {
  gapX: number
  gapY: number
  padX: number
  padY: number
  cellPadX: number
  cellPadY: number
  labelSize: number
  labelOpacity: number
  /** 0 = 跟着格宽自适应，样式表里的 `clamp()` 接手。 */
  valueSize: number
  valueGlow: number
  unitSize: number
  unitOpacity: number
  iconSize: number
  iconGlow: number
  iconFont: number
  iconGap: number
  iconOpacity: number
}

/** 一块卡片从配置里读出来的全部形态。 */
export interface CardLook {
  classes: string[]
  vars: CardVars
  nums: CardNums
  /** 已按格数收敛的实际排布。 */
  layout: CardGridLayout
  /** ⚠ 类名由格自己在标签真渲染时才挂，这里只给档位。 */
  labelPlace: CardLabelPlace
  icon: CardIconLook
  gridStyle: CSSProperties
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 角度归一到 [0,360)。
 * ⚠ 负数与越界都会产出非法的 `linear-gradient()`，整条声明被浏览器丢掉、底色全白。
 * @param raw 配置里读出来的原值
 * @param fallback 非有限数时的回退角度
 */
function normalizeAngle(raw: unknown, fallback: number): number {
  return ((readNumber(raw, fallback) % DEGREES) + DEGREES) % DEGREES
}

/**
 * 用户色标 → 停靠色；少于两个有效色标时整份回落主题色标。
 * @param raw `valueGradient` 数组的原值
 */
function valueStops(raw: unknown): string[] {
  const stops = readArray(raw)
    .map((row) => readTrimmedText(readRecord(row).color))
    .filter((color) => color !== '')
  return stops.length >= 2 ? stops : [...CARD_VALUE_STOPS]
}

/**
 * 数值渐变串；`0deg` = 自下而上，与参考仓 icon-kpi-group 同口径。
 * @param config 该节点落库的配置
 */
function valueGradient(config: Record<string, unknown>): string {
  const angle = normalizeAngle(config.gradientAngle, 0)
  return `linear-gradient(${angle}deg, ${valueStops(config.valueGradient).join(', ')})`
}

/**
 * 图标容器的底色渐变；起止色留空回落强调色调出来的两档。
 * @param icon 图标那一簇的原值
 */
function iconBackground(icon: Record<string, unknown>): string {
  const from = readTrimmedText(icon.bgFrom) || ICON_BG_FROM
  const to = readTrimmedText(icon.bgTo) || ICON_BG_TO
  return `linear-gradient(${normalizeAngle(icon.bgAngle, 135)}deg, ${from}, ${to})`
}

/**
 * 实际排布：`auto` 只有一格时走大字居中，多格走网格。
 * @param config 该节点落库的配置
 * @param count 这一块真的画出来几格
 */
function resolveLayout(
  config: Record<string, unknown>,
  count: number,
): CardGridLayout {
  const layout = readEnum(config.layout, CARD_LAYOUT_VALUES, 'auto')
  if (layout !== 'auto') return layout
  return count > 1 ? 'grid' : 'single'
}

/**
 * 外层容器的排布。
 * ⚠ 行走 `minmax(0, 1fr)`：不给的话项数少时行按内容高度堆在顶上，卡片下半截空着——
 * 参考仓 icon-kpi-group 的 `gridAutoRows` 就是为这件事写的。
 * @param nums 已夹取的尺寸
 * @param columns 列数档
 * @param layout 已收敛的排布
 */
function gridStyle(
  nums: CardNums,
  columns: CardColumns,
  layout: CardGridLayout,
): CSSProperties {
  const template =
    columns === 'auto'
      ? `repeat(auto-fit, minmax(${AUTO_MIN_COL}px, 1fr))`
      : `repeat(${columns}, minmax(0, 1fr))`
  return {
    display: 'grid',
    gridTemplateColumns: layout === 'single' ? 'minmax(0, 1fr)' : template,
    gridAutoRows: 'minmax(0, 1fr)',
    gap: `${nums.gapY}px ${nums.gapX}px`,
    padding: `${nums.padY}px ${nums.padX}px`,
  }
}

/**
 * 解析并夹取全部尺寸。
 * @param config 该节点落库的配置（已铺清单缺省）
 */
function readNums(config: Record<string, unknown>): CardNums {
  const icon = readRecord(config.icon)
  const unit = readRecord(config.unit)
  return {
    gapX: clamp(readNumber(config.gapX, 10), 0, MAX_PAD),
    gapY: clamp(readNumber(config.gapY, 10), 0, MAX_PAD),
    padX: clamp(readNumber(config.padX, 10), 0, MAX_PAD),
    padY: clamp(readNumber(config.padY, 6), 0, MAX_PAD),
    cellPadX: clamp(readNumber(config.cellPadX, 12), 0, MAX_PAD),
    cellPadY: clamp(readNumber(config.cellPadY, 8), 0, MAX_PAD),
    labelSize: clamp(
      readNumber(config.labelSize, 12),
      MIN_FONT,
      MAX_LABEL_FONT,
    ),
    labelOpacity: clamp(
      readNumber(config.labelOpacity, OPAQUE),
      MIN_OPACITY,
      OPAQUE,
    ),
    valueSize: clamp(readNumber(config.valueSize, 0), 0, MAX_VALUE_FONT),
    valueGlow: clamp(readNumber(config.valueGlow, 0), 0, MAX_GLOW),
    unitSize: clamp(readNumber(unit.size, 12), MIN_FONT, MAX_UNIT_FONT),
    unitOpacity: clamp(readNumber(unit.opacity, OPAQUE), MIN_OPACITY, OPAQUE),
    iconSize: clamp(readNumber(icon.size, 20), MIN_ICON, MAX_ICON),
    iconGlow: clamp(readNumber(icon.glow, 8), 0, MAX_GLOW),
    iconFont: clamp(
      readNumber(icon.fontSize, 18),
      MIN_ICON_FONT,
      MAX_ICON_FONT,
    ),
    iconGap: clamp(readNumber(icon.gap, 10), 0, MAX_PAD),
    iconOpacity: clamp(readNumber(icon.opacity, OPAQUE), MIN_OPACITY, OPAQUE),
  }
}

/**
 * 格内边距与三段文字的变量。
 * @param config 该节点落库的配置
 * @param nums 已夹取的尺寸
 */
function textVars(config: Record<string, unknown>, nums: CardNums): CardVars {
  const tone = readEnum(config.labelTone, CARD_LABEL_TONE_VALUES, 'secondary')
  const unitTone = readEnum(
    readRecord(config.unit).tone,
    CARD_UNIT_TONE_VALUES,
    'secondary',
  )
  const vars: CardVars = {
    '--ic-cell-px': `${nums.cellPadX}px`,
    '--ic-cell-py': `${nums.cellPadY}px`,
    '--ic-label-size': `${nums.labelSize}px`,
    '--ic-label-color': CARD_LABEL_TONE_COLORS[tone],
    '--ic-label-opacity': `${nums.labelOpacity}`,
    '--ic-value-color':
      readTrimmedText(config.valueColor) || DEFAULT_VALUE_COLOR,
    '--ic-unit-size': `${nums.unitSize}px`,
    '--ic-unit-opacity': `${nums.unitOpacity}`,
  }
  // 以下四项「没配 = 不写键」：注入了就再也回落不到 _variants.scss 里的档位缺省
  if (nums.valueSize > 0) vars['--ic-value-size'] = `${nums.valueSize}px`
  if (nums.valueGlow > 0) vars['--ic-value-glow'] = `${nums.valueGlow}px`
  if (readEnum(config.valueFill, CARD_VALUE_FILL_VALUES, 'solid') !== 'solid') {
    vars['--ic-value-gradient'] = valueGradient(config)
  }
  // ⚠ 跟随数值色那一档在这里**不注入**：它跟的是逐格算出来的数值色（含命中规则后的
  //   告警色），静态 token 表达不了，改由格上的 `ic--unit-tone-accent` 接手
  if (CARD_UNIT_TONE_COLORS[unitTone] !== '') {
    vars['--ic-unit-color'] = CARD_UNIT_TONE_COLORS[unitTone]
  }
  return vars
}

/**
 * 图标容器那一簇的变量；不画图标时一个都不注入。
 * @param config 该节点落库的配置
 * @param nums 已夹取的尺寸
 */
function iconVars(config: Record<string, unknown>, nums: CardNums): CardVars {
  const icon = readRecord(config.icon)
  if (readEnum(icon.mode, CARD_ICON_MODE_VALUES, 'none') === 'none') return {}
  const shape = readEnum(icon.shape, CARD_ICON_SHAPE_VALUES, 'circle')
  return {
    '--ic-icon-size': `${nums.iconSize}px`,
    '--ic-icon-radius': CARD_ICON_RADII[shape],
    '--ic-icon-bg': iconBackground(icon),
    '--ic-icon-border': readTrimmedText(icon.borderColor) || ICON_BORDER,
    '--ic-icon-glow': `0 0 ${nums.iconGlow}px ${ICON_GLOW}`,
    '--ic-icon-font': `${nums.iconFont}px`,
    '--ic-icon-gap': `${nums.iconGap}px`,
    '--ic-icon-opacity': `${nums.iconOpacity}`,
  }
}

/**
 * 一档一个修饰类；同一份类名既挂在卡片根上也挂在每一格上，容器与格因此吃同一套档位。
 * ⚠ 标签位置**不在这里**：它只有在标签真渲染时才准挂，而那是逐格才知道的事。
 * @param config 该节点落库的配置
 * @param layout 已收敛的排布
 */
function classesOf(
  config: Record<string, unknown>,
  layout: CardGridLayout,
): string[] {
  const icon = readRecord(config.icon)
  const unit = readRecord(config.unit)
  const classes = [
    `ic--layout-${layout}`,
    `ic--shell-${readEnum(config.cellShell, CARD_CELL_SHELL_VALUES, 'plain')}`,
    `ic--hover-${readEnum(config.hover, CARD_HOVER_VALUES, 'none')}`,
    `ic--align-${readEnum(config.align, CARD_ALIGN_VALUES, 'center')}`,
    `ic--icon-${readEnum(icon.mode, CARD_ICON_MODE_VALUES, 'none')}`,
    `ic--icon-at-${readEnum(icon.position, CARD_ICON_POSITION_VALUES, 'left')}`,
    `ic--unit-${readEnum(unit.place, CARD_UNIT_PLACE_VALUES, 'baseline')}`,
    `ic--font-${readEnum(config.valueFont, CARD_VALUE_FONT_VALUES, 'digit')}`,
  ]
  if (readEnum(unit.tone, CARD_UNIT_TONE_VALUES, 'secondary') === 'accent') {
    classes.push('ic--unit-tone-accent')
  }
  return classes
}

/**
 * 读一块卡片的形态。
 * @param config 该节点落库的配置（已铺清单缺省）
 * @param count 这一块真的画出来几格，`auto` 排布靠它二选一
 */
export function readCardLook(
  config: Record<string, unknown>,
  count = 0,
): CardLook {
  const layout = resolveLayout(config, count)
  const nums = readNums(config)
  const icon = readRecord(config.icon)
  const columns = readEnum(config.columns, CARD_COLUMN_VALUES, 'auto')
  return {
    classes: classesOf(config, layout),
    vars: { ...textVars(config, nums), ...iconVars(config, nums) },
    nums,
    layout,
    labelPlace: readEnum(config.labelPlace, CARD_LABEL_PLACE_VALUES, 'above'),
    icon: {
      mode: readEnum(icon.mode, CARD_ICON_MODE_VALUES, 'none'),
      position: readEnum(icon.position, CARD_ICON_POSITION_VALUES, 'left'),
    },
    gridStyle: gridStyle(nums, columns, layout),
  }
}
