/**
 * @fileoverview info-card 一格的全部取值：四档状态、按值类型格式化、值规则命中、涨跌块与
 * 状态点，最后收成一份纯数据的 `CardCell[]`。纯函数，不碰 DOM。
 *
 * ⚠ 四档在 `values` 里长得一模一样（键都不存在），全靠 `meta.slots` 分开——合成一档的
 * 代价是现场断了的那一格与从没配过的那一格在墙上是同一个「—」（DASHBOARD_DESIGN §4.3）。
 * ⚠ 没配来源与等首帧显示的是**同一个**占位符，只靠颜色与透明度分开：一格里摆不下
 * 「未绑定」「等待首帧」这样的短标签，完整原因挂 `title`。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import type { CSSProperties } from 'vue'

import { resolveImageValue } from '../../shared/assetImage'
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
  fmtDecimal,
  fmtNumber,
  fmtTrim,
  isPresent,
  NO_DATA,
} from '../../shared/format'
import type { ThresholdLevel } from '../../shared/thresholds'

import {
  CARD_COMPARE_MODE_VALUES,
  CARD_STATUS_DOT_VALUES,
  CARD_VALUE_FILL_VALUES,
  CARD_VALUE_KIND_VALUES,
  LEVEL_TEXT,
  type CardCompareMode,
  type CardValueKind,
} from './options'
import {
  evaluateValueRules,
  normalizeValueRules,
  type ValueHit,
  type ValueRule,
} from './rules'

/**
 * 格读数的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const CARD_SLOT_KEY = 'cardValues'

/** 格列表的配置键。 */
export const CARD_ITEMS_KEY = 'items'

/** 一格里的两个子槽：主读数与对比值。加子槽不改行数，只让绑点面板那份平铺变长。 */
export const CARD_SLOT_FIELDS = ['value', 'aux'] as const
export type CardSlotField = (typeof CARD_SLOT_FIELDS)[number]

/**
 * 一格此刻处在哪一档。
 * ⚠ `unbound` 与 `pending` 必须分开：前者要去配绑定，后者只要再等一会儿。
 */
export const CELL_STATES = ['ok', 'pending', 'error', 'unbound'] as const
export type CellState = (typeof CELL_STATES)[number]

/** 各档没有值时给看的人的一句话，鼠标停上去才看得全。 */
export const REASONS: Record<Exclude<CellState, 'ok'>, string> = {
  unbound: '这一格还没绑定数据来源',
  pending: '已绑定，还没收到第一帧',
  error: '取不到',
}

// 涨跌箭头：三档各一个字，与参考仓 kpi-card 逐字相同
const ARROW_UP = '▲'
const ARROW_DOWN = '▼'
const ARROW_FLAT = '—'

/** 涨跌百分比固定最多一位小数，与参考仓 kpi-card 同口径。 */
const PCT_DIGITS = 1

const MAX_PRECISION = 6
const PERCENT = 100

type IcCellVarName = '--ic-cell-color' | '--ic-trend' | '--ic-dot-color'

/** 逐格注入的 CSS 变量；样式表只认变量，不认取值口径。 */
export type CardCellVars = CSSProperties &
  Partial<Record<IcCellVarName, string>>

/** 逐格变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const IC_CELL_VAR_NAMES: readonly IcCellVarName[] = [
  '--ic-cell-color',
  '--ic-trend',
  '--ic-dot-color',
]

/** 归一化后的一格配置。 */
export interface CardItem {
  /** ⚠ 空串 = 这一格不画标签行：档位类名也跟着不挂（MODULE_INFO_CARD_DESIGN §4.1）。 */
  label: string
  /** ⚠ 不 trim：`'° C'` 这类带空格是用户显式的排版意图。 */
  unit: string
  precision: number
  kind: CardValueKind
  trueText: string
  falseText: string
  emoji: string
  /** 已解析的图标地址；空串 = 没有素材图。 */
  icon: string
  /** 逐格静态色，填了就固定纯色并压过渐变。 */
  color: string
  /** 联动上抛的值；空串 = 这一格点了不上抛。 */
  emitValue: string
}

/** 涨跌方向，用来选箭头与好坏配色。 */
export type CompareDir = 'up' | 'down' | 'flat'

/** 一格的涨跌块。 */
export interface CellCompare {
  dir: CompareDir
  arrow: string
  /** 差值 /（差值 +）百分比，已按对比档拼好。 */
  text: string
  /** 「较上期」这类注脚，空串 = 不画。 */
  label: string
}

