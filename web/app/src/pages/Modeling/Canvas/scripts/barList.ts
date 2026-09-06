/**
 * @fileoverview 横条图元件的取数：把一组条目按 mode 折成能直接画的行、参考线与
 * 图例。四种 mode 对应规格 §5 里 18 处横条用法的四种语义（设计规格 §7）。
 *
 * ⚠ 这里不排序：折序、小时序、类目序被排一遍就读不成了，顺序一律由调用方定。
 * ⚠ 零永远在轴上、基准是实际最大值——轴从别处起或钉死成 1，条长就不能按面积读，
 * 系数全小于 1 时整排会缩成看不见的一丝。
 */
import type { CSSProperties } from 'vue'

import { niceNumber } from './numbers'

/**
 * 条的语义色。每一档另有一重非颜色编码，颜色不作唯一编码（规格 §2-P6）：
 * before 空心描边、dropped 斜纹、danger 实边框。
 */
export type BarTone = 'primary' | 'before' | 'dropped' | 'danger' | 'neutral'

export type BarListMode = 'single' | 'pairs' | 'stacked' | 'range'

/** 堆叠模式里的一段。 */
export interface BarSegment {
  readonly label: string
  readonly value: number | null
  readonly tone?: BarTone
}

/**
 * 一行。字段按 mode 取用：single 取 value/spread、pairs 取 before/after、
 * stacked 取 segments、range 取 low/mid/high/mark。
 * ⚠ 取不到的一律给 null 而不是 0——「算不出来」画成「—」（规格 §2-P4）。
 */
export interface BarListItem {
  readonly name: string
  readonly value?: number | null
  readonly spread?: number | null
  readonly before?: number | null
  readonly after?: number | null
  readonly segments?: readonly BarSegment[]
  readonly low?: number | null
  readonly mid?: number | null
  readonly high?: number | null
  readonly mark?: number | null
  readonly tone?: BarTone
}

/** 一条竖参考线：参考线灰虚线，阈值线警示色虚线，两者都带文字标签。 */
export interface BarListRule {
  readonly value: number
  readonly label: string
}

/** 项数上限：再多横条就读不成排行了，超出的部分必须明说截了多少。 */
export const MAX_BAR_ROWS = 60

/** pairs 两侧的缺省叫法。 */
export const DEFAULT_PAIR_LABELS: readonly [string, string] = ['之前', '之后']

/**
 * 标签避让用的估算：轨道按这么宽算，全角字与半角字各占这么宽（都是 rem）。
 *
 * ⚠ 轨道是 `minmax(0, 1fr)`，真实宽度只有浏览器知道；这里只用来判两块标签会不
 * 会挨上，估宽了多错开一行，读起来照旧，估窄了才会叠。
 */
const TRACK_REM = 28
const WIDE_REM = 0.8
const NARROW_REM = 0.5
/** 全角起点：这个码位往上按一个全角字算。 */
const WIDE_FROM = 0x2e80
/** 两块标签之间至少留这么宽（轨道宽的百分数），挨得更近就换一行摆。 */
const LABEL_CLEAR = 2
/** 标签最多错开这么多行；再多这一栏就比条子还高了。 */
const MAX_LABEL_ROW = 1

/** 堆叠段没指定语义色时按这个顺序取。 */
const STACK_TONES: readonly BarTone[] = [
  'primary',
  'dropped',
  'neutral',
  'danger',
]

type Band = 'full' | 'top' | 'bottom'
type RuleKind = 'zero' | 'reference' | 'threshold'
export type BarKeyKind = BarTone | RuleKind | 'tick' | 'dot'

// ⚠ 两个内联定位都继承 `CSSProperties`：Vue 的 `:style` 只收这个形状，
// 自建的窄对象少一条索引签名就整个不收
export interface BarSpan extends CSSProperties {
  readonly left: string
  readonly width: string
}
export interface BarSpot extends CSSProperties {
  readonly left: string
}
export interface BarPiece {
  readonly key: string
  readonly tone: BarTone
  readonly band: Band
  readonly style: BarSpan
}
export interface BarRow {
  readonly key: string
  readonly name: string
  readonly pieces: readonly BarPiece[]
  readonly whisker: BarSpan | null
  readonly tick: BarSpot | null
  readonly dot: BarSpot | null
  readonly text: string
}
export interface BarRule {
  readonly key: string
  readonly kind: RuleKind
  readonly style: BarSpot
}
/**
 * 竖线正上方那块标签。`place` 是它相对自己那条线怎么摆（贴边时不许写出轨道），
 * `row` 是错开的第几行，0 挨着轨道。
 */
