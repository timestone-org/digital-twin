/**
 * @fileoverview info-list 的配置 → 形态：一次读完外观那一半 config，收成一份 `ListLook`
 * （修饰类、`--il-*` 变量、解析后的数值，以及行的声明式编排）。纯函数，模板只摆件不判档位。
 * ⚠ 数值一律夹回清单声明的范围：`min` / `max` 只约束属性面板，脏配置里的 `-8` 会让整条
 * CSS 声明被浏览器丢掉，而 `0` 字号会让读数彻底看不见。
 */
import type { CSSProperties } from 'vue'

import {
  readBoolean,
  readEnum,
  readNumber,
  readRecord,
  readTrimmedText,
} from '../../shared/config'
import {
  LIST_BADGE_KIND_VALUES,
  LIST_BADGE_STYLE_VALUES,
  LIST_DIVIDER_STYLE_VALUES,
  LIST_GROUPING_VALUES,
  LIST_HOVER_VALUES,
  LIST_LABEL_TONE_COLORS,
  LIST_LABEL_TONE_VALUES,
  LIST_LEAD_VALUES,
  LIST_METER_KIND_VALUES,
  LIST_METER_SOURCE2_VALUES,
  LIST_METER_SOURCE_VALUES,
  LIST_ROW_LAYOUT_VALUES,
  LIST_ROW_SHELL_VALUES,
  LIST_SEGMENT_VALUES,
  LIST_TAIL_VALUES,
  LIST_UNIT_PLACE_VALUES,
  type ListBadgeKind,
  type ListBadgeStyle,
  type ListGrouping,
  type ListLead,
  type ListMeterKind,
  type ListMeterSource,
  type ListMeterSource2,
  type ListSegment,
  type ListTail,
} from './options'

/** 行内最多三段，多出来的直接不要——再多一段，行高就压过了列表本身。 */
export const MAX_ROW_LINES = 3

// 属性面板声明的取值范围，`look` 这一层再夹一次
const MAX_PAD = 40
const MIN_FONT = 8
const MAX_FONT = 48
const MAX_UNIT_FONT = 32
const MAX_GLOW = 24
const MIN_METER_H = 1
const MAX_METER_H = 16
const MAX_METER_W = 320

/** 三列对齐档里单位列的上界 = 8 个单位字符。 */
const UNIT_COL_CHARS = 8

type IlVarName =
  | '--il-pad-x'
  | '--il-pad-y'
  | '--il-row-px'
  | '--il-row-py'
  | '--il-label-size'
  | '--il-label-color'
  | '--il-value-size'
  | '--il-value-color'
  | '--il-value-glow'
  | '--il-unit-size'
  | '--il-meter-h'
  | '--il-meter-w'
  | '--il-meter-color'
  | '--il-meter-glow'
  | '--il-cols-tpl'

/**
 * 本模块自己的一组 CSS 变量；样式表只认变量，不认配置键。
 * ⚠ 这套变量没有全局闸看着（`css-variables.contract.spec.ts` 扫不到 `packages/modules/src`），
 * 拼错既不报错也不生效，只能靠 `look.test.ts` 里那条与 scss 双向吻合的断言。
 */
export type ListVars = CSSProperties & Partial<Record<IlVarName, string>>

/** 变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const IL_VAR_NAMES: readonly IlVarName[] = [
  '--il-pad-x',
  '--il-pad-y',
  '--il-row-px',
  '--il-row-py',
  '--il-label-size',
  '--il-label-color',
  '--il-value-size',
  '--il-value-color',
  '--il-value-glow',
  '--il-unit-size',
  '--il-meter-h',
  '--il-meter-w',
  '--il-meter-color',
  '--il-meter-glow',
  '--il-cols-tpl',
]

/** 一行里的一段：左组两件 + 右组两件。四件全空的段整段不渲染。 */
export interface RowLine {
  /** `v-for` 的键：位次加四件的名字，删中间一段时其余不错位。 */
  key: string
  left: ListSegment
  left2: ListSegment
  right: ListSegment
  right2: ListSegment
}

/** 跨全部段位的前导列与两个尾列，外加扩展指标行的开关。 */
export interface RowShape {
  lead: ListLead
  tail: ListTail
  tail2: ListTail
  extras: boolean
}

/** 三列对齐档顶上的表头行。 */
export interface ColumnHeader {
  /** ⚠ 只有三列对齐档才谈得上表头：段位编排档下这一行没有列可对。 */
  show: boolean
  name: string
  value: string
  unit: string
}

/** 两条同构进度条：各自选源与小字，其余样式两条共用。 */
export interface MeterLook {
  kind: ListMeterKind
  source: ListMeterSource
  label: string
  source2: ListMeterSource2
  label2: string
  dot: boolean
  showPercent: boolean
}

/** 徽章画什么、怎么画。 */
export interface BadgeLook {
  kind: ListBadgeKind
  style: ListBadgeStyle
}

