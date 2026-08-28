/**
 * @fileoverview 照抄绑定的匹配逻辑（docs/AI_ASSISTANT_V3_PLAN.md §2.3）：
 * 两组行 + 一种对齐方式 → 抄哪些、跳哪些。纯算，一条绑定都不写。
 *
 * ⚠ 抄的是**取数来源**，不是配置：单位、标题、阈值归 `set_config`。两件事混在
 * 一起时，用户说「照 1 号机组接一下」会连标题一起变成「1 号机组…」。
 * ⚠ 按名字对不上的行进 `skipped`，**绝不退回按行号硬抄**：行号对齐是这套数组
 * 绑定最容易「每条都有值、全接错对象」的地方。
 */
import type { BindingSourceKind, BindingView } from '@dt/contracts'

import type { BindingRowInput } from './bindingReport'

/** 两侧怎么对齐。⚠ 缺省按名字：行号相同不代表喂的是同一个实体。 */
export const COPY_MATCHES = ['by_label', 'by_index'] as const

export type CopyMatch = (typeof COPY_MATCHES)[number]

/** 参与照抄的一侧：行表加它此刻的绑定。 */
export interface CopySide {
  /**
   * 这一侧的行，按文档序。
   * ⚠ `label` 是拿来**对齐**的那半个名字，不是整行的显示名：同一段孪生里两块
   * 信息板的行都叫「板名 · 字段名」，带上板名的话按名字永远对不上。
   * ⚠ 只放要参与照抄的那些行：`by_index` 数的是行在**本组本槽里的第几个**，
   * 而不是 `index` 那个文档序——照抄常常发生在两个实体之间，而它们的文档序
   * 差着一大截。
   */
  rows: readonly BindingRowInput[]
  bindings: readonly BindingView[]
}

/**
 * 抄成了的一条。
 * ⚠ 这里**不带取数明细**（常量值、历史窗、派生规格）：写的那一步按
 * `from_field_key` 回源上取整条绑定，把明细也誊一份进结果就多了一份真源，
 * 而漏誊一格的绑定存得下去、永远取不到数。
 */
export interface CopiedBinding {
  from_field_key: string
  to_field_key: string
  source_kind: BindingSourceKind
  node_key: string | null
  matched_by: CopyMatch
  /** 目标那一行原本已经接着东西，这次盖掉了。模型据此跟用户交代。 */
  is_overwrite: boolean
}

/** 没抄的一条，附上为什么。 */
export interface SkippedBinding {
  from_field_key: string
  reason: string
}

/** 一次照抄的结果。 */
export interface CopyPlan {
  copied: CopiedBinding[]
  skipped: SkippedBinding[]
  is_dry_run: boolean
}

export interface CopyPlanInput {
  from: CopySide
  to: CopySide
  match: CopyMatch
  isDryRun: boolean
}

const AMBIGUOUS_SOURCE = '源这一侧有多行同名，认不出该抄哪一行'
const AMBIGUOUS_TARGET = '目标那一侧有多行同名，认不出该抄给哪一行'
const NO_LABEL = '这一行没有名字，按名字对不上'
const NO_MATCH_LABEL = '目标处没有同名的行'
const NO_MATCH_INDEX = '目标处这个槽没有第这么多行'

/** 按名字对齐时的键。 */
function labelKeyOf(row: BindingRowInput): string {
  return row.label.trim()
}

/** 一行加上它在自己那一侧的对齐键。 */
interface KeyedRow {
  row: BindingRowInput
  key: string
}

/**
 * 给一侧的每一行算对齐键。
 * ⚠ `by_index` 的键是「本槽里的第几个」而不是 `index` 那个文档序：照抄常发生在
 * 两个实体之间，两边的文档序差着一大截，按 `index` 对的话一条都对不上。
 * ⚠ 序号数的是**整张行表**，不是接了数据源的那些：只数已绑的行会让空行后面的
 * 每一行都错开一格，而错开之后每条都抄得进去、全接错对象。
 */
function keyRows(
  rows: readonly BindingRowInput[],
  match: CopyMatch,
): KeyedRow[] {
  const ordinals = new Map<string, number>()
  return rows.map((row) => {
    const ordinal = ordinals.get(row.slotKey) ?? 0
    ordinals.set(row.slotKey, ordinal + 1)
    return {
      row,
      key: match === 'by_label' ? labelKeyOf(row) : `${row.slotKey}#${ordinal}`,
    }
  })
}