export interface BarRuleLabel {
  readonly key: string
  readonly kind: RuleKind
  readonly label: string
  readonly place: 'start' | 'mid' | 'end'
  readonly row: number
  readonly style: BarSpot
}
interface Line {
  readonly kind: RuleKind
  readonly rule: BarListRule
}
export interface BarKey {
  readonly key: string
  readonly kind: BarKeyKind
  readonly label: string
}
export interface BarListOptions {
  readonly mode: BarListMode
  readonly unit: string
  readonly pairLabels: readonly [string, string]
  readonly reference: BarListRule | null
  readonly threshold: BarListRule | null
  readonly maxItems: number
}
export interface BarListView {
  readonly rows: readonly BarRow[]
  readonly rules: readonly BarRule[]
  readonly ruleLabels: readonly BarRuleLabel[]
  /** 标签这一栏占了几行，1 或 2。 */
  readonly ruleRows: number
  readonly legend: readonly BarKey[]
  readonly shown: number
  readonly hidden: number
}

/** 只有有限数参与定标；null 与 NaN 是「算不出来」，不当 0 用。 */
function finite(values: readonly (number | null | undefined)[]): number[] {
  return values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  )
}

/** 堆叠条的总长；一段都算不出来就是 null。 */
function totalOf(item: BarListItem): number | null {
  const parts = finite((item.segments ?? []).map((part) => part.value))
  return parts.length === 0 ? null : parts.reduce((sum, one) => sum + one, 0)
}

/** 这一行里参与定标的所有端点。 */
function reachOf(item: BarListItem, mode: BarListMode): number[] {
  if (mode === 'pairs') return finite([item.before, item.after])
  if (mode === 'range')
    return finite([item.low, item.mid, item.high, item.mark])
  if (mode === 'stacked') return finite([totalOf(item)])
  const [value] = finite([item.value])
  if (value === undefined) return []
  const [spread = 0] = finite([item.spread])
  return [value - Math.abs(spread), value + Math.abs(spread)]
}

/**
 * 轴：下界与跨度。
 * ⚠ 全零、单项、全同值时跨度是 0，量尺一律给 0% 而不是除以 0。
 * Args: shown 要画的条目；options 定标还要算上参考线与阈值线。
 */
function rulerOf(shown: readonly BarListItem[], options: BarListOptions) {
  const edges = [
    0,
    ...shown.flatMap((item) => reachOf(item, options.mode)),
    ...finite([options.reference?.value, options.threshold?.value]),
  ]
  const lo = Math.min(...edges)
  const span = Math.max(...edges) - lo
  const at = (value: number): number =>
    span > 0 ? ((value - lo) / span) * 100 : 0
  // 两位小数，再多是浮点噪声
  const round = (value: number): number => Math.round(value * 100) / 100
  const px = (value: number): string => `${round(value)}%`
  const place = (value: number | null | undefined): number | null => {
    const [found] = finite([value])
    return found === undefined ? null : round(at(found))
  }
  return {
    negative: lo < 0,
    span: (from: number, to: number): BarSpan => ({
      left: px(Math.min(at(from), at(to))),
      width: px(Math.abs(at(to) - at(from))),
    }),
    place,
    spot: (value: number | null | undefined): BarSpot | null => {
      const found = place(value)
      return found === null ? null : { left: `${found}%` }
    },
  }
}

type Ruler = ReturnType<typeof rulerOf>

function toneOf(part: BarSegment, seat: number): BarTone {
  return part.tone ?? STACK_TONES[seat % STACK_TONES.length] ?? 'primary'
}

/** 从零长到 value 的一块；算不出来就不画。 */
function grown(
  key: string,
  value: number | null | undefined,
  tone: BarTone,
  band: Band,
  ruler: Ruler,
): BarPiece[] {
  const [found] = finite([value])
  return found === undefined
    ? []
    : [{ key, tone, band, style: ruler.span(0, found) }]
}

function stacked(item: BarListItem, key: string, ruler: Ruler): BarPiece[] {
  const found: BarPiece[] = []
  let cursor = 0
  for (const [seat, part] of (item.segments ?? []).entries()) {
    const [size] = finite([part.value])
    if (size === undefined) continue
    found.push({
      key: `${key}:${part.label}`,
      tone: toneOf(part, seat),
      band: 'full',
      style: ruler.span(cursor, cursor + size),
    })
    cursor += size
  }
  return found
}

function piecesOf(
  item: BarListItem,
  key: string,
  mode: BarListMode,
  ruler: Ruler,
): BarPiece[] {
  if (mode === 'stacked') return stacked(item, key, ruler)
  if (mode === 'range') {
    const [low] = finite([item.low])
    const [high] = finite([item.high])
    if (low === undefined || high === undefined) return []
    const tone = item.tone ?? 'neutral'
    return [{ key, tone, band: 'full', style: ruler.span(low, high) }]
  }
  if (mode === 'pairs') {
    return [
      ...grown(`${key}:before`, item.before, 'before', 'top', ruler),
      ...grown(`${key}:after`, item.after, 'primary', 'bottom', ruler),
    ]
  }
  return grown(key, item.value, item.tone ?? 'primary', 'full', ruler)
}