/** 状态点。⚠ 只在命中规则时才有：没有判据就连「正常」都不该说。 */
export interface CellDot {
  level: ThresholdLevel
  /** 严重度的中文词，给读屏与悬停提示——点自己没有文字。 */
  text: string
}

/** 一格要画的全部东西。 */
export interface CardCell {
  /** `v-for` 的键：格签名，配置重排时同一逻辑格的键不变。 */
  key: string
  /** 文档序下标，取绑定槽与派生行都用它。 */
  index: number
  /** 标签行的字：命中文案优先，其次行内标签；空串 = 整行不渲染。 */
  label: string
  /** 标签画的是命中文案，颜色跟着这一格的数值色走。 */
  labelIsHit: boolean
  emoji: string
  icon: string
  state: CellState
  text: string
  /** ⚠ 非 `ok` 档一律空串——「— kV」看着像是有读数的。 */
  unit: string
  /** 这一格为什么没有值，一句完整的话，挂 `title`；`ok` 档是空串。 */
  reason: string
  /** 这个值有没有资格用数字字体。 */
  digit: boolean
  /** 渐变文字的三个前提都成立。 */
  gradient: boolean
  blink: boolean
  dot: CellDot | null
  compare: CellCompare | null
  emitValue: string
  vars: CardCellVars
}

