/**
 * @fileoverview 「按项的一组数」这一块的算料：块级口径 + 逐项那几个键，折成横条
 * 要的行、指标卡要的格，以及图下那行必须有的文字结论。
 *
 * ⚠ 逻辑放在这里而不是组件里：退化分支（全 null / 全零 / 只有一项 / 顶到上限 /
 * 基准落在量程之外）只有当纯函数才测得到，挂载测试量不出一条条的长度。
 * ⚠ 这里一处都不查阈值表与单位表：列名当指标键塞进扁平字典是键空间冲突，某列
 * 恰好叫 `mape` 时无量纲的数会被印上百分号（结果展示规格 §4.3）。单位只认
 * payload 给的那个。
 */
import type { BarListItem, BarListRule, BarTone } from './barList'
import type { BlockNote } from './blockNotes'
import { notesOf, sortedNotes } from './blockNotes'
import { niceNumber } from './numbers'
import type { Breakdown, BreakdownItem } from './reportBlocks'
import { breakdownOf, recordOf } from './reportBlocks'
import type { StatItem } from './statCards'

/** 逐项的硬上限，与后端 `reporting.py::MAX_ITEMS` 逐字对齐。 */
export const MAX_BREAKDOWN_ITEMS = 60

/** 标量档：一组互不可比的数。⚠ 与后端 `reporting.py::TIER_SCALAR` 对齐。 */
export const TIER_SCALAR = 0

type Item = Record<string, unknown>

/** 一整块折好的样子。 */
export interface BreakdownView {
  readonly caption: string
  /** true = 摆成指标卡：标量档的几个数量纲不同，共用一根轴读不出东西。 */
  readonly isCards: boolean
  readonly cards: readonly StatItem[]
  readonly rows: readonly BarListItem[]
  readonly unit: string
  /** 画得进量程的基准线；null = 没有基准，或它落在量程之外。 */
  readonly reference: BarListRule | null
  /** 基准落在量程之外时照实说，不硬画到轴上。空串 = 没有这回事。 */
  readonly strayNote: string
  /** 顶到上限的实话。空串 = 没顶到。 */
  readonly capNote: string
  /** 图下那行文字结论（规格 §2-P6）。一项都没有时是空串。 */
  readonly summary: string
  /** 后端挂在这一块上的话，告警在前。 */
  readonly notes: readonly BlockNote[]
  readonly isEmpty: boolean
}

