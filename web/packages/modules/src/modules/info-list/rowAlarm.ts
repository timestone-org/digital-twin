/**
 * @fileoverview info-list 行上那几件由「值」驱动的东西：徽章、告警态与两条进度条的百分比。
 *
 * ⚠ 行的告警态是叠在 `rowShell` 之上的一层修饰，不是第六档外壳：做成外壳档的话，
 * 一个既要色边卡片又要报警呼吸的列表就得二选一（MODULE_INFO_CARD_DESIGN §5.2）。
 * ⚠ 判据按 `badge.kind` 分两路：接了设备状态槽的看状态，其余的看规则——否则一个不接
 * 设备状态的列表永远亮不起来。
 */
import type { CSSProperties } from 'vue'

import { fmtTrim, NO_DATA } from '../../shared/format'
import { toDeviceStatus, type DeviceStatus } from '../../shared/status'
import { isAlarmLevel, levelColor } from '../../shared/thresholds'

import type { BadgeLook, MeterLook } from './look'
import { LEVEL_TEXT, type ListMeterSource2 } from './options'
import type { ValueHit } from './rules'

type IlBadgeVarName = '--il-badge-color'

/** 逐个徽章注入的 CSS 变量；实心档要同时用到「底色」与「压在底色上的字色」。 */
export type ListBadgeVars = CSSProperties &
  Partial<Record<IlBadgeVarName, string>>

/** 徽章变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const IL_BADGE_VAR_NAMES: readonly IlBadgeVarName[] = [
  '--il-badge-color',
]

/** 一个徽章要画的东西。 */
export interface BadgeView {
  /** `none` = 这一行不画徽章。 */
  kind: BadgeLook['kind']
  /** `device` 档的设备状态，直接喂 StatusBadge；其余档 `null`。 */
  status: DeviceStatus | null
  /** `severity` / `rule` 档的文字；`device` 档空串——文案由 StatusBadge 自己给。 */
  text: string
  /** 文字与描边的颜色；`device` 档空串。 */
  color: string
  /** 注入到徽章元素上的变量；`device` 与不画那两档是空对象。 */
  vars: ListBadgeVars
}

/** 一条进度条要画的东西。 */
export interface MeterView {
  /** 画不画这一条。 */
  show: boolean
  /** 条前面那个小字，空串 = 不画。 */
  label: string
  /** 「xx%」读数；关掉读数或算不出时是空串 / 占位符。 */
  text: string
  /** 填充宽度，形如 `'42.0%'`；空串 = 整条填充不渲染。 */
  fill: string
}

/** 一行算百分比要用到的数。 */
export interface MeterInput {
  value: number | null
  aux: number | null
  aux2: number | null
  aux3: number | null
  /** 行内量程，`range` 档的分母来源；任一缺席即算不出。 */
  min: number | null
  max: number | null
  /** 全表正数合计，`share` 档的分母；≤0 表示算不出占比。 */
  shareBasis: number
  /** 全表有没有任何一行拿到主读数。 */
  anyValue: boolean
}

/** 造一条进度条要的全部输入。 */
export interface MeterBuild {
  meter: MeterLook
  /** 这一条取哪一路；`none` = 不画。 */
  source: ListMeterSource2
  label: string
  input: MeterInput
}

/** 造一个徽章要的全部输入。 */
export interface BadgeBuild {
  look: BadgeLook
  /** `device` 档的状态槽原值。 */
  status: unknown
  /** `alarmOn` 指的那个读数命中的规则。 */
  hit: ValueHit | null
}

const FULL_PERCENT = 100

const EMPTY_BADGE: BadgeView = {
  kind: 'none',
  status: null,
  text: '',
  color: '',
  vars: {},
}

const EMPTY_METER: MeterView = { show: false, label: '', text: '', fill: '' }

/** 三个副读数槽按名字取值，其余档给 null。 */
function auxOf(source: string, input: MeterInput): number | null {
  if (source === 'aux') return input.aux
  if (source === 'aux2') return input.aux2
  return source === 'aux3' ? input.aux3 : null
}

