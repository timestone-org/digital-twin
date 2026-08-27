/**
 * @fileoverview gauge-card 一个仪表的全部取值：四档状态、量程 → 百分比 → 填充这条链、
 * 值规则命中、刻度与目标标记的落点与文案，最后收成一份纯数据的 `GaugeView[]`。
 * 纯函数，不碰 DOM（MODULE_INFO_CARD_DESIGN §4.2 / §6.3）。
 *
 * ⚠ 四档在 `values` 里长得一模一样（键都不存在），全靠 `meta.slots` 分开——合成一档的
 * 代价是现场断了的那一个与从没配过的那一个在墙上是同一个「—」。
 * ⚠ 没配来源与等首帧显示的是**同一个**占位符，只靠颜色与透明度分开（`GAUGE_STATE_CLASS`
 * 那四个类），完整原因挂 `title`。
 * ⚠ 画什么按「含不含实时读数」分：**只由量程与配置推出来的**（量程端点、刻度、目标标记）
 * 四档都画——它们是表盘本身；**含实时读数的**（填充、轨道内 pill、单位）只在 `ok` 档画，
 * 因为「— kV」与一条填了一点的轨道看着都像有读数。
 * ⚠ 「万」格式的门槛是**逐个仪表**判的（量程上界在这里是行内字段），量程上界不到一万时
 * 这一个仪表整体回落原始格式：小量程走万会让刻度全塌成「0.0万」、pill 显「0.01万」。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import type { CSSProperties } from 'vue'

import {
  readArray,
  readBoolean,
  readEnum,
  readLooseNumber,
  readNumber,
  readRecord,
  readText,
  readTrimmedText,
} from '../../shared/config'
import {
  fmtDecimal,
  fmtNumber,
  fmtTrim,
  isPresent,
  NO_DATA,
} from '../../shared/format'

import {
  arcDashOffset,
  completionPercent,
  fillPercent,
  GAUGE_TICK_COUNT_DEFAULT,
  isFillVisible,
  labelAnchorShift,
  normalizePercent,
  tickPercents,
  type GaugeLabelShift,
} from './geometry'
import { GAUGE_READOUT_VALUES, type GaugeReadout } from './options'
import {
  evaluateValueRules,
  normalizeValueRules,
  type ValueHit,
  type ValueRule,
} from './rules'

/**
 * 仪表读数的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const GAUGE_SLOT_KEY = 'gaugeValues'

/** 仪表列表的配置键。 */
export const GAUGE_ITEMS_KEY = 'items'

/**
 * 一个仪表的两个子槽。
 * ⚠ `aux` 是**目标值的实时来源**：绑了就顶掉行内那个静态 `target`，两者都缺才不画目标
 * 标记。加子槽不改行数，只让绑点面板那份平铺变长。
 */
export const GAUGE_SLOT_FIELDS = ['value', 'aux'] as const
export type GaugeSlotField = (typeof GAUGE_SLOT_FIELDS)[number]

/**
 * 一个仪表此刻处在哪一档。
 * ⚠ `unbound` 与 `pending` 必须分开：前者要去配绑定，后者只要再等一会儿。
 */
export const GAUGE_STATES = ['ok', 'pending', 'error', 'unbound'] as const
export type GaugeState = (typeof GAUGE_STATES)[number]

/** 各档没有值时给看的人的一句话，鼠标停上去才看得全。 */
export const GAUGE_REASONS: Record<Exclude<GaugeState, 'ok'>, string> = {
  unbound: '这个仪表还没绑定数据来源',
  pending: '已绑定，还没收到第一帧',
  error: '取不到',
}

/**
 * 读数四档各自的修饰类。
 * ⚠ 四档的占位符是同一个字，屏上全靠这几个类给的颜色与透明度分开；类名一处写死而不是
 * 模板现拼，是因为拼错了既不报错也不生效。
 */
export const GAUGE_STATE_CLASS: Record<GaugeState, string> = {
  ok: '',
  pending: 'gc-value--pending',
  error: 'gc-value--error',
  unbound: 'gc-value--unbound',
}

/** 「万」的门槛，也是量程上界够不够格走那一档的判据。 */
const WAN = 10000

/** 完成率固定一位小数，与参考仓 target-progress 的 `pct.toFixed(1)` 同口径。 */
const SHARE_DIGITS = 1

const MAX_PRECISION = 6

type GcItemVarName = '--gc-item-color'

/** 逐个仪表注入的 CSS 变量；样式表只认变量，不认取值口径。 */
export type GaugeItemVars = CSSProperties &
  Partial<Record<GcItemVarName, string>>