/** 一项上那几个共用读取器没读的键。 */
interface Extra {
  readonly unit: string
  /** 留没留下；null = 这一块不谈去留。 */
  readonly kept: boolean | null
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function keptOf(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function extrasOf(payload: Item): Extra[] {
  const raw = payload['items']
  const list = Array.isArray(raw) ? raw : []
  return list.map((one) => {
    const item = recordOf(one)
    return { unit: textOf(item['unit']), kept: keptOf(item['kept']) }
  })
}

/**
 * 这一项的单位：块级口径优先，块级空着时才用逐项那个。
 *
 * ⚠ 两者都空就是没有单位，不许拿别处的单位表去猜——那正是键空间冲突的来路。
 * Args: block 块级单位；own 这一项自带的。
 */
function unitOf(block: string, own: string): string {
  return block !== '' ? block : own
}

/** 整块共用一个单位时横条才挂得上；逐项不同就一个都不挂，改挂在读数里。 */
function sharedUnit(scale: Breakdown, extras: readonly Extra[]): string {
  if (scale.unit !== '') return scale.unit
  const units = new Set(extras.map((one) => one.unit))
  const [only] = [...units]
  return units.size === 1 && only !== undefined ? only : ''
}

/**
 * 条的语义色。位置才是主编码——负值本来就画在零线左侧，颜色只是第二重
 * （规格 §2-P6）。
 * Args: value 这一项的值；kept 留没留下。
 */
function toneOf(value: number | null, kept: boolean | null): BarTone {
  if (kept === false) return 'dropped'
  return value !== null && value < 0 ? 'neutral' : 'primary'
}

function rowsOf(scale: Breakdown, extras: readonly Extra[]): BarListItem[] {
  return scale.items.map((item, seat) => ({
    name: item.name,
    value: item.value,
    spread: item.spread,
    tone: toneOf(item.value, extras[seat]?.kept ?? null),
  }))
}

/**
 * 标量档的几张卡。
 *
 * ⚠ 算不出来的那一项**不给** `text`：给了之后卡片印的是一个读数，而这一项要说
 * 的是「这次没算」（规格 §2-P4）。
 * ⚠ 键带上座号：同名两项在一块里并不罕见（两侧同名的分），撞键会让第二张卡
 * 静默盖掉第一张。
 * Args: scale, extras。
 */
function cardsOf(scale: Breakdown, extras: readonly Extra[]): StatItem[] {
  return scale.items.map((item, seat) => {
    const unit = unitOf(scale.unit, extras[seat]?.unit ?? '')
    const tail = unit === '' ? '' : ` ${unit}`
    const spread = item.spread === null ? '' : ` ± ${niceNumber(item.spread)}`
    const card: StatItem = {
      key: `${seat}:${item.name}`,
      label: item.name,
      value: item.value,
    }
    return item.value === null
      ? card
      : { ...card, text: `${niceNumber(item.value)}${spread}${tail}` }
  })
}

/** 参与定标的所有端点：零永远在轴上，与横条那把尺子同一口径。 */
function reachOf(scale: Breakdown): number[] {
  const found = [0]
  for (const item of scale.items) {
    if (item.value === null) continue
    const spread = Math.abs(item.spread ?? 0)
    found.push(item.value - spread, item.value + spread)
  }
  return found
}

/**
 * 基准落不落得进这批条子的量程。
 *
 * ⚠ 落在量程之外时不许画：置换重要性的基准是「打乱前的那一分」（R²=0.9），
 * 而条子是掉的那几厘（0.12），硬画进去会把整排条子压成看不见的一丝。
 * Args: scale。
 */
function baselineFits(scale: Breakdown): boolean {
  const base = scale.baseline
  if (base === null) return false
  const reach = reachOf(scale)
  return base >= Math.min(...reach) && base <= Math.max(...reach)
}

function numbered(value: number | null, unit: string): string {
  const tail = value === null || unit === '' ? '' : ` ${unit}`
  return `${niceNumber(value)}${tail}`
}

/** 算得出来的那几项。⚠ `filter` 收窄不了类型，得自己写谓词。 */
function known(scale: Breakdown): (BreakdownItem & { value: number })[] {
  const found: (BreakdownItem & { value: number })[] = []
  for (const item of scale.items) {
    if (item.value !== null) found.push({ ...item, value: item.value })
  }
  return found
}

/** 值最大与最小的那两项；一项都算不出来时给 null。 */
function edgesOf(
  scale: Breakdown,
): { top: BreakdownItem; low: BreakdownItem } | null {
  const all = known(scale)
  const [first] = all
  if (first === undefined) return null
  let top = first
  let low = first
  for (const item of all) {
    if (item.value > top.value) top = item
    if (item.value < low.value) low = item
  }
  return { top, low }
}

/** 算不出来的那几项照实说，不写 0（规格 §2-P4）。 */
function blankText(blank: number): string {
  return blank === 0 ? '' : `；${blank} 项算不出来，写成「—」`
}

function cardSummary(scale: Breakdown): string {
  const blank = scale.items.filter((item) => item.value === null).length
  const total = scale.items.length
  return blank === 0
    ? `共 ${total} 个数，一个都不缺`
    : `共 ${total} 个数，其中 ${blank} 个算不出来，写成「无定义」`
}

/**
 * 两端那一句。
 *
 * ⚠ 全等值时不许照旧点名两端：那会印成「最高「0」24 行，最低「0」24 行」——同
 * 一个名字被说成两头（并列时两端取的是同一项，只有一项时更是如此），读者只会
 * 去找那两个不同的东西。
 * Args: edges 最高与最低那两项；unit 共用的单位；known 算得出来的项数。
 */
function edgeText(
  edges: { top: BreakdownItem; low: BreakdownItem },
  unit: string,
  known: number,
): string {
  const top = numbered(edges.top.value, unit)
  if (edges.top.value === edges.low.value) {
    if (known === 1) return `「${edges.top.name}」${top}`
    return `算得出来的 ${known} 项一样高，都是 ${top}`
  }
  const low = numbered(edges.low.value, unit)
  return `最高「${edges.top.name}」${top}，最低「${edges.low.name}」${low}`
}

function barSummary(scale: Breakdown, unit: string): string {
  const edges = edgesOf(scale)
  const total = scale.items.length
  const blank = scale.items.filter((item) => item.value === null).length
  if (edges === null) return `共 ${total} 项，没有一项算得出来`
  const negative = scale.items.filter(
    (item) => item.value !== null && item.value < 0,
  ).length
  const minus = negative === 0 ? '' : `；${negative} 项是负的，画在零线左侧`
  const said = edgeText(edges, unit, total - blank)
  return `共 ${total} 项：${said}${minus}${blankText(blank)}`
}

/** 基准那一条：画得进量程的画成线，画不进的退成一句话。 */
function baselineOf(
  scale: Breakdown,
  unit: string,
  isCards: boolean,
): { reference: BarListRule | null; strayNote: string } {
  const base = scale.baseline
  if (base === null) return { reference: null, strayNote: '' }
  const text = numbered(base, unit)
  if (!baselineFits(scale)) {
    return {
      reference: null,
      strayNote: `基准是 ${text}，落在这批数的量程之外，没有画到轴上`,
    }
  }
  return {
    reference: isCards ? null : { value: base, label: `基准 ${text}` },
    strayNote: isCards ? `这批数的基准是 ${text}` : '',
  }
}

/**
 * 一次把一块折好：横条要的行或指标卡、基准线、截断与那行文字结论。
 *
 * Args: payload 这一块的 payload；tier 0 标量 / 1 小数组 / 2 大数组。
 */
export function buildBreakdown(payload: Item, tier: number): BreakdownView {
  const scale = breakdownOf(payload)
  const extras = extrasOf(payload)
  const unit = sharedUnit(scale, extras)
  const isCards = tier === TIER_SCALAR
  const base = baselineOf(scale, unit, isCards)
  const isEmpty = scale.items.length === 0
  return {
    caption: scale.label,
    isCards,
    cards: isCards ? cardsOf(scale, extras) : [],
    rows: isCards ? [] : rowsOf(scale, extras),
    unit,
    reference: base.reference,
    strayNote: base.strayNote,
    capNote:
      scale.items.length < MAX_BREAKDOWN_ITEMS
        ? ''
        : `项数顶到了上限 ${MAX_BREAKDOWN_ITEMS} 项，后端可能还截掉了没列出来的那些`,
    summary: isEmpty
      ? ''
      : isCards
        ? cardSummary(scale)
        : barSummary(scale, unit),
    notes: sortedNotes(notesOf(payload)),
    isEmpty,
  }
}
