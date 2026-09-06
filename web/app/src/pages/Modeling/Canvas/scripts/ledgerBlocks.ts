/**
 * @fileoverview 三种「账」（rows / columns / cells）的算料：把块的 payload 折成
 * 能直接画的漏斗、归因条与那一行文字结论。
 *
 * ⚠ 一个数都不猜：payload 里没有的量（例如「这一列一共多少格」）宁可不印，也不
 * 拿手边的数去顶替（规格 §2-P4）。
 * ⚠ 漏斗按单位分组再画：`ledger_source` 的六级里前三级数的是列、后三级数的是行，
 * 3 与 50,000 挤在同一条轴上时，前三级会缩成一条看不见的丝。
 */
import { notesOf } from './blockNotes'
import { grouped, niceNumber, percentText } from './numbers'
import type { CellChange, ColumnChange, RowCounts } from './reportBlocks'
import { recordOf } from './reportBlocks'

type Item = Record<string, unknown>

/**
 * 后端逐块的硬上限，与 `operators/reporting.py` 的 `MAX_*` 逐个对齐。
 *
 * ⚠ 除漏斗外，条数正好等于上限时**无法判定**到底截没截：那几处 payload 不带
 * 原始总数，所以措辞一律是「已经列到上限」，不是「共 M 项」——后者要编一个数
 * 出来。漏斗带回了 `funnel_total`，那一处才说得出真的截没截。
 */
export const LEDGER_LIMITS = {
  funnel: 6,
  blame: 12,
  names: 60,
  dtypes: 12,
  cells: 12,
  samples: 3,
} as const

/** 漏斗的一级。⚠ `value` 为 null = 这一级的数拿不到，不是 0。 */
export interface FunnelStage {
  readonly name: string
  readonly value: number | null
  readonly unit: string
  readonly note: string
}

/** 同一个单位的那几级。 */
export interface FunnelGroup {
  readonly unit: string
  readonly stages: readonly FunnelStage[]
}

/** 按列的归因。`ratio` 的分母由产它的算子定，故这里只搬不解释。 */
export interface BlameItem {
  readonly key: string
  readonly count: number
  readonly ratio: number | null
}

/** 一列的类型前后对照。 */
export interface DtypeChange {
  readonly key: string
  readonly before: string
  readonly after: string
  /** 「前 → 后」拼好的那一格。 */
  readonly cast: string
}

/** 块上挂着的两档话：`alerts` 会让人读出错误结论，故整条摆出来。 */
export interface BlockNotices {
  readonly notes: readonly string[]
  readonly alerts: readonly string[]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 块上挂的口径说明与告警，两档由 `blockNotes` 一处读出。
 *
 * ⚠ 后端把两档并进了同一个 `notes` 键、逐句带 `level`（规格 §4.3）：这里再照
 * 「两个键」读的话，两档会双双读成空，而界面上「这一块没有话要说」与「话被
 * 读丢了」长得一模一样。
 * Args: payload。
 */
export function noticesOf(payload: Item): BlockNotices {
  const all = notesOf(payload)
  return {
    notes: all.filter((one) => one.level === 'hint').map((one) => one.text),
    alerts: all.filter((one) => one.level === 'alert').map((one) => one.text),
  }
}

/**
 * 「这一步静默退化了」的那句话；没退化就是空串。
 *
 * ⚠ 判断由后端做：真条件是下游切分的个数，前端沿着上游找会在没退化时乱报。
 * Args: payload。
 */
export function degradedReasonOf(payload: Item): string {
  return payload['degraded'] === true ? asText(payload['degraded_reason']) : ''
}

/**
 * 漏斗逐级。名字都读不出来的那一级丢掉：一条没有名字的条读不成账。
 * Args: funnel。
 */
export function stagesOf(funnel: readonly Item[]): FunnelStage[] {
  const kept: FunnelStage[] = []
  for (const item of funnel) {
    const one = recordOf(item)
    const name = asText(one['name'])
    if (name === '') continue
    kept.push({
      name,
      value: asNumber(one['value']),
      unit: asText(one['unit']),
      note: asText(one['note']),
    })
  }
  return kept
}

/**
 * 按单位把漏斗分组，组序按各单位第一次出现的先后。
 * Args: stages。
 */
export function groupStages(stages: readonly FunnelStage[]): FunnelGroup[] {
  const seats = new Map<string, FunnelStage[]>()
  for (const stage of stages) {
    const found = seats.get(stage.unit)
    if (found) found.push(stage)
    else seats.set(stage.unit, [stage])
  }
  return [...seats].map(([unit, group]) => ({ unit, stages: group }))
}

/**
 * 按列的归因。列名读不出来的那一项丢掉：无名的条挂不上账。
 * Args: byColumn。
 */
export function blameOf(byColumn: readonly Item[]): BlameItem[] {
  const kept: BlameItem[] = []
  for (const item of byColumn) {
    const one = recordOf(item)
    const key = asText(one['key'])
    if (key === '') continue
    kept.push({
      key,
      count: asNumber(one['count']) ?? 0,
      ratio: asNumber(one['ratio']),
    })
  }
  return kept
}

/**
 * 类型对照。三样有一样读不出来就整行丢掉：半行对照读不出换了什么。
 * Args: dtypeBefore。
 */
export function dtypesOf(dtypeBefore: readonly Item[]): DtypeChange[] {
  const kept: DtypeChange[] = []
  for (const item of dtypeBefore) {
    const one = recordOf(item)
    const key = asText(one['key'])
    const before = asText(one['before'])
    const after = asText(one['after'])
    if (key === '' || before === '' || after === '') continue
    kept.push({ key, before, after, cast: `${before} → ${after}` })
  }
  return kept
}

/** 占比；分母为零是「算不出来」，给 null 不给 0（规格 §2-P4）。 */
function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null
}