/** 逐个仪表的变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const GC_ITEM_VAR_NAMES: readonly GcItemVarName[] = ['--gc-item-color']

/** 归一化后的一个仪表的配置。 */
export interface GaugeItem {
  /** ⚠ 空串 = 这个仪表不画标签：档位类名也跟着不挂。 */
  label: string
  /** ⚠ 不 trim：`'° C'` 这类带空格是用户显式的排版意图。 */
  unit: string
  precision: number
  min: number
  max: number
  /** ⚠ 留空 = 不画目标标记、完成率退回量程口径；`readLooseNumber` 收数字字符串。 */
  target: number | null
  /** 逐个仪表的静态色，填了就压过模块的填充色。 */
  color: string
  /** 联动上抛的值；空串 = 这一个点了不上抛。 */
  emitValue: string
}

/** 量程端点两个字。 */
export interface GaugeRange {
  min: string
  max: string
}

/** 一根刻度：落点、文案，与贴边时换掉的那个对齐基准。 */
export interface GaugeTick {
  key: string
  percent: number
  label: string
  shift: GaugeLabelShift
}

/** 虚线目标标记与它上方那个标签。 */
export interface GaugeTargetMark {
  percent: number
  label: string
  shift: GaugeLabelShift
}

/** 一个仪表要画的全部东西。 */
export interface GaugeView {
  /** `v-for` 的键：仪表签名，配置重排时同一逻辑仪表的键不变。 */
  key: string
  /** 文档序下标，取绑定槽与派生行都用它。 */
  index: number
  state: GaugeState
  /** 这一个为什么没有值，一句完整的话，挂 `title`；`ok` 档是空串。 */
  reason: string
  /** 标签的字：命中文案优先，其次行内标签；空串 = 整行不渲染。 */
  label: string
  /** 标签画的是命中文案，颜色跟着这个仪表的填充色走。 */
  labelIsHit: boolean
  /** 主读数；`readout: 'none'` 且有值时是空串，没有值时仍给占位符。 */
  text: string
  /** 跟在单位之后的那一小段完成率，只有 `both` 档有。 */
  percentText: string
  /** ⚠ 非 `ok` 档一律空串——「— kV」看着像是有读数的。 */
  unit: string
  /** 量程百分比，`null` = 没有读数；刻度与填充都从它来。 */
  percent: number | null
  /** 填充的长度，形如 `'42%'`；⚠ 空串 = **整条不渲染**，真实 0% 也不留那一小截辉光。 */
  fill: string
  /** 弧填充的 `stroke-dashoffset`，配 `pathLength="100"`。 */
  dashOffset: number
  range: GaugeRange | null
  ticks: GaugeTick[]
  target: GaugeTargetMark | null
  /** 轨道内 pill 的文本；空串 = 不画。 */
  pillText: string
  blink: boolean
  emitValue: string
  vars: GaugeItemVars
}

