/**
 * @fileoverview info-list 的行数据组装：把「一行配置 + 这一行各槽的取数结论」算成一行要画的
 * 全部东西（读数、副读数、徽章、两条进度条、扩展指标、时刻、告警态与联动值），再按筛选、
 * 迟滞与排序选出真正上墙的那些。纯函数，不碰 DOM。
 *
 * ⚠ 迟滞只出纯函数与一个可显式 dispose 的句柄，**定时器的持有与释放都在 `Component.vue`**：
 * `check_ts_style.py` 的卸载清理闸只扫 `.vue` 与 `use*.ts`，把 `setTimeout` 放进这里等于
 * 让那条闸对它永久失效（MODULE_INFO_CARD_DESIGN §2.5）。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import type { CSSProperties } from 'vue'

import { resolveImageValue } from '../../shared/assetImage'
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
import { fmtClock, fmtTrim, isPresent, toNumOrNull } from '../../shared/format'
import {
  isAlarmLevel,
  SEVERITY_RANK,
  type ThresholdLevel,
} from '../../shared/thresholds'

import type { ListLook } from './look'
import {
  LIST_ALARM_ON_VALUES,
  LIST_ROW_FILTER_VALUES,
  LIST_ROW_SORT_VALUES,
  LIST_SUB_SOURCE_VALUES,
  LIST_TIME_SOURCE_VALUES,
  type ListAlarmOn,
  type ListRowFilter,
  type ListRowSort,
  type ListSubSource,
  type ListTimeSource,
} from './options'
import {
  buildBadge,
  buildMeter,
  isRowAlarming,
  type BadgeBuild,
  type BadgeView,
  type MeterInput,
  type MeterView,
} from './rowAlarm'
import {
  absentReading,
  readingOf,
  numberText,
  type ReadingView,
} from './rowValue'
import {
  evaluateValueRules,
  normalizeValueRules,
  type ValueHit,
  type ValueRule,
} from './rules'

/**
 * 行读数的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const LIST_SLOT_KEY = 'listValues'

/** 行列表的配置键。 */
export const LIST_ITEMS_KEY = 'items'

/** 一行里的 11 个子槽。加子槽不改行数，只让绑点面板那份「行 × 子槽」的平铺变长。 */
export const LIST_SLOT_FIELDS = [
  'value',
  'aux',
  'aux2',
  'aux3',
  'status',
  'name',
  'text',
  'time',
  'extra1',
  'extra2',
  'extra3',
] as const
export type ListSlotField = (typeof LIST_SLOT_FIELDS)[number]

/** 扩展指标行最多三格，逐格对应一个扩展槽。 */
export const MAX_EXTRAS = 3

const EXTRA_FIELDS = ['extra1', 'extra2', 'extra3'] as const

const MAX_PRECISION = 6
const MAX_HOLD_SECONDS = 300
const SECOND_MS = 1000

/** 没命中任何规则的行排在最后；`SEVERITY_RANK` 最小的是 0。 */
const NO_RANK = -1

type IlRowVarName = '--il-row-color' | '--il-hit-color'

/** 逐行注入的 CSS 变量；样式表只认变量，不认取值口径。 */
export type ListRowVars = CSSProperties & Partial<Record<IlRowVarName, string>>

/** 逐行变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const IL_ROW_VAR_NAMES: readonly IlRowVarName[] = [
  '--il-row-color',
  '--il-hit-color',
]

/** 归一化后的一行配置。 */
export interface ListItem {
  label: string
  /** ⚠ 不 trim：`'° C'` 这类带空格是用户显式的排版意图。 */
  unit: string
  precision: number
  tag: string
  group: string
  /** 逐行静态色，填了就压过命中色去染这一行的图标、色边与进度条。 */
  color: string
  /** 已解析的图标地址；空串 = 不画图。 */
  icon: string
  /** 行内量程，`meter.source: 'range'` 的分子分母；`null` = 不判。 */
  min: number | null
  max: number | null
  /** 行内目标值，`subSource: 'target'` 那一档取它；`null` = 不画。 */
  target: number | null
  desc: string
  /** 联动上抛的值；空串 = 这一行点了不上抛。 */
  emitValue: string
}

/** 扩展指标行的一格：整块声明，逐行取值。 */
export interface ExtraSpec {
  label: string
  unit: string
  precision: number
}