/** 括号里的占比；算不出来时连括号一起不写。 */
function shareTail(part: number, whole: number): string {
  const found = share(part, whole)
  return found === null ? '' : `（${percentText(found)}）`
}

/** 行数怎么变的那一句。 */
function movedText(counts: RowCounts): string {
  if (counts.dropped > 0) {
    const tail = shareTail(counts.dropped, counts.before)
    return `丢了 ${grouped(counts.dropped)} 行${tail}`
  }
  return counts.before === counts.after
    ? '一行都没丢'
    : '行数变了，但这一步没有丢行'
}

/** 因空值丢掉的那一句；`dropped_blank` 与总 `dropped` 不是一回事，分开印。 */
function blankText(counts: RowCounts): string {
  if (counts.droppedBlank <= 0) return ''
  const tail = shareTail(counts.droppedBlank, counts.dropped)
  return `其中 ${grouped(counts.droppedBlank)} 行是因为有空值${tail}`
}

/** 摊上最多的那一列；一列都没归因就不说。 */
function blameText(counts: RowCounts, blame: readonly BlameItem[]): string {
  const [top] = blame
  if (top === undefined) return ''
  const head = `按列看最多的是「${top.key}」：${grouped(top.count)} 行`
  if (counts.dropped <= 0) return head
  const found = share(top.count, counts.dropped)
  return found === null ? head : `${head}，占丢掉那些行的 ${percentText(found)}`
}

/**
 * 图下那一行文字结论：进来多少、出去多少、丢了多少、谁的锅（规格 §2-P6）。
 * Args: counts, blame。
 */
export function rowsSummary(
  counts: RowCounts,
  blame: readonly BlameItem[],
): string {
  const head = `${grouped(counts.before)} 行 → ${grouped(counts.after)} 行`
  const rest = [movedText(counts), blankText(counts), blameText(counts, blame)]
  return [head, ...rest.filter((text) => text !== '')].join('，')
}

/** 配的比例与实际达成的比例。两者不等在切分算子上是常事，故一律两个都印。 */
export interface RatioPair {
  readonly configured: string
  readonly actual: string
  /** 两个数都在且不相等：那正是用户要追的那一处。 */
  readonly isApart: boolean
}

/**
 * 比例这一对；两个都没有就整行不出现。
 * Args: counts。
 */
export function ratioPairOf(counts: RowCounts): RatioPair | null {
  const { ratioConfigured: configured, ratioActual: actual } = counts
  if (configured === null && actual === null) return null
  return {
    configured: configured === null ? '—' : percentText(configured * 100),
    actual: actual === null ? '—' : percentText(actual * 100),
    isApart: configured !== null && actual !== null && configured !== actual,
  }
}

/**
 * 列的账那一行结论。
 * Args: change, dtypes。
 */
export function columnsSummary(
  change: ColumnChange,
  dtypes: readonly DtypeChange[],
): string {
  const head = `这一步之后一共 ${grouped(change.kept)} 列`
  const moved: string[] = []
  if (change.added.length > 0) moved.push(`新增 ${change.added.length} 列`)
  if (change.removed.length > 0) moved.push(`移除 ${change.removed.length} 列`)
  if (dtypes.length > 0) moved.push(`${dtypes.length} 列换了类型`)
  return moved.length === 0
    ? `${head}：这一步一列都没动`
    : `${head}：${moved.join('、')}`
}

/**
 * 格子的账那一行结论。⚠ 行数一行没变正是这一类块的意思，要说出来——否则「改了
 * 2 格」会被读成「丢了 2 行」。
 * Args: cells。
 */
export function cellsSummary(cells: readonly CellChange[]): string {
  if (cells.length === 0) return '一个格子都没有被改，行数也没变'
  const total = cells.reduce((sum, item) => sum + item.changed, 0)
  const top = [...cells].sort((one, two) => two.changed - one.changed)[0]
  const head = `${cells.length} 列上一共改了 ${grouped(total)} 个格子，行数一行都没变`
  return top === undefined
    ? head
    : `${head}；最多的是「${top.key}」：${grouped(top.changed)} 格`
}

/**
 * 逐行的稳定键。同一个列名被讲两遍时按出现次数排号。
 *
 * ⚠ 不许拿数组下标当键：删掉中间一项会让其余整体错位，每行自己的展开状态跟着串行。
 * Args: names。
 */
export function keyedNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const times = (seen.get(name) ?? 0) + 1
    seen.set(name, times)
    return times > 1 ? `${name}·${times}` : name
  })
}

/**
 * 取值区间；两端都没有就说清为什么没有。
 * Args: low, high。
 */
export function rangeText(low: number | null, high: number | null): string {
  if (low === null && high === null) return '没有区间（这一列不是数值）'
  return `${niceNumber(low)} ~ ${niceNumber(high)}`
}

/**
 * 原值样例里的一个值。
 *
 * ⚠ null 是「这一格原本就是空」，不是读不出来：印成空字符串的话，一排样例里
 * 会凭空少一个，用户数不出到底带回了几个原值。
 * ⚠ 数走 `niceNumber` 而文本原样印：文本样例正是 `--`、`n/a` 这类占位符，改写
 * 一个字都会让用户对不上自己的台账。
 * Args: value。
 */
export function sampleText(value: string | number | null): string {
  if (value === null) return '（空）'
  return typeof value === 'number' ? niceNumber(value) : value
}