/** 组装一整块要用到的输入。 */
export interface GaugeViewsInput {
  config: Record<string, unknown>
  /** `values[GAUGE_SLOT_KEY]` 的原值，正常是一个仪表数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
}

/** 刻度、量程端点与「万」格式那一簇。 */
interface ScaleLook {
  showRange: boolean
  ticks: boolean
  tickCount: number
  wanFormat: boolean
  wanDigits: number
}

/** 逐个仪表算出来的量程口径，文案与落点都读它。 */
interface GaugeScale {
  min: number
  max: number
  /** 「万」格式此刻生不生效：量程上界不到一万时这一个仪表整体回落。 */
  wan: boolean
  wanDigits: number
  precision: number
  grouping: boolean
}

interface GaugeContext {
  raws: readonly unknown[]
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
  hasSlots: boolean
  rules: readonly ValueRule[]
  emptyText: string
  readout: GaugeReadout
  /** 数值要不要千分位。 */
  grouping: boolean
  scale: ScaleLook
  targetMark: boolean
  targetLabel: string
  /** 轨道内 pill 要不要带完成率。 */
  showPercent: boolean
  seen: Map<string, number>
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 第 index 个仪表第 field 个子槽的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表。
 * @param index 归一化后的下标
 * @param field 子槽名
 */
export function gaugeFieldKey(index: number, field: GaugeSlotField): string {
  return `${GAUGE_SLOT_KEY}[${index}].${field}`
}

/**
 * 把配置里的一行规整成一个仪表。缺什么补什么，不丢行。
 * ⚠ 脏行不丢、只补默认：丢一行会让它之后每一条绑定改喂另一个仪表，而绑定的 `fieldKey`
 * 是按下标拼的。
 * ⚠ 量程与目标一律 `readLooseNumber`：这三个字段刻意没有清单缺省（留空 = 不画目标
 * 标记），而 JSON 导入里的 `'80'` 在 `readNumber` 眼里不是数，会被静默丢掉——表现是
 * 完成率口径悄悄从「值 ÷ 目标」退化成「量程占比」。
 * @param raw 配置数组里的一行
 */
function toItem(raw: unknown): GaugeItem {
  const row = readRecord(raw)
  return {
    label: readTrimmedText(row.label),
    unit: readText(row.unit),
    precision: clamp(
      Math.round(readNumber(row.precision, 0)),
      0,
      MAX_PRECISION,
    ),
    min: readLooseNumber(row.min) ?? 0,
    max: readLooseNumber(row.max) ?? 100,
    target: readLooseNumber(row.target),
    color: readTrimmedText(row.color),
    emitValue: readTrimmedText(row.emitValue),
  }
}

/**
 * 仪表列表的归一化。
 * @param raw `config[GAUGE_ITEMS_KEY]` 的原值
 */
export function readGaugeItems(raw: unknown): GaugeItem[] {
  return readArray(raw).map(toItem)
}

/**
 * 这一个仪表落在哪一档。
 * @param slot 这一槽的取数结论
 * @param raw 注入袋里这一个的原值
 * @param hasSlots 运行时下发了逐槽结论没有
 */
export function gaugeState(
  slot: ModuleSlotMeta | undefined,
  raw: unknown,
  hasSlots: boolean,
): GaugeState {
  if (slot !== undefined) return slot.state
  // ⚠ 没下发结论时只能退回「有没有值」这一条判据：设计态画布与独立挂载走这里。
  //   此时把没有值一律说成 unbound 是诚实的——那两处本来就没有取数
  if (!hasSlots) return raw === undefined ? 'unbound' : 'ok'
  return 'unbound'
}

/**
 * 没有值的那一句话；`error` 档带上取数侧给的原因。
 * @param state 这一个所在的档
 * @param slot 这一槽的取数结论
 */
export function reasonOf(
  state: GaugeState,
  slot: ModuleSlotMeta | undefined,
): string {
  if (state === 'ok') return ''
  const base = GAUGE_REASONS[state]
  const detail = slot?.message ?? ''
  return detail === '' ? base : `${base}：${detail}`
}

/**
 * 这一个仪表的量程口径。
 * @param item 归一化后的这一个仪表
 * @param ctx 整块共用的展示口径
 */
function scaleOf(item: GaugeItem, ctx: GaugeContext): GaugeScale {
  return {
    min: item.min,
    max: item.max,
    wan: ctx.scale.wanFormat && item.max >= WAN,
    wanDigits: ctx.scale.wanDigits,
    precision: item.precision,
    grouping: ctx.grouping,
  }
}

/**
 * 读数、目标与 pill 共用的数字文案：按「万」，或按小数位与千分位。
 * @param value 要写出来的原值
 * @param scale 这一个仪表的量程口径
 */
function scaleText(value: number, scale: GaugeScale): string {
  if (scale.wan) return `${fmtDecimal(value / WAN, scale.wanDigits)}万`
  return scale.grouping
    ? fmtNumber(value, scale.precision)
    : fmtTrim(value, scale.precision)
}

/**
 * 刻度文案：整数，或「万」。
 * ⚠ 「万」的小数位与 pill 共用 `scale.wanDigits`（MODULE_INFO_CARD_DESIGN §10.7）：
 * 参考仓刻度写死 1 位而 pill 另有一档，同一张卡上两套口径。
 * @param value 刻度处的量程值
 * @param scale 这一个仪表的量程口径
 */
function tickText(value: number, scale: GaugeScale): string {
  if (scale.wan) return `${fmtDecimal(value / WAN, scale.wanDigits)}万`
  return fmtNumber(value, 0)
}

/**
 * 主读数与跟在单位之后那一小段完成率。
 * ⚠ `percent` 档给的是**量程百分比**（钳在 0–100），不是完成率：完成率是「值 ÷ 目标」、
 * 可以超过 100%，只出现在轨道内那个 pill 上。同一张卡上两个「百分比」不是一个数。
 * @param raw 主读数原值
 * @param percent 量程百分比
 * @param scale 这一个仪表的量程口径
 * @param ctx 整块共用的展示口径
 */
function readoutOf(
  raw: unknown,
  percent: number | null,
  scale: GaugeScale,
  ctx: GaugeContext,
): { text: string; percentText: string } {
  if (!isPresent(raw)) return { text: ctx.emptyText, percentText: '' }
  if (ctx.readout === 'none') return { text: '', percentText: '' }
  const share = `${fmtTrim(percent, scale.precision)}%`
  if (ctx.readout === 'percent') return { text: share, percentText: '' }
  return {
    text: scaleText(raw, scale),
    percentText: ctx.readout === 'both' ? `(${share})` : '',
  }
}

/**
 * 轨道内的 pill：读数 + 单位 +（开了完成率时）完成率。
 * @param raw 主读数原值
 * @param completion 完成率，`null` = 算不出
 * @param item 归一化后的这一个仪表
 * @param scale 这一个仪表的量程口径
 * @param ctx 整块共用的展示口径
 */
function pillTextOf(
  raw: unknown,
  completion: number | null,
  item: GaugeItem,
  scale: GaugeScale,
  ctx: GaugeContext,
): string {
  if (!isPresent(raw)) return ''
  const share =
    ctx.showPercent && completion !== null
      ? ` (${fmtDecimal(completion, SHARE_DIGITS)}%)`
      : ''
  return `${scaleText(raw, scale)}${item.unit}${share}`
}

/**
 * 等距刻度的落点与文案；关了刻度就一根都不给。
 * @param scale 这一个仪表的量程口径
 * @param ctx 整块共用的展示口径
 */
function ticksOf(scale: GaugeScale, ctx: GaugeContext): GaugeTick[] {
  if (!ctx.scale.ticks) return []
  const span = scale.max - scale.min
  return tickPercents(ctx.scale.tickCount).map((percent, index) => ({
    key: `tick-${String(index)}`,
    percent,
    label: tickText(scale.min + (span * percent) / 100, scale),
    shift: labelAnchorShift(percent),
  }))
}

/**
 * 虚线目标标记；没开开关、目标缺席或量程非法都不画。
 * @param target 目标值，绑定优先、缺则行内那个静态值
 * @param scale 这一个仪表的量程口径
 * @param ctx 整块共用的展示口径
 */
function targetOf(
  target: number | null,
  scale: GaugeScale,
  ctx: GaugeContext,
): GaugeTargetMark | null {
  if (!ctx.targetMark || target === null) return null
  const percent = normalizePercent(target, scale.min, scale.max)
  if (percent === null) return null
  return {
    percent,
    label: `${ctx.targetLabel}${scaleText(target, scale)}`,
    shift: labelAnchorShift(percent),
  }
}

/**
 * 量程端点两个字；关了开关不给。
 * ⚠ 它与刻度、目标标记一样只由量程推出来，所以四档都画——那是表盘本身，不是读数。
 * @param scale 这一个仪表的量程口径
 * @param ctx 整块共用的展示口径
 */
function rangeOf(scale: GaugeScale, ctx: GaugeContext): GaugeRange | null {
  if (!ctx.scale.showRange) return null
  return { min: scaleText(scale.min, scale), max: scaleText(scale.max, scale) }
}

/** 取第 index 个仪表某个子槽注入的原值；没有这一行给 undefined。 */
function rawAt(
  ctx: GaugeContext,
  index: number,
  field: GaugeSlotField,
): unknown {
  const row = ctx.raws[index]
  return row === undefined ? undefined : readRecord(row)[field]
}

function slotAt(
  ctx: GaugeContext,
  index: number,
  field: GaugeSlotField,
): ModuleSlotMeta | undefined {
  return ctx.slots?.[gaugeFieldKey(index, field)]
}

/**
 * 仪表签名：只由身份派生，不含实时值。
 * ⚠ 同签名的按出现序加后缀去重——两个完全同配置时仍得到不同的键。
 * @param item 归一化后的这一个仪表
 * @param ctx 整块共用的展示口径
 */
function gaugeKey(item: GaugeItem, ctx: GaugeContext): string {
  const signature = [item.emitValue, item.label, item.unit].join('␟')
  const seen = ctx.seen.get(signature) ?? 0
  ctx.seen.set(signature, seen + 1)
  return seen === 0 ? signature : `${signature}#${seen}`
}

/**
 * 标签的字：命中文案顶掉行内标签。
 * ⚠ 两者都空时给空串——整行不渲染，档位类名也不挂。
 * @param item 归一化后的这一个仪表
 * @param hit 命中的规则，`null` = 没命中
 */
function labelOf(
  item: GaugeItem,
  hit: ValueHit | null,
): { label: string; labelIsHit: boolean } {
  const text = hit?.label ?? ''
  if (text === '') return { label: item.label, labelIsHit: false }
  return { label: text, labelIsHit: true }
}

/**
 * 单位画不画。
 * ⚠ 只有主读数写出了原始值的两档才画：百分比没有 kV，而 `none` 档一个数都没写出来，
 * 单独挂一个「kV」在那儿看着像读数丢了。非 `ok` 档一律不画（「— kV」同理）。
 * @param state 这一个所在的档
 * @param ctx 整块共用的展示口径
 */
function showsUnit(state: GaugeState, ctx: GaugeContext): boolean {
  if (state !== 'ok') return false
  return ctx.readout === 'value' || ctx.readout === 'both'
}

/**
 * 目标值：绑定的 `aux` 顶掉行内那个静态值，两者都缺才不画标记。
 * @param bound `aux` 子槽注入的原值
 * @param item 归一化后的这一个仪表
 */
function targetValue(bound: unknown, item: GaugeItem): number | null {
  return isPresent(bound) ? bound : item.target
}

/**
 * 一个仪表的配置 + 两槽的结论 → 一个仪表。
 * @param item 归一化后的这一个仪表
 * @param index 文档序下标
 * @param ctx 整块共用的展示口径
 */
function toView(item: GaugeItem, index: number, ctx: GaugeContext): GaugeView {
  const raw = rawAt(ctx, index, 'value')
  const slot = slotAt(ctx, index, 'value')
  const state = gaugeState(slot, raw, ctx.hasSlots)
  const scale = scaleOf(item, ctx)
  const reading = state === 'ok' ? raw : undefined
  const percent = normalizePercent(reading, scale.min, scale.max)
  const hit = state === 'ok' ? evaluateValueRules(raw, ctx.rules) : null
  const override = hit?.color ?? item.color
  const target = targetValue(rawAt(ctx, index, 'aux'), item)
  return {
    key: gaugeKey(item, ctx),
    index,
    state,
    reason: reasonOf(state, slot),
    ...labelOf(item, hit),
    ...readoutOf(reading, percent, scale, ctx),
    unit: showsUnit(state, ctx) ? item.unit : '',
    percent,
    fill: isFillVisible(percent) ? `${fillPercent(percent)}%` : '',
    dashOffset: arcDashOffset(percent),
    range: rangeOf(scale, ctx),
    ticks: ticksOf(scale, ctx),
    target: targetOf(target, scale, ctx),
    pillText: pillTextOf(
      reading,
      completionPercent(reading, target, percent),
      item,
      scale,
      ctx,
    ),
    blink: hit?.blink ?? false,
    emitValue: item.emitValue,
    vars: override === '' ? {} : { '--gc-item-color': override },
  }
}

/**
 * 刻度那一簇。
 * @param config 该节点落库的配置
 */
function readScale(config: Record<string, unknown>): ScaleLook {
  const scale = readRecord(config.scale)
  return {
    showRange: readBoolean(scale.showRange),
    ticks: readBoolean(scale.ticks),
    tickCount: readNumber(scale.tickCount, GAUGE_TICK_COUNT_DEFAULT),
    wanFormat: readBoolean(scale.wanFormat),
    wanDigits: readNumber(scale.wanDigits, 2),
  }
}

/**
 * 整块共用的展示口径。
 * @param input 配置、注入袋与逐槽结论
 */
function gaugeContext(input: GaugeViewsInput): GaugeContext {
  const config = input.config
  return {
    raws: readArray(input.rows),
    slots: input.slots,
    hasSlots: input.slots !== undefined,
    rules: normalizeValueRules(config.rules),
    emptyText: readTrimmedText(config.emptyText) || NO_DATA,
    readout: readEnum(config.readout, GAUGE_READOUT_VALUES, 'value'),
    grouping: readBoolean(config.thousands, true),
    scale: readScale(config),
    targetMark: readBoolean(config.targetMark),
    targetLabel: readTrimmedText(config.targetLabel, '计划'),
    showPercent: readBoolean(config.showPercent, true),
    seen: new Map<string, number>(),
  }
}

/**
 * 摊出整块要画的仪表，文档序。
 * @param input 配置、注入袋与逐槽结论
 */
export function buildGaugeViews(input: GaugeViewsInput): GaugeView[] {
  const items = readGaugeItems(input.config[GAUGE_ITEMS_KEY])
  const ctx = gaugeContext(input)
  return items.map((item, index) => toView(item, index, ctx))
}