/** 误差棒：置换重要性那类「重复 R 次」的散布，只有 single 档有。 */
function whiskerOf(
  item: BarListItem,
  mode: BarListMode,
  ruler: Ruler,
): BarSpan | null {
  if (mode !== 'single') return null
  const [value] = finite([item.value])
  const [spread] = finite([item.spread])
  if (value === undefined || spread === undefined || spread <= 0) return null
  return ruler.span(value - spread, value + spread)
}

/** undefined 与 null 是同一件事：这一格算不出来。 */
function orNull(value: number | null | undefined): number | null {
  return value ?? null
}

/** 读数由哪几个数、用什么连起来写。 */
function readoutOf(
  item: BarListItem,
  mode: BarListMode,
): { parts: (number | null)[]; joiner: string } {
  if (mode === 'pairs') {
    return { parts: [orNull(item.before), orNull(item.after)], joiner: ' → ' }
  }
  if (mode === 'range') {
    return { parts: [orNull(item.low), orNull(item.high)], joiner: ' ~ ' }
  }
  if (mode === 'stacked') return { parts: [totalOf(item)], joiner: '' }
  const [spread = 0] = finite([item.spread])
  const parts = [orNull(item.value)]
  return spread > 0
    ? { parts: [...parts, spread], joiner: ' ± ' }
    : { parts, joiner: '' }
}

/** 右侧读数：单位只挂一次，一个数都算不出来时连单位都不挂。 */
function textOf(item: BarListItem, options: BarListOptions): string {
  const { parts, joiner } = readoutOf(item, options.mode)
  const body = parts.map(niceNumber).join(joiner)
  const known = finite(parts).length > 0
  return known && options.unit !== '' ? `${body} ${options.unit}` : body
}

/** 同名两行会撞 key，撞上了按出现次数排号。 */
function keyed(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const times = (seen.get(name) ?? 0) + 1
    seen.set(name, times)
    return times > 1 ? `${name}·${times}` : name
  })
}

/** 配了的那几条竖线；没配的整条不出现。 */
function linesOf(options: BarListOptions): Line[] {
  const found: Line[] = []
  if (options.reference !== null) {
    found.push({ kind: 'reference', rule: options.reference })
  }
  if (options.threshold !== null) {
    found.push({ kind: 'threshold', rule: options.threshold })
  }
  return found
}

function pairKeys(options: BarListOptions): BarKey[] {
  const [head = '之前', tail = '之后'] = options.pairLabels
  return [
    { key: 'before', kind: 'before', label: head },
    { key: 'after', kind: 'primary', label: tail },
  ]
}

function stackKeys(shown: readonly BarListItem[]): BarKey[] {
  const found: BarKey[] = []
  for (const item of shown) {
    for (const [seat, part] of (item.segments ?? []).entries()) {
      if (found.some((one) => one.label === part.label)) continue
      const kind = toneOf(part, seat)
      found.push({ key: `seg:${part.label}`, kind, label: part.label })
    }
  }
  return found
}

function rangeKeys(rows: readonly BarRow[]): BarKey[] {
  const found: BarKey[] = []
  if (rows.some((row) => row.tick !== null)) {
    found.push({ key: 'tick', kind: 'tick', label: '中位数' })
  }
  if (rows.some((row) => row.dot !== null)) {
    found.push({ key: 'dot', kind: 'dot', label: '均值' })
  }
  return found
}

function modeKeys(
  shown: readonly BarListItem[],
  rows: readonly BarRow[],
  options: BarListOptions,
): BarKey[] {
  if (options.mode === 'pairs') return pairKeys(options)
  if (options.mode === 'stacked') return stackKeys(shown)
  if (options.mode === 'range') return rangeKeys(rows)
  return []
}

/**
 * 图例：语义靠这行字第二次编码，读不出颜色差别的人也读得懂。
 *
 * ⚠ 参考线与阈值线不进图例：它们的名字挂在线的正上方（`ruleLabelsOf`）。摆进
 * 图例的话，读者要横跨大半张图才能把字与线对上，两条线的色块还长得差不多。
 */
function legendOf(
  shown: readonly BarListItem[],
  rows: readonly BarRow[],
  options: BarListOptions,
  ruler: Ruler,
): BarKey[] {
  const found = modeKeys(shown, rows, options)
  if (ruler.negative) found.push({ key: 'zero', kind: 'zero', label: '零线' })
  return found
}