/** 组装一整块的格要用到的输入。 */
export interface CardCellsInput {
  config: Record<string, unknown>
  /** `values[CARD_SLOT_KEY]` 的原值，正常是一个格数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
}

/** 涨跌块那一簇。 */
interface CompareLook {
  show: boolean
  mode: CardCompareMode
  label: string
  /** 下降为好（能耗 / 成本类）：反转涨跌的好坏配色。 */
  invertTrend: boolean
}

/** 一格读数那四个字段，`toCell` 原样摊进格里。 */
interface CellReading {
  state: CellState
  text: string
  unit: string
  reason: string
  digit: boolean
}

interface CellContext {
  raws: readonly unknown[]
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
  hasSlots: boolean
  rules: readonly ValueRule[]
  emptyText: string
  /** 数值要不要千分位。 */
  grouping: boolean
  /** 按小数位补零，读数跳动时位数不变。 */
  fixed: boolean
  gradientOn: boolean
  /** 文本值与缺值回退正文字体 + 纯色。 */
  textPlain: boolean
  compare: CompareLook
  dotOn: boolean
  seen: Map<string, number>
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 第 index 格第 field 个子槽的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表。
 * @param index 归一化后的下标
 * @param field 子槽名
 */
export function cardFieldKey(index: number, field: CardSlotField): string {
  return `${CARD_SLOT_KEY}[${index}].${field}`
}

/**
 * 把配置里的一行规整成一格。缺什么补什么，不丢格。
 * ⚠ 脏行不丢、只补默认：丢一格会让它之后每一条绑定改喂另一格，而绑定的 `fieldKey`
 * 是按下标拼的。
 * @param raw 配置数组里的一行
 */
function toItem(raw: unknown): CardItem {
  const row = readRecord(raw)
  return {
    label: readTrimmedText(row.label),
    unit: readText(row.unit),
    precision: clamp(
      Math.round(readNumber(row.precision, 1)),
      0,
      MAX_PRECISION,
    ),
    kind: readEnum(row.valueKind, CARD_VALUE_KIND_VALUES, 'number'),
    trueText: readTrimmedText(row.trueText, '运行'),
    falseText: readTrimmedText(row.falseText, '停止'),
    emoji: readTrimmedText(row.emoji),
    icon: resolveImageValue(readTrimmedText(row.icon)),
    color: readTrimmedText(row.color),
    emitValue: readTrimmedText(row.emitValue),
  }
}

/**
 * 格列表的归一化。
 * @param raw `config[CARD_ITEMS_KEY]` 的原值
 */
export function readCardItems(raw: unknown): CardItem[] {
  return readArray(raw).map(toItem)
}

/**
 * 这一格落在哪一档。
 * @param slot 这一槽的取数结论
 * @param raw 注入袋里这一格的原值
 * @param hasSlots 运行时下发了逐槽结论没有
 */
export function cellState(
  slot: ModuleSlotMeta | undefined,
  raw: unknown,
  hasSlots: boolean,
): CellState {
  if (slot !== undefined) return slot.state
  // ⚠ 没下发结论时只能退回「有没有值」这一条判据：设计态画布与独立挂载走这里。
  //   此时把没有值一律说成 unbound 是诚实的——那两处本来就没有取数
  if (!hasSlots) return raw === undefined ? 'unbound' : 'ok'
  return 'unbound'
}

/**
 * 没有值的那一句话；`error` 档带上取数侧给的原因。
 * @param state 这一格所在的档
 * @param slot 这一槽的取数结论
 */
export function reasonOf(
  state: CellState,
  slot: ModuleSlotMeta | undefined,
): string {
  if (state === 'ok') return ''
  const base = REASONS[state]
  const detail = slot?.message ?? ''
  return detail === '' ? base : `${base}：${detail}`
}

/**
 * 数值的展示文本。补零那一档走 `fmtDecimal`，其余按千分位开关二选一。
 * @param raw 待格式化的原值
 * @param precision 最多几位小数
 * @param ctx 整块共用的展示口径
 */
function numberText(raw: unknown, precision: number, ctx: CellContext): string {
  if (ctx.fixed) return fmtDecimal(raw, precision, ctx.grouping)
  return ctx.grouping ? fmtNumber(raw, precision) : fmtTrim(raw, precision)
}

/**
 * 认不出的值照实显示，不静默换成占位符——「现场报的就是这么个东西」本身就是要看的信息。
 * @param raw 槽里的原值
 * @param empty 一格都取不到时的占位符
 */
function plainText(raw: unknown, empty: string): string {
  if (typeof raw === 'string' && raw.trim() !== '') return raw
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  if (isPresent(raw)) return String(raw)
  return empty
}

/**
 * 开关量的真假判定。
 * ⚠ 数值 `0` 是假、非零是真：工控点位的开关量绝大多数是 0/1 的数值而不是 JSON 布尔，
 * 只认 `true` 会让每一台运行中的设备都显示成「停止」。
 * @param raw 槽里的原值
 */
function toBool(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw
  if (isPresent(raw)) return raw !== 0
  return null
}

/**
 * 有值那一档的展示文本。
 * ⚠ 文本档不做数字格式化：那一档装的是风向、工况这类原样上墙的字。
 * @param raw 槽里的原值
 * @param item 归一化后的这一格
 * @param ctx 整块共用的展示口径
 */
function valueText(raw: unknown, item: CardItem, ctx: CellContext): string {
  if (item.kind === 'text') return plainText(raw, ctx.emptyText)
  if (item.kind === 'boolean') {
    const flag = toBool(raw)
    if (flag !== null) return flag ? item.trueText : item.falseText
    return plainText(raw, ctx.emptyText)
  }
  if (isPresent(raw)) return numberText(raw, item.precision, ctx)
  return plainText(raw, ctx.emptyText)
}

/**
 * 涨跌文案。
 * ⚠ 百分比档基数为 0 时回退显绝对差值，不留空——那一格空着看不出是「没变」还是「算不了」。
 * @param delta 与对比值的差
 * @param pct 涨跌百分比；`null` = 基数为 0，算不出
 * @param item 归一化后的这一格
 * @param ctx 整块共用的展示口径
 */
function compareText(
  delta: number,
  pct: number | null,
  item: CardItem,
  ctx: CellContext,
): string {
  const mode = ctx.compare.mode
  const parts: string[] = []
  if (mode !== 'percent' || pct === null) {
    parts.push(numberText(Math.abs(delta), item.precision, ctx))
  }
  if (pct !== null && mode !== 'delta') {
    const text = `${fmtNumber(Math.abs(pct), PCT_DIGITS)}%`
    parts.push(mode === 'both' ? `(${text})` : text)
  }
  return parts.join(' ')
}

/** 涨跌方向；持平也是一档，箭头换成一道横线。 */
function compareDir(delta: number): CompareDir {
  if (delta === 0) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

/** 涨 = 好（绿）、跌 = 坏（红），`invertTrend` 反转；持平中性。 */
function trendColor(dir: CompareDir, invert: boolean): string {
  if (dir === 'flat') return 'var(--text-secondary)'
  return (dir === 'up') !== invert
    ? 'var(--state-success)'
    : 'var(--state-danger)'
}

const ARROWS: Record<CompareDir, string> = {
  up: ARROW_UP,
  down: ARROW_DOWN,
  flat: ARROW_FLAT,
}

/**
 * 涨跌块；当前值与对比值任一缺席都不画。
 * @param raw 主读数原值
 * @param base 对比值原值
 * @param item 归一化后的这一格
 * @param ctx 整块共用的展示口径
 */
function compareOf(
  raw: unknown,
  base: unknown,
  item: CardItem,
  ctx: CellContext,
): CellCompare | null {
  if (!ctx.compare.show) return null
  if (!isPresent(raw) || !isPresent(base)) return null
  const delta = raw - base
  // ⚠ 除零不算百分比：基数 0 时任何涨跌都是无穷大
  const pct = base === 0 ? null : (delta / base) * PERCENT
  const dir = compareDir(delta)
  return {
    dir,
    arrow: ARROWS[dir],
    text: compareText(delta, pct, item, ctx),
    label: ctx.compare.label,
  }
}

/**
 * 逐格注入的三个色。「没有 = 不写键」，由 `_variants.scss` 里的兜底接手。
 * @param override 这一格的纯色覆盖，空串 = 不覆盖
 * @param compare 涨跌块，`null` = 不画
 * @param hit 命中的规则，`null` = 没命中
 * @param invert 下降为好，反转涨跌的好坏配色
 */
function cellVars(
  override: string,
  compare: CellCompare | null,
  hit: ValueHit | null,
  invert: boolean,
): CardCellVars {
  const vars: CardCellVars = {}
  if (override !== '') vars['--ic-cell-color'] = override
  if (compare !== null) vars['--ic-trend'] = trendColor(compare.dir, invert)
  // ⚠ 状态点跟的是**命中的那条规则**（规则自己的色，留空则严重度语义色），不是逐格
  //   静态色：静态色是这一格的身份，它不该在没有告警的时候画出一个点来
  if (hit !== null) vars['--ic-dot-color'] = hit.color
  return vars
}

/** 取第 index 格某个子槽注入的原值；没有这一格给 undefined。 */
function rawAt(ctx: CellContext, index: number, field: CardSlotField): unknown {
  const row = ctx.raws[index]
  return row === undefined ? undefined : readRecord(row)[field]
}

function slotAt(
  ctx: CellContext,
  index: number,
  field: CardSlotField,
): ModuleSlotMeta | undefined {
  return ctx.slots?.[cardFieldKey(index, field)]
}

/**
 * 格签名：只由格身份派生，不含实时值。
 * ⚠ 同签名的格按出现序加后缀去重——两格完全同配置时仍得到不同的键。
 * @param item 归一化后的这一格
 * @param ctx 整块共用的展示口径
 */
function cellKey(item: CardItem, ctx: CellContext): string {
  const signature = [item.emitValue, item.label, item.unit].join('␟')
  const seen = ctx.seen.get(signature) ?? 0
  ctx.seen.set(signature, seen + 1)
  return seen === 0 ? signature : `${signature}#${seen}`
}

/** 命中的规则；⚠ 只有数值档评估：文本与开关量命中不了阈值，也就没有告警色。 */
function hitOf(
  raw: unknown,
  item: CardItem,
  state: CellState,
  ctx: CellContext,
): ValueHit | null {
  if (state !== 'ok' || item.kind !== 'number') return null
  return evaluateValueRules(raw, ctx.rules)
}

/** 状态点自己没有文字，靠严重度的中文词给出无障碍名与悬停提示。 */
function dotOf(hit: ValueHit): CellDot {
  return { level: hit.level, text: LEVEL_TEXT[hit.level] }
}

/**
 * 这一格的读数：落在哪一档、显什么字、有没有单位、为什么没有值。
 * ⚠ 单位只在有值那一档给：「— kV」看着像是有读数的。
 * @param item 归一化后的这一格
 * @param index 文档序下标
 * @param ctx 整块共用的展示口径
 */
function readingOf(
  item: CardItem,
  index: number,
  ctx: CellContext,
): CellReading {
  const raw = rawAt(ctx, index, 'value')
  const slot = slotAt(ctx, index, 'value')
  const state = cellState(slot, raw, ctx.hasSlots)
  const ok = state === 'ok'
  const numeric = ok && item.kind === 'number' && isPresent(raw)
  return {
    state,
    text: ok ? valueText(raw, item, ctx) : ctx.emptyText,
    unit: ok ? item.unit : '',
    reason: reasonOf(state, slot),
    digit: numeric || !ctx.textPlain,
  }
}

/**
 * 标签行的字：命中文案顶掉行内标签。
 * ⚠ 两者都空时给空串——整行不渲染，档位类名也不挂。
 * @param item 归一化后的这一格
 * @param hit 命中的规则，`null` = 没命中
 */
function labelOf(
  item: CardItem,
  hit: ValueHit | null,
): { label: string; labelIsHit: boolean } {
  const text = hit?.label ?? ''
  if (text === '') return { label: item.label, labelIsHit: false }
  return { label: text, labelIsHit: true }
}

/**
 * 闪烁与状态点。
 * @param hit 命中的规则，`null` = 没命中
 * @param ctx 整块共用的展示口径
 */
function alarmOf(
  hit: ValueHit | null,
  ctx: CellContext,
): { blink: boolean; dot: CellDot | null } {
  if (hit === null) return { blink: false, dot: null }
  return { blink: hit.blink, dot: ctx.dotOn ? dotOf(hit) : null }
}

/**
 * 渐变文字的三个前提，缺一即静默降级成纯色。
 * ⚠ 再加一条「有值」：`background-clip: text` 会把四档占位符的颜色一起洗掉，
 * 而那四档在墙上本来就只靠颜色与透明度分得开。
 * @param read 这一格的读数
 * @param override 这一格的纯色覆盖，空串 = 不覆盖
 * @param ctx 整块共用的展示口径
 */
function gradientOf(
  read: CellReading,
  override: string,
  ctx: CellContext,
): boolean {
  return read.state === 'ok' && ctx.gradientOn && override === '' && read.digit
}

/**
 * 一格配置 + 这一格两槽的结论 → 一格。
 * @param item 归一化后的这一格
 * @param index 文档序下标
 * @param ctx 整块共用的展示口径
 */
function toCell(item: CardItem, index: number, ctx: CellContext): CardCell {
  const raw = rawAt(ctx, index, 'value')
  const read = readingOf(item, index, ctx)
  const hit = hitOf(raw, item, read.state, ctx)
  // ⚠ 命中色压过逐格静态色：静态色是身份，告警是此刻的事实
  const override = hit?.color ?? item.color
  const compare =
    read.state === 'ok'
      ? compareOf(raw, rawAt(ctx, index, 'aux'), item, ctx)
      : null
  return {
    key: cellKey(item, ctx),
    index,
    ...labelOf(item, hit),
    emoji: item.emoji,
    icon: item.icon,
    ...read,
    gradient: gradientOf(read, override, ctx),
    ...alarmOf(hit, ctx),
    compare,
    emitValue: item.emitValue,
    vars: cellVars(override, compare, hit, ctx.compare.invertTrend),
  }
}

/**
 * 涨跌块那一簇。
 * @param config 该节点落库的配置
 */
function readCompare(config: Record<string, unknown>): CompareLook {
  const compare = readRecord(config.compare)
  return {
    show: readBoolean(compare.show),
    mode: readEnum(compare.mode, CARD_COMPARE_MODE_VALUES, 'percent'),
    label: readTrimmedText(compare.label),
    invertTrend: readBoolean(compare.invertTrend),
  }
}

/**
 * 整块共用的展示口径。
 * @param input 配置、注入袋与逐槽结论
 */
function cellContext(input: CardCellsInput): CellContext {
  const config = input.config
  return {
    raws: readArray(input.rows),
    slots: input.slots,
    hasSlots: input.slots !== undefined,
    rules: normalizeValueRules(config.rules),
    emptyText: readTrimmedText(config.emptyText) || NO_DATA,
    grouping: readBoolean(config.thousands),
    fixed: readBoolean(config.fixedDecimals),
    gradientOn:
      readEnum(config.valueFill, CARD_VALUE_FILL_VALUES, 'solid') ===
      'gradient',
    textPlain: readBoolean(config.textPlainFallback, true),
    compare: readCompare(config),
    dotOn:
      readEnum(config.statusDot, CARD_STATUS_DOT_VALUES, 'none') === 'auto',
    seen: new Map<string, number>(),
  }
}

/**
 * 摊出整块要画的格，文档序。
 * @param input 配置、注入袋与逐槽结论
 */
export function buildCardCells(input: CardCellsInput): CardCell[] {
  const items = readCardItems(input.config[CARD_ITEMS_KEY])
  const ctx = cellContext(input)
  return items.map((item, index) => toCell(item, index, ctx))
}