/** 一侧里出现过不止一次的键。 */
function duplicatesOf(keyed: readonly KeyedRow[]): Set<string> {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const one of keyed) {
    if (seen.has(one.key)) twice.add(one.key)
    seen.add(one.key)
  }
  return twice
}

/** 一侧按键取行，同键只留第一条（重名的键本来就会被判含糊）。 */
function firstByKey(keyed: readonly KeyedRow[]): Map<string, BindingRowInput> {
  const found = new Map<string, BindingRowInput>()
  for (const one of keyed) {
    if (!found.has(one.key)) found.set(one.key, one.row)
  }
  return found
}

/** 对齐的结论：要么对上了那一行，要么说得出为什么没对上。 */
type RowMatch = { row: BindingRowInput } | { reason: string }

/** 对齐一条源行。 */
function matchOf(parts: {
  keyed: KeyedRow
  match: CopyMatch
  sourceDuplicated: ReadonlySet<string>
  targetDuplicated: ReadonlySet<string>
  targetByKey: ReadonlyMap<string, BindingRowInput>
}): RowMatch {
  const { key } = parts.keyed
  if (parts.match === 'by_label' && key === '') return { reason: NO_LABEL }
  if (parts.sourceDuplicated.has(key)) return { reason: AMBIGUOUS_SOURCE }
  if (parts.targetDuplicated.has(key)) return { reason: AMBIGUOUS_TARGET }
  const found = parts.targetByKey.get(key)
  if (found === undefined) {
    return {
      reason: parts.match === 'by_label' ? NO_MATCH_LABEL : NO_MATCH_INDEX,
    }
  }
  return { row: found }
}

/** 源那边接了数据源、因而真有东西可抄的那些行。 */
interface Candidate {
  keyed: KeyedRow
  binding: BindingView
}

function candidatesOf(side: CopySide, match: CopyMatch): Candidate[] {
  const bound = new Map(side.bindings.map((one) => [one.fieldKey, one]))
  const found: Candidate[] = []
  for (const keyed of keyRows(side.rows, match)) {
    const binding = bound.get(keyed.row.fieldKey)
    if (binding !== undefined) found.push({ keyed, binding })
  }
  return found
}

/**
 * 算一次照抄：抄哪些、跳哪些。
 * ⚠ 源那边没接数据源的行**不算候选**，也不进 `skipped`：几十个锚点里只接了
 * 三个是常态，把另外三十几个列成「跳过」会把真正没抄成的那几条淹掉。
 * @param input 两侧的行与绑定、对齐方式、是不是只看不动手
 */
export function planCopyBindings(input: CopyPlanInput): CopyPlan {
  const candidates = candidatesOf(input.from, input.match)
  const targetKeyed = keyRows(input.to.rows, input.match)
  // ⚠ 源那边只按**接了数据源的行**判重名：同名的另一行没接过东西时并不含糊，
  //   照样抄得了——按全部行判会把一次完全清楚的照抄拒掉
  const parts = {
    match: input.match,
    sourceDuplicated: duplicatesOf(candidates.map((one) => one.keyed)),
    targetDuplicated: duplicatesOf(targetKeyed),
    targetByKey: firstByKey(targetKeyed),
  }
  const toBound = new Set(input.to.bindings.map((one) => one.fieldKey))
  const copied: CopiedBinding[] = []
  const skipped: SkippedBinding[] = []
  for (const { keyed, binding } of candidates) {
    const found = matchOf({ keyed, ...parts })
    if ('reason' in found) {
      skipped.push({ from_field_key: keyed.row.fieldKey, reason: found.reason })
      continue
    }
    copied.push({
      from_field_key: keyed.row.fieldKey,
      to_field_key: found.row.fieldKey,
      source_kind: binding.sourceKind,
      node_key: binding.nodeKey,
      matched_by: input.match,
      is_overwrite: toBound.has(found.row.fieldKey),
    })
  }
  return { copied, skipped, is_dry_run: input.isDryRun }
}

/** 入参里那个对齐方式；不给按名字，认不出的一律直说。 */
export function copyMatchOf(given: unknown): CopyMatch {
  if (given === undefined || given === null) return 'by_label'
  const found = COPY_MATCHES.find((one) => one === given)
  if (found === undefined) {
    const named = typeof given === 'string' ? given : '这个'
    throw new Error(`match 只认 by_label 与 by_index，不认识 ${named}`)
  }
  return found
}