/** 标签在轨道上大致占多宽，按轨道宽的百分数算。 */
function labelWidth(text: string): number {
  let wide = 0
  for (const glyph of text) {
    wide += (glyph.codePointAt(0) ?? 0) >= WIDE_FROM ? WIDE_REM : NARROW_REM
  }
  return (wide / TRACK_REM) * 100
}

/** 一块标签占的横向区间；`row` 由避让那一趟填，0 是挨着轨道那一行。 */
interface Slot {
  readonly kind: RuleKind
  readonly label: string
  readonly at: number
  readonly place: 'start' | 'mid' | 'end'
  readonly from: number
  readonly to: number
  row: number
}

/** 贴着轨道两端的标签改成单边对齐；居中摆的话半块字会写到轨道外面去。 */
function slotOf(line: Line, at: number): Slot {
  const wide = labelWidth(line.rule.label)
  const half = wide / 2
  const place = at - half < 0 ? 'start' : at + half > 100 ? 'end' : 'mid'
  const from = place === 'start' ? at : place === 'end' ? at - wide : at - half
  return {
    kind: line.kind,
    label: line.rule.label,
    at,
    place,
    from,
    to: from + wide,
    row: 0,
  }
}

/**
 * 标签避让：按左端排一遍，落进第一条塞得下的行。
 * Args: slots 就地写回 `row`；返回一共用了几行。
 */
function stagger(slots: readonly Slot[]): number {
  const ends: number[] = []
  for (const slot of [...slots].sort((one, two) => one.from - two.from)) {
    const found = ends.findIndex((end) => end + LABEL_CLEAR <= slot.from)
    // 哪一行都塞不下就另起一行；行数封顶后只能与最后一行挤着
    const seat = found >= 0 ? found : Math.min(ends.length, MAX_LABEL_ROW)
    ends[seat] = slot.to
    slot.row = seat
  }
  return Math.max(ends.length, 1)
}

/**
 * 竖线的名字：贴着自己那条线站（规格 §7「阈值线 = 虚线 + 文字标签」）。
 * Args: options 见 `BarListOptions`；ruler 用来把值折成落位。
 */
function ruleLabelsOf(
  options: BarListOptions,
  ruler: Ruler,
): { labels: BarRuleLabel[]; rows: number } {
  const slots: Slot[] = []
  for (const line of linesOf(options)) {
    const at = ruler.place(line.rule.value)
    if (at !== null) slots.push(slotOf(line, at))
  }
  const rows = stagger(slots)
  const labels = slots.map((slot) => ({
    key: slot.kind,
    kind: slot.kind,
    label: slot.label,
    place: slot.place,
    row: slot.row,
    style: { left: `${slot.at}%` },
  }))
  return { labels, rows }
}

/** 零线只在真有负值时才画：没有负值时零就是左边缘，再画一条是噪声。 */
function rulesOf(options: BarListOptions, ruler: Ruler): BarRule[] {
  const found: BarRule[] = []
  const zero = ruler.spot(0)
  if (ruler.negative && zero !== null) {
    found.push({ key: 'zero', kind: 'zero', style: zero })
  }
  for (const line of linesOf(options)) {
    const spot = ruler.spot(line.rule.value)
    if (spot !== null) {
      found.push({ key: line.kind, kind: line.kind, style: spot })
    }
  }
  return found
}

/**
 * 一次算出整张图：要画的行、竖线与图例，外加截断的账。
 * Args: items 调用方给的顺序即画的顺序；options 见 `BarListOptions`。
 */
export function buildBarList(
  items: readonly BarListItem[],
  options: BarListOptions,
): BarListView {
  const limit = Math.max(1, Math.min(options.maxItems, MAX_BAR_ROWS))
  const shown = items.slice(0, limit)
  const ruler = rulerOf(shown, options)
  const names = keyed(shown.map((item) => item.name))
  const rows = shown.map((item, seat) => {
    const key = names[seat] ?? item.name
    return {
      key,
      name: item.name,
      pieces: piecesOf(item, key, options.mode, ruler),
      whisker: whiskerOf(item, options.mode, ruler),
      tick: options.mode === 'range' ? ruler.spot(item.mid) : null,
      dot: options.mode === 'range' ? ruler.spot(item.mark) : null,
      text: textOf(item, options),
    }
  })
  const marks = ruleLabelsOf(options, ruler)
  return {
    rows,
    rules: rulesOf(options, ruler),
    ruleLabels: marks.labels,
    ruleRows: marks.rows,
    legend: legendOf(shown, rows, options, ruler),
    shown: shown.length,
    hidden: items.length - shown.length,
  }
}