/** 扩展指标行上真的画出来的一格。 */
export interface ExtraView {
  key: string
  label: string
  text: string
  unit: string
}

/** 一行要画的全部东西。 */
export interface ListRow {
  /** `v-for` 的键：行签名，配置重排时同一逻辑行的键不变。 */
  key: string
  /** 文档序下标，`rowSort` 同级稳定排序与派生绑定行都用它。 */
  index: number
  label: string
  group: string
  tag: string
  desc: string
  /** 时刻文本；`alarmSince` 那一档由 `selectRows` 按迟滞里的起始时刻补上。 */
  time: string
  /** 已解析的图标地址；空串 = 回退圆点。 */
  icon: string
  value: ReadingView
  sub: ReadingView
  /** 副读数前面的小字，空串 = 不画。 */
  subLabel: string
  badge: BadgeView
  meter: MeterView
  meter2: MeterView
  extras: ExtraView[]
  /** 命中规则的文案；没命中是空串。 */
  alarmText: string
  level: ThresholdLevel | null
  /** 严重度权重，没命中是 -1。 */
  rank: number
  blink: boolean
  /** 行的告警态，叠在 `rowShell` 之上的一层修饰。 */
  isAlarm: boolean
  emitValue: string
  vars: ListRowVars
}

/** 组装一整块的行要用到的输入。 */
export interface ListRowsInput {
  config: Record<string, unknown>
  /** `values[LIST_SLOT_KEY]` 的原值，正常是一个行数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
  look: ListLook
}

/** 筛选、排序、时刻来源与迟滞四个旋钮，Component 拿它驱动迟滞与选行。 */
export interface ListPolicy {
  filter: ListRowFilter
  sort: ListRowSort
  timeSource: ListTimeSource
  /** 迟滞毫秒；0 = 关。 */
  holdMs: number
}

/** 一行在迟滞表里的状态。 */
export interface HoldEntry {
  key: string
  /** 这一行第一次命中的时刻，UTC 毫秒；持续命中期间不变。 */
  since: number
  active: boolean
}

/** 一次迟滞缝合的结论。 */
export interface HoldResult {
  entries: HoldEntry[]
  /** 距下一条待清行到期还有多少毫秒；`null` = 没有待清行，不用设定时器。 */
  nextWakeMs: number | null
}

/** 迟滞句柄。⚠ 定时器不在这里，持有与释放都在 `Component.vue`。 */
export interface HoldStore {
  reconcile(
    activeKeys: readonly string[],
    nowMs: number,
    holdMs: number,
  ): HoldResult
  /** 丢掉全部起始时刻。 */
  dispose(): void
}

/** 选出真正上墙的那些行要用到的输入。 */
export interface ListView {
  /** 迟滞之后仍在场的行键。 */
  keys: readonly string[]
  /** 行键 → 告警起始时刻，UTC 毫秒。 */
  since: Readonly<Record<string, number>>
  sort: ListRowSort
  timeSource: ListTimeSource
}

/** 空态那一句话要用到的输入。 */
export interface ListEmptyInput {
  config: Record<string, unknown>
  /** 全量行，文档序。 */
  rows: readonly ListRow[]
  /** 筛选与迟滞之后还剩几行。 */
  shown: number
}

interface RowContext {
  raws: readonly unknown[]
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
  hasSlots: boolean
  look: ListLook
  rules: readonly ValueRule[]
  extras: readonly ExtraSpec[]
  subSource: ListSubSource
  subLabel: string
  alarmOn: ListAlarmOn
  timeSource: ListTimeSource
  grouping: boolean
  shareBasis: number
  anyValue: boolean
  seen: Map<string, number>
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

// `./rows` 是这一族的对外面：组件只从这里取行视图的类型，不必知道它落在哪个文件
export { CELL_STATES, type CellState, type ReadingView } from './rowValue'
export {
  IL_BADGE_VAR_NAMES,
  type BadgeView,
  type ListBadgeVars,
  type MeterView,
} from './rowAlarm'

/**
 * 第 index 行第 field 个子槽的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表。
 * @param index 归一化后的下标
 * @param field 子槽名
 */
export function listFieldKey(index: number, field: ListSlotField): string {
  return `${LIST_SLOT_KEY}[${index}].${field}`
}

/**
 * 把配置里的一行规整成行配置。缺什么补什么，不丢行。
 * ⚠ 脏行不丢、只补默认：丢一行会让它之后每一条绑定改喂另一行，而绑定的 `fieldKey`
 * 是按下标拼的。
 * @param raw 配置数组里的一行
 */
function toItem(raw: unknown): ListItem {
  const row = readRecord(raw)
  const range = readRecord(row.range)
  return {
    label: readTrimmedText(row.label),
    unit: readText(row.unit),
    precision: clamp(
      Math.round(readNumber(row.precision, 1)),
      0,
      MAX_PRECISION,
    ),
    tag: readTrimmedText(row.tag),
    group: readTrimmedText(row.group),
    color: readTrimmedText(row.color),
    icon: resolveImageValue(readTrimmedText(row.icon)),
    min: readLooseNumber(range.min),
    max: readLooseNumber(range.max),
    target: readLooseNumber(range.target),
    desc: readTrimmedText(row.desc),
    emitValue: readTrimmedText(row.emitValue),
  }
}

/**
 * 行列表的归一化。
 * @param raw `config[LIST_ITEMS_KEY]` 的原值
 */
export function readListItems(raw: unknown): ListItem[] {
  return readArray(raw).map(toItem)
}

/** 扩展指标行的一格。 */
function toExtra(raw: unknown): ExtraSpec {
  const row = readRecord(raw)
  return {
    label: readTrimmedText(row.label),
    unit: readText(row.unit),
    precision: clamp(
      Math.round(readNumber(row.precision, 1)),
      0,
      MAX_PRECISION,
    ),
  }
}

/**
 * 扩展指标行的声明，最多三格。
 * @param config 该节点落库的配置
 */
export function readExtras(config: Record<string, unknown>): ExtraSpec[] {
  return readArray(config.extras).slice(0, MAX_EXTRAS).map(toExtra)
}

/** 这一行没填名字时叫什么——绑点面板与墙上必须是同一个字。 */
function displayLabel(item: ListItem, index: number): string {
  return item.label === '' ? `点位 ${index + 1}` : item.label
}

/** 取第 index 行某个子槽注入的原值；没有这一行给 undefined。 */
function rawAt(ctx: RowContext, index: number, field: ListSlotField): unknown {
  const row = ctx.raws[index]
  return row === undefined ? undefined : readRecord(row)[field]
}

function slotAt(
  ctx: RowContext,
  index: number,
  field: ListSlotField,
): ModuleSlotMeta | undefined {
  return ctx.slots?.[listFieldKey(index, field)]
}

/** 绑定优先、缺值回落配置：绑定值非空白时取绑定。 */
function pickText(bound: unknown, fallback: string): string {
  const text = readTrimmedText(bound)
  return text === '' ? fallback : text
}

/**
 * 副读数。
 * ⚠ 只有 `target` 那一档跟着主读数的单位走——同一个物理量才谈得上同一个单位；
 * 三个副读数槽装的是水温、能效这类另一种量，硬套主单位就是在墙上写错单位。
 */
function subReading(
  item: ListItem,
  index: number,
  ctx: RowContext,
): ReadingView {
  const source = ctx.subSource
  if (source === 'target') {
    if (item.target === null) return absentReading('unbound')
    const text = numberText(item.target, item.precision, ctx.grouping)
    return { state: 'ok', text, unit: item.unit, reason: '' }
  }
  if (source === 'text') {
    const text = pickText(rawAt(ctx, index, 'text'), item.desc)
    if (text === '') return absentReading('unbound')
    return { state: 'ok', text, unit: '', reason: '' }
  }
  return readingOf({
    slot: slotAt(ctx, index, source),
    raw: rawAt(ctx, index, source),
    hasSlots: ctx.hasSlots,
    unit: '',
    precision: item.precision,
    grouping: ctx.grouping,
  })
}

/** 规则判的是哪一个原值；`text` 档没有数可判。 */
function judgedRaw(item: ListItem, index: number, ctx: RowContext): unknown {
  if (ctx.alarmOn === 'value') return rawAt(ctx, index, 'value')
  if (ctx.subSource === 'target') return item.target
  if (ctx.subSource === 'text') return null
  return rawAt(ctx, index, ctx.subSource)
}

/**
 * 主读数、副读数与命中的规则。
 * ⚠ 没有读数时一律不判规则：凭空一个绿色等于宣布「一切正常」，而这时候我们根本没有值。
 */
function readingsOf(
  item: ListItem,
  index: number,
  ctx: RowContext,
): { value: ReadingView; sub: ReadingView; hit: ValueHit | null } {
  const value = readingOf({
    slot: slotAt(ctx, index, 'value'),
    raw: rawAt(ctx, index, 'value'),
    hasSlots: ctx.hasSlots,
    unit: item.unit,
    precision: item.precision,
    grouping: ctx.grouping,
  })
  const sub = subReading(item, index, ctx)
  const judged = ctx.alarmOn === 'value' ? value : sub
  const hit =
    judged.state === 'ok'
      ? evaluateValueRules(judgedRaw(item, index, ctx), ctx.rules)
      : null
  return { value, sub, hit }
}

/** 时刻。`alarmSince` 档留空，由 `selectRows` 按迟滞里的起始时刻补上。 */
function timeOf(index: number, ctx: RowContext): string {
  if (ctx.timeSource === 'bound') {
    return readTrimmedText(rawAt(ctx, index, 'time'))
  }
  if (ctx.timeSource !== 'sample') return ''
  const at = slotAt(ctx, index, 'value')?.timestampMs
  return at === undefined ? '' : fmtClock(at)
}

/** 扩展指标只在有值时出格；真实 0 算有值。 */
function extrasOf(index: number, ctx: RowContext): ExtraView[] {
  const out: ExtraView[] = []
  EXTRA_FIELDS.forEach((field, slot) => {
    const spec = ctx.extras[slot]
    if (spec === undefined) return
    const raw = rawAt(ctx, index, field)
    if (!isPresent(raw)) return
    out.push({
      key: `${slot}:${spec.label}`,
      label: spec.label,
      text: fmtTrim(raw, spec.precision),
      unit: spec.unit,
    })
  })
  return out
}

/** 两条进度条共用同一份取值。 */
function metersOf(
  item: ListItem,
  index: number,
  ctx: RowContext,
): { meter: MeterView; meter2: MeterView } {
  const input: MeterInput = {
    value: toNumOrNull(rawAt(ctx, index, 'value')),
    aux: toNumOrNull(rawAt(ctx, index, 'aux')),
    aux2: toNumOrNull(rawAt(ctx, index, 'aux2')),
    aux3: toNumOrNull(rawAt(ctx, index, 'aux3')),
    min: item.min,
    max: item.max,
    shareBasis: ctx.shareBasis,
    anyValue: ctx.anyValue,
  }
  const { meter } = ctx.look
  return {
    meter: buildMeter({
      meter,
      source: meter.source,
      label: meter.label,
      input,
    }),
    meter2: buildMeter({
      meter,
      source: meter.source2,
      label: meter.label2,
      input,
    }),
  }
}

/** 徽章、告警态与严重度。 */
function alarmOf(build: BadgeBuild): {
  badge: BadgeView
  isAlarm: boolean
  alarmText: string
  level: ThresholdLevel | null
  rank: number
  blink: boolean
} {
  const hit = build.hit
  return {
    badge: buildBadge(build),
    isAlarm: isRowAlarming(build),
    alarmText: hit?.label ?? '',
    level: hit?.level ?? null,
    rank: hit === null ? NO_RANK : SEVERITY_RANK[hit.level],
    blink: hit?.blink ?? false,
  }
}

/**
 * 行签名：只由行身份派生，不含下标与实时值。
 * ⚠ 换成下标之后，运行时增删或重排配置行会让新行继承他行的告警起始时刻，
 * 而列表看起来完全正常。
 */
function rowSignature(item: ListItem): string {
  return [item.emitValue, item.label, item.unit, item.group, item.tag].join('␟')
}

/** 同签名的行按出现序加后缀去重——两行完全同配置时仍得到不同的键。 */
function rowKey(item: ListItem, ctx: RowContext): string {
  const signature = rowSignature(item)
  const seen = ctx.seen.get(signature) ?? 0
  ctx.seen.set(signature, seen + 1)
  return seen === 0 ? signature : `${signature}#${seen}`
}

/** 逐行注入的两个色：行身份色与命中色。「没有 = 不写键」，由 scss 里的兜底接手。 */
function rowVars(item: ListItem, hit: ValueHit | null): ListRowVars {
  const vars: ListRowVars = {}
  const rowColor = item.color !== '' ? item.color : (hit?.color ?? '')
  if (rowColor !== '') vars['--il-row-color'] = rowColor
  if (hit !== null) vars['--il-hit-color'] = hit.color
  return vars
}

/** 一行配置 + 这一行各槽的结论 → 一行。 */
function toRow(item: ListItem, index: number, ctx: RowContext): ListRow {
  const parts = readingsOf(item, index, ctx)
  const build: BadgeBuild = {
    look: ctx.look.badge,
    status: rawAt(ctx, index, 'status'),
    hit: parts.hit,
  }
  return {
    key: rowKey(item, ctx),
    index,
    label: pickText(rawAt(ctx, index, 'name'), displayLabel(item, index)),
    group: item.group,
    tag: item.tag,
    desc: pickText(rawAt(ctx, index, 'text'), item.desc),
    time: timeOf(index, ctx),
    icon: item.icon,
    value: parts.value,
    sub: parts.sub,
    subLabel: ctx.subLabel,
    ...alarmOf(build),
    ...metersOf(item, index, ctx),
    extras: extrasOf(index, ctx),
    emitValue: item.emitValue,
    vars: rowVars(item, parts.hit),
  }
}

/** 全表正数合计与「有没有任何一行拿到主读数」，`share` 档的分母。 */
function shareBasis(values: readonly (number | null)[]): {
  basis: number
  any: boolean
} {
  let basis = 0
  let any = false
  for (const value of values) {
    if (value === null) continue
    any = true
    if (value > 0) basis += value
  }
  return { basis, any }
}

function rowContext(
  input: ListRowsInput,
  items: readonly ListItem[],
): RowContext {
  const raws = readArray(input.rows)
  const share = shareBasis(
    items.map((_, index) => toNumOrNull(readRecord(raws[index]).value)),
  )
  return {
    raws,
    slots: input.slots,
    hasSlots: input.slots !== undefined,
    look: input.look,
    rules: normalizeValueRules(input.config.rules),
    extras: readExtras(input.config),
    subSource: readEnum(input.config.subSource, LIST_SUB_SOURCE_VALUES, 'aux'),
    subLabel: readTrimmedText(input.config.subLabel),
    alarmOn: readEnum(input.config.alarmOn, LIST_ALARM_ON_VALUES, 'value'),
    timeSource: readEnum(
      input.config.timeSource,
      LIST_TIME_SOURCE_VALUES,
      'sample',
    ),
    grouping: readBoolean(input.config.thousands, true),
    shareBasis: share.basis,
    anyValue: share.any,
    seen: new Map<string, number>(),
  }
}

/**
 * 摊出整块要画的行，文档序、未筛选。
 * @param input 配置、注入袋、逐槽结论与这一块的形态
 */
export function buildListRows(input: ListRowsInput): ListRow[] {
  const items = readListItems(input.config[LIST_ITEMS_KEY])
  const ctx = rowContext(input, items)
  return items.map((item, index) => toRow(item, index, ctx))
}

/**
 * 筛选、排序、时刻来源与迟滞。
 * @param config 该节点落库的配置
 */
export function readListPolicy(config: Record<string, unknown>): ListPolicy {
  const seconds = clamp(readNumber(config.holdSeconds, 0), 0, MAX_HOLD_SECONDS)
  return {
    filter: readEnum(config.rowFilter, LIST_ROW_FILTER_VALUES, 'all'),
    sort: readEnum(config.rowSort, LIST_ROW_SORT_VALUES, 'docOrder'),
    timeSource: readEnum(config.timeSource, LIST_TIME_SOURCE_VALUES, 'sample'),
    holdMs: seconds * SECOND_MS,
  }
}

/**
 * 这一行过不过当前筛选。
 * ⚠ `hit` 与 `alarm` 的差就是「正常也算命中」这一条：把两者合成一个布尔，
 * 「只看红黄」与「看全部有判据的行」就再也分不开了。
 * @param row 一行
 * @param filter 筛选档
 */
export function isRowKept(row: ListRow, filter: ListRowFilter): boolean {
  if (filter === 'all') return true
  if (row.level === null) return false
  return filter === 'hit' || isAlarmLevel(row.level)
}

/** 严重度降序，同级按配置序稳定。 */
function bySeverity(left: ListRow, right: ListRow): number {
  return right.rank - left.rank || left.index - right.index
}

/** `alarmSince` 那一档的时刻来自迟滞表，不是采样时刻。 */
function withSince(
  row: ListRow,
  since: Readonly<Record<string, number>>,
): ListRow {
  const at = since[row.key]
  return at === undefined ? row : { ...row, time: fmtClock(at) }
}

/**
 * 选出真正上墙的那些行并排序。
 * @param rows 全量行，文档序
 * @param view 在场的行键、告警起始时刻、行序与时刻来源
 */
export function selectRows(
  rows: readonly ListRow[],
  view: ListView,
): ListRow[] {
  const keep = new Set(view.keys)
  const picked = rows
    .filter((row) => keep.has(row.key))
    .map((row) =>
      view.timeSource === 'alarmSince' ? withSince(row, view.since) : row,
    )
  return view.sort === 'severity' ? picked.sort(bySeverity) : picked
}

/**
 * 迟滞缝合：命中的行刷新/保持起始时刻，清除的行按迟滞时长多留一会儿。
 * @param prev 上一轮的迟滞表
 * @param activeKeys 这一轮命中筛选的行键
 * @param nowMs 当前墙钟，UTC 毫秒
 * @param holdMs 迟滞时长；0 = 关
 */
export function reconcileHold(
  prev: readonly HoldEntry[],
  activeKeys: readonly string[],
  nowMs: number,
  holdMs: number,
): HoldResult {
  const before = new Map(prev.map((entry) => [entry.key, entry]))
  const active = new Set(activeKeys)
  const entries: HoldEntry[] = activeKeys.map((key) => ({
    key,
    since: before.get(key)?.since ?? nowMs,
    active: true,
  }))
  let earliest = Number.POSITIVE_INFINITY
  for (const entry of prev) {
    if (holdMs <= 0 || active.has(entry.key)) continue
    const due = entry.since + holdMs
    if (due <= nowMs) continue
    entries.push({ key: entry.key, since: entry.since, active: false })
    earliest = Math.min(earliest, due)
  }
  const wake = earliest === Number.POSITIVE_INFINITY ? null : earliest - nowMs
  return { entries, nextWakeMs: wake }
}

/**
 * 造一个迟滞句柄。
 * ⚠ 它只记「谁从什么时候开始命中」，定时器由 `Component.vue` 持有并在卸载时清掉。
 */
export function createHoldStore(): HoldStore {
  let entries: HoldEntry[] = []
  return {
    reconcile(activeKeys, nowMs, holdMs) {
      const result = reconcileHold(entries, activeKeys, nowMs, holdMs)
      entries = result.entries
      return result
    },
    dispose() {
      entries = []
    },
  }
}

/**
 * 迟滞表摊成「行键 → 起始时刻」。
 * @param entries 迟滞表
 */
export function sinceMap(
  entries: readonly HoldEntry[],
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const entry of entries) map[entry.key] = entry.since
  return map
}

/**
 * 已配置但当前取不到主读数的行数——区分「无告警」与「无数据」。
 * @param rows 全量行
 */
export function countMissing(rows: readonly ListRow[]): number {
  return rows.filter((row) => row.value.state !== 'ok').length
}

/**
 * 空态那一句话；还有行要画时是空串。
 * ⚠ 三档分开说：一项都没配、全部平静、以及绑了却一个读数都没回来。
 * 合成一句之后，该去配点位、该去查现场这两件事就都看不出来了。
 * @param input 配置、全量行与还剩几行
 */
export function readEmptyNote(input: ListEmptyInput): string {
  if (input.shown > 0) return ''
  if (input.rows.length === 0) {
    return pickText(input.config.noRowsText, '暂无数据')
  }
  const missing = countMissing(input.rows)
  if (missing > 0) return `${missing} 个点位无数据`
  return pickText(input.config.calmText, '无活动告警')
}

/**
 * 绑点面板上每一行叫什么：名字给人看，id 给人核对。
 * @param items 归一化后的行列表
 */
export function listRowLabels(
  items: readonly ListItem[],
): Record<string, { title: string; id: string }> {
  const labels: Record<string, { title: string; id: string }> = {}
  items.forEach((item, index) => {
    labels[listFieldKey(index, 'value')] = {
      title: displayLabel(item, index),
      id: item.emitValue,
    }
  })
  return labels
}

/** 数组槽应有几行：跟着行列表走，绑点面板因此不摆手工增删键。 */
export function listRowCounts(
  items: readonly ListItem[],
): Record<string, number> {
  return { [LIST_SLOT_KEY]: items.length }
}