/** 量程占比：分母 ≤0 或任一缺值 → null（不产生 Infinity / NaN）。可以 >100。 */
function rangePercent(input: MeterInput): number | null {
  const { value, min, max } = input
  if (value === null || min === null || max === null || max <= min) return null
  return ((value - min) / (max - min)) * FULL_PERCENT
}

/**
 * 全表占比：分母是**全部行**的正数合计。
 * ⚠ 真实 0 与负数一律算 0% 而不是算不出：那一行确实没有贡献，不是没有数据。
 */
function sharePercent(input: MeterInput): number | null {
  const { value, shareBasis, anyValue } = input
  if (value === null || !anyValue) return null
  if (value <= 0) return 0
  return shareBasis > 0 ? (value / shareBasis) * FULL_PERCENT : 0
}

/**
 * 这一条进度条的百分比；算不出给 null。
 * @param source 取哪一路
 * @param input 这一行的取值与全表分母
 */
export function meterPercent(
  source: ListMeterSource2,
  input: MeterInput,
): number | null {
  if (source === 'range') return rangePercent(input)
  if (source === 'share') return sharePercent(input)
  return auxOf(source, input)
}

/** 百分比读数；算不出给「—」。 */
function percentText(pct: number | null): string {
  return pct === null ? NO_DATA : `${fmtTrim(pct, 2)}%`
}

/**
 * 填充宽度。
 * ⚠ 0% 与算不出都返回空串让整条填充不渲染：填充件带着圆角与辉光，
 * 宽度 0 仍会在真实 0% 的行上留一小截色块，读起来像「有一点点」。
 * ⚠ 读数不夹、只夹几何：完成率显 120% 是诚实的，条却不该溢出轨道。
 */
function fillWidth(pct: number | null): string {
  if (pct === null || pct <= 0) return ''
  return `${Math.min(FULL_PERCENT, pct).toFixed(1)}%`
}

/**
 * 造一条进度条。
 * @param build 样式簇、这一条的选源与小字，以及这一行的取值
 */
export function buildMeter(build: MeterBuild): MeterView {
  if (build.meter.kind === 'none' || build.source === 'none') return EMPTY_METER
  const pct = meterPercent(build.source, build.input)
  return {
    show: true,
    label: build.label,
    text: build.meter.showPercent ? percentText(pct) : '',
    fill: fillWidth(pct),
  }
}

/** 有词有色的那两档：颜色同时进 `color` 与变量，实心档靠变量画底。 */
function painted(
  kind: BadgeLook['kind'],
  text: string,
  color: string,
): BadgeView {
  return {
    kind,
    status: null,
    text,
    color,
    vars: { '--il-badge-color': color },
  }
}

/**
 * 造一个徽章。
 * ⚠ `severity` 用的是**该 level 的语义色**而不是规则自己的颜色：严重度那一列说的是
 * 「有多严重」，让它跟着能源类型色走就再也读不出严重度了。
 * @param build 徽章簇、设备状态槽原值与命中的规则
 */
export function buildBadge(build: BadgeBuild): BadgeView {
  const { kind } = build.look
  if (kind === 'device') {
    return { ...EMPTY_BADGE, kind, status: toDeviceStatus(build.status) }
  }
  const hit = build.hit
  if (kind === 'none' || hit === null) return EMPTY_BADGE
  if (kind === 'severity') {
    return painted(kind, LEVEL_TEXT[hit.level], levelColor(hit.level))
  }
  // 规则档没写文案就没有词可画，一个空框比不画更糟
  if (hit.label === '') return EMPTY_BADGE
  return painted(kind, hit.label, hit.color)
}

/**
 * 这一行报不报警。
 * @param build 徽章簇、设备状态槽原值与命中的规则
 */
export function isRowAlarming(build: BadgeBuild): boolean {
  if (build.look.kind === 'device') {
    return toDeviceStatus(build.status) === 'alarm'
  }
  return build.hit !== null && isAlarmLevel(build.hit.level)
}