/** 解析并夹取之后的数值，变量由它派生；断言尺寸时读这一份而不是解析 px 串。 */
export interface ListNums {
  padX: number
  padY: number
  rowPadX: number
  rowPadY: number
  labelSize: number
  valueSize: number
  valueGlow: number
  unitSize: number
  meterHeight: number
  /** 0 = 铺满，模板据此决定要不要给一个定宽。 */
  meterWidth: number
  meterGlow: number
}

/** 一块列表从配置里读出来的全部形态。 */
export interface ListLook {
  classes: string[]
  vars: ListVars
  nums: ListNums
  lines: RowLine[]
  shape: RowShape
  header: ColumnHeader
  meter: MeterLook
  badge: BadgeLook
  grouping: ListGrouping
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 表头文案：空白一律回落缺省，别留一条只有分隔线的空表头。
 * @param raw 配置里读出来的原值
 * @param fallback 空白时的缺省文案
 */
function headerText(raw: unknown, fallback: string): string {
  const text = readTrimmedText(raw)
  return text === '' ? fallback : text
}

/**
 * 表头与数据行**共用**的三列模板。
 * ⚠ 单位列的上界写成 px 而不是 `8em`：`em` 认的是行自己的字号，跟不上 `unitSize`。
 * ⚠ 拆成两处字符串就会错列，而 typecheck 与 lint 都不管。
 * @param unitSize 单位字号 px
 */
function columnsTemplate(unitSize: number): string {
  const cap = Math.round(unitSize * UNIT_COL_CHARS)
  return `minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, ${cap}px)`
}

/**
 * 解析并夹取全部尺寸。
 * @param config 该节点落库的配置（已铺清单缺省）
 * @param meter 进度件那一簇的原值
 */
function readNums(
  config: Record<string, unknown>,
  meter: Record<string, unknown>,
): ListNums {
  const spacing = readRecord(config.spacing)
  return {
    padX: clamp(readNumber(spacing.padX, 6), 0, MAX_PAD),
    padY: clamp(readNumber(spacing.padY, 4), 0, MAX_PAD),
    rowPadX: clamp(readNumber(spacing.rowPadX, 4), 0, MAX_PAD),
    rowPadY: clamp(readNumber(spacing.rowPadY, 6), 0, MAX_PAD),
    labelSize: clamp(readNumber(config.labelSize, 13), MIN_FONT, MAX_FONT),
    valueSize: clamp(readNumber(config.valueSize, 16), MIN_FONT, MAX_FONT),
    valueGlow: clamp(readNumber(config.valueGlow, 0), 0, MAX_GLOW),
    unitSize: clamp(readNumber(config.unitSize, 11), MIN_FONT, MAX_UNIT_FONT),
    meterHeight: clamp(readNumber(meter.height, 4), MIN_METER_H, MAX_METER_H),
    meterWidth: clamp(readNumber(meter.width, 0), 0, MAX_METER_W),
    meterGlow: clamp(readNumber(meter.glow, 6), 0, MAX_GLOW),
  }
}

/**
 * 摊出这一块的 CSS 变量。
 * @param config 该节点落库的配置
 * @param nums 已夹取的尺寸
 * @param meter 进度件那一簇的原值
 */
function cssVars(
  config: Record<string, unknown>,
  nums: ListNums,
  meter: Record<string, unknown>,
): ListVars {
  const tone = readEnum(config.labelTone, LIST_LABEL_TONE_VALUES, 'secondary')
  const valueColor = readTrimmedText(config.valueColor)
  const meterColor = readTrimmedText(meter.color)
  const vars: ListVars = {
    '--il-pad-x': `${nums.padX}px`,
    '--il-pad-y': `${nums.padY}px`,
    '--il-row-px': `${nums.rowPadX}px`,
    '--il-row-py': `${nums.rowPadY}px`,
    '--il-label-size': `${nums.labelSize}px`,
    '--il-label-color': LIST_LABEL_TONE_COLORS[tone],
    '--il-value-size': `${nums.valueSize}px`,
    '--il-unit-size': `${nums.unitSize}px`,
    '--il-meter-h': `${nums.meterHeight}px`,
    '--il-meter-w': nums.meterWidth === 0 ? '100%' : `${nums.meterWidth}px`,
    '--il-cols-tpl': columnsTemplate(nums.unitSize),
  }
  // 以下四项「没配 = 不写键」：注入了就再也回落不到 _variants.scss 里的档位缺省
  if (valueColor !== '') vars['--il-value-color'] = valueColor
  if (nums.valueGlow > 0) vars['--il-value-glow'] = `${nums.valueGlow}px`
  if (meterColor !== '') vars['--il-meter-color'] = meterColor
  if (nums.meterGlow > 0) vars['--il-meter-glow'] = `${nums.meterGlow}px`
  return vars
}

/**
 * 一档一个修饰类；同一份类名既挂在列表根上也挂在每一行上，表头与行因此吃同一套档位。
 * @param config 该节点落库的配置
 * @param meter 进度件那一簇的原值
 */
function classesOf(
  config: Record<string, unknown>,
  meter: Record<string, unknown>,
): string[] {
  const badge = readRecord(config.badge)
  const classes = [
    `il--layout-${readEnum(config.rowLayout, LIST_ROW_LAYOUT_VALUES, 'stack')}`,
    `il--shell-${readEnum(config.rowShell, LIST_ROW_SHELL_VALUES, 'divider')}`,
    `il--divider-${readEnum(config.dividerStyle, LIST_DIVIDER_STYLE_VALUES, 'dotted')}`,
    `il--hover-${readEnum(config.hover, LIST_HOVER_VALUES, 'none')}`,
    `il--unit-${readEnum(config.unitPlace, LIST_UNIT_PLACE_VALUES, 'attached')}`,
    `il--badge-${readEnum(badge.style, LIST_BADGE_STYLE_VALUES, 'outline')}`,
    `il--group-${readEnum(config.grouping, LIST_GROUPING_VALUES, 'none')}`,
  ]
  if (readBoolean(meter.dot)) classes.push('il--meter-dot')
  return classes
}

/** 一段的四个件；`v-for` 的键带上位次与件名，删中间一段时其余不错位。 */
function toLine(raw: unknown, index: number): RowLine {
  const row = readRecord(raw)
  const left = readEnum(row.left, LIST_SEGMENT_VALUES, 'none')
  const left2 = readEnum(row.left2, LIST_SEGMENT_VALUES, 'none')
  const right = readEnum(row.right, LIST_SEGMENT_VALUES, 'none')
  const right2 = readEnum(row.right2, LIST_SEGMENT_VALUES, 'none')
  return {
    key: `${index}:${left}|${left2}|${right}|${right2}`,
    left,
    left2,
    right,
    right2,
  }
}

/** 四件全空的段不渲染——留着它就是一条撑高行高的空白。 */
function hasSegment(line: RowLine): boolean {
  return (
    line.left !== 'none' ||
    line.left2 !== 'none' ||
    line.right !== 'none' ||
    line.right2 !== 'none'
  )
}

/**
 * 行内最多三段。
 * @param config 该节点落库的配置
 */
function readLines(config: Record<string, unknown>): RowLine[] {
  const raw = config.rowLines
  const rows = Array.isArray(raw) ? raw.slice(0, MAX_ROW_LINES) : []
  return rows.map(toLine).filter(hasSegment)
}

/**
 * 前导列、两个尾列与扩展指标行。
 * @param config 该节点落库的配置
 */
function readShape(config: Record<string, unknown>): RowShape {
  const shape = readRecord(config.rowShape)
  return {
    lead: readEnum(shape.lead, LIST_LEAD_VALUES, 'none'),
    tail: readEnum(shape.tail, LIST_TAIL_VALUES, 'none'),
    tail2: readEnum(shape.tail2, LIST_TAIL_VALUES, 'none'),
    extras: readBoolean(shape.extras),
  }
}

/**
 * 表头行。
 * @param config 该节点落库的配置
 */
function readHeader(config: Record<string, unknown>): ColumnHeader {
  const header = readRecord(config.columnHeader)
  const layout = readEnum(config.rowLayout, LIST_ROW_LAYOUT_VALUES, 'stack')
  return {
    show: layout === 'columns' && readBoolean(header.show),
    name: headerText(header.name, '名称'),
    value: headerText(header.value, '数值'),
    unit: headerText(header.unit, '单位'),
  }
}

/**
 * 两条进度条的选源与小字。
 * @param meter 进度件那一簇的原值
 */
function readMeter(meter: Record<string, unknown>): MeterLook {
  return {
    kind: readEnum(meter.kind, LIST_METER_KIND_VALUES, 'none'),
    source: readEnum(meter.source, LIST_METER_SOURCE_VALUES, 'range'),
    label: readTrimmedText(meter.label),
    source2: readEnum(meter.source2, LIST_METER_SOURCE2_VALUES, 'none'),
    label2: readTrimmedText(meter.label2),
    dot: readBoolean(meter.dot),
    showPercent: readBoolean(meter.showPercent, true),
  }
}

/**
 * 徽章那一簇。
 * @param config 该节点落库的配置
 */
function readBadge(config: Record<string, unknown>): BadgeLook {
  const badge = readRecord(config.badge)
  return {
    kind: readEnum(badge.kind, LIST_BADGE_KIND_VALUES, 'none'),
    style: readEnum(badge.style, LIST_BADGE_STYLE_VALUES, 'outline'),
  }
}

/**
 * 读一块列表的形态。
 * @param config 该节点落库的配置（已铺清单缺省）
 */
export function readListLook(config: Record<string, unknown>): ListLook {
  const meter = readRecord(config.meter)
  const nums = readNums(config, meter)
  return {
    classes: classesOf(config, meter),
    vars: cssVars(config, nums, meter),
    nums,
    lines: readLines(config),
    shape: readShape(config),
    header: readHeader(config),
    meter: readMeter(meter),
    badge: readBadge(config),
    grouping: readEnum(config.grouping, LIST_GROUPING_VALUES, 'none'),
  }
}
