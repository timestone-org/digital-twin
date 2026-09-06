/**
 * @fileoverview 逐类总账的算料：把混淆矩阵折成每类一行「支持度 / F1 / 最常错判
 * 成」，并按其中一列重排（设计规格 §5-21）。
 *
 * ⚠ 这张表不复述矩阵边栏已经印过的精确率与召回率：那两个数在矩阵上一个贴着行
 * 尾、一个贴着列脚，口径由位置说清楚；表这一处回答的是另一个问题——跨类排名，
 * 哪一类最弱、它主要错到哪儿去，而这两样矩阵都要靠眼睛横扫才读得出来。
 * ⚠ F1 无定义的那些永远排在最后，不当成 0：0 是「全判错」，无定义是「算不出
 * 来」，把它们混在一起排会把没出现过的类目排成最差的一类。
 */
import type { ClassStat, MatrixCell, MatrixStats } from './matrixStats'

/**
 * 可排序的三列。
 *
 * ⚠ 不给类名排：CI 跑在中文 locale、开发机是 en-US，两边 `localeCompare` 的
 * 字序不同，按类名排的用例会本地绿、CI 红。
 */
export const LEDGER_KEYS = ['support', 'f1', 'miss'] as const

export type LedgerKey = (typeof LEDGER_KEYS)[number]

/** 一个类目在总账上的一行。 */
export interface LedgerRow {
  readonly id: string
  readonly label: string
  /** 真实是这一类的行数。 */
  readonly support: number
  readonly f1: number | null
  /** 错得最多的那一格判成了哪一类。一格都没错时是空串。 */
  readonly missLabel: string
  readonly missCount: number
}

/** 默认序：最弱的一类排在最上面。 */
export const DEFAULT_LEDGER_SORT: { key: LedgerKey; desc: boolean } = {
  key: 'f1',
  desc: false,
}

export function isLedgerKey(value: string): value is LedgerKey {
  return LEDGER_KEYS.some((key) => key === value)
}

/**
 * 这一行错得最多的那一格。
 * Args: cells 这一行的格子, labels 列名。
 *
 * ⚠ 并列时取靠前的那一格：`>` 而不是 `>=`，否则同为最大值的两类会按列序抖动。
 */
function worstMissOf(
  cells: readonly MatrixCell[],
  labels: readonly string[],
): { label: string; count: number } {
  let seat = -1
  let peak = 0
  for (const [column, cell] of cells.entries()) {
    if (cell.isHit || cell.count <= peak) continue
    seat = column
    peak = cell.count
  }
  return { label: seat < 0 ? '' : (labels[seat] ?? ''), count: peak }
}

function rowOf(
  stat: ClassStat,
  index: number,
  cells: readonly MatrixCell[],
  labels: readonly string[],
): LedgerRow {
  const miss = worstMissOf(cells, labels)
  return {
    id: `class-${index}`,
    label: stat.label,
    support: stat.support,
    f1: stat.f1,
    missLabel: miss.label,
    missCount: miss.count,
  }
}

/** 每类一行。行序就是矩阵的行序，重排由 `sortLedger` 单独做。 */
export function buildClassLedger(stats: MatrixStats): LedgerRow[] {
  return stats.classes.map((stat, index) =>
    rowOf(stat, index, stats.cells[index] ?? [], stats.labels),
  )
}

/** 这一列的取值。无定义给 null。 */
function valueOf(row: LedgerRow, key: LedgerKey): number | null {
  if (key === 'support') return row.support
  if (key === 'f1') return row.f1
  return row.missCount
}

/**
 * 按一列重排。
 * Args: rows, sort 排序键与方向。
 *
 * ⚠ 排序不改原数组：`Array.prototype.sort` 是就地排的，直接排 computed 拿到的
 * 那份会把上游的行序也一起换掉。
 */
export function sortLedger(
  rows: readonly LedgerRow[],
  sort: { key: string; desc: boolean },
): LedgerRow[] {
  if (!isLedgerKey(sort.key)) return [...rows]
  const key = sort.key
  const turn = sort.desc ? -1 : 1
  return [...rows].sort((left, right) => {
    const one = valueOf(left, key)
    const other = valueOf(right, key)
    if (one === null || other === null) {
      return one === other ? 0 : one === null ? 1 : -1
    }
    return (one - other) * turn
  })
}
