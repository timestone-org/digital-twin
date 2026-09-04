/**
 * @fileoverview 混淆矩阵的算料：由 `labels` 与 `matrix` 推每类的精确率 / 召回率 /
 * F1 / 支持度、行列合计、真实与预测两份分布占比、总准确率（设计规格 §5-21）。
 *
 * ⚠ 行是真实、列是预测（后端 `evaluate._confusion` 的口径）：召回率是对角格占
 * **行**合计，精确率是对角格占**列**合计。两者对调时，对称矩阵上一条用例都不会
 * 红，而类别不平衡的真矩阵上两个数会整个换位。
 * ⚠ 分母为 0 一律给 null 不给 0：没出现过的类目与没被判到过的类目，精确率与
 * 召回率是无定义；写成 0 就成了「这一类全判错了」（规格 §2-P4）。
 * ⚠ 热力强度对角格与错格分开归一：两半回答的是两个问题——对角格问「这一类判
 * 对了多少」，错格问「错都错到哪儿去了」。共用一把尺子时错格永远只占尺子的一
 * 小段，整片错格会糊成同一个深浅。
 */

/** 类目数上限：再多格子就细得读不出数了，超了不画热力表。 */
export const MAX_MATRIX_CLASSES = 20

/** 一格：计数、行内占比、热力强度、在不在对角线上。 */
export interface MatrixCell {
  readonly count: number
  /** 这一格占该行合计。行合计为 0 时无定义。 */
  readonly share: number | null
  readonly isHit: boolean
  /**
   * 热力强度 0–1，两半各按各的尺子：对角格 = 这一行的召回率，错格 = 与全表最深
   * 那一格的行数比开平方。0 = 这一格一行都没有，不上色。
   */
  readonly heat: number
}

/** 一个类目的一整套账。 */
export interface ClassStat {
  readonly label: string
  /** 对角格：真实是这一类、也判成了这一类的行数。 */
  readonly hit: number
  /** 行合计：真实是这一类的行数。 */
  readonly support: number
  /** 列合计：被判成这一类的行数。 */
  readonly predicted: number
  readonly precision: number | null
  readonly recall: number | null
  readonly f1: number | null
  readonly actualShare: number | null
  readonly predictedShare: number | null
}

export interface MatrixStats {
  readonly labels: readonly string[]
  readonly cells: readonly (readonly MatrixCell[])[]
  readonly classes: readonly ClassStat[]
  readonly total: number
  readonly correct: number
  readonly accuracy: number | null
  /** 错格里最多的一格有多少行：错格那半张图的热力尺子。全判对时是 0。 */
  readonly missPeak: number
  /** 读不成一张方阵时的实话。空串 = 没问题。 */
  readonly issue: string
}

interface Reading {
  readonly rows: readonly (readonly number[])[]
  readonly issue: string
}

/** 下标取数的兜底。方阵已核过，取不到只可能是核验被绕开了。 */
function at(values: readonly number[], index: number): number {
  return values[index] ?? 0
}

function sumOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0)
}

/** 占比。分母为 0 时无定义，给 null。 */
function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null
}

/** F1。⚠ P 与 R 双零时分母也是 0，那是无定义不是 0（规格 §5-21 的公式）。 */
function f1Of(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null
  const sum = precision + recall
  return sum > 0 ? (2 * precision * recall) / sum : null
}

/** 错格里最多的一格。全判对时是 0。 */
function missPeakOf(counts: readonly (readonly number[])[]): number {
  let peak = 0
  for (const [index, row] of counts.entries()) {
    for (const [column, count] of row.entries()) {
      if (column !== index && count > peak) peak = count
    }
  }
  return peak
}

/**
 * 一格的热力强度。
 * Args: count 这一格的行数, share 占该行合计, isHit 在不在对角线上,
 * peak 全表最深错格的行数。
 *
 * ⚠ 错格不按行内占比铺：错格天生只能凑 1−召回率，占比被对角格挤成一条窄缝，
 * 1 行与 15 行会画得一模一样。按**全表错格的最大值**归一才拿得回整个动态范围；
 * 按**每行**的错格最大值归一则会把「这一行只错了 1 行」画得和 500 行一样重。
 * ⚠ 开平方是压缩不是修饰：线性铺时小错格全挤在最浅的一档里分不开。
 */
function heatOf(
  count: number,
  share: number | null,
  isHit: boolean,
  peak: number,
): number {
  if (count <= 0) return 0
  if (isHit) return share ?? 0
  return peak > 0 ? Math.sqrt(count / peak) : 0
}

/** 逐列合计。 */
function columnTotals(counts: readonly (readonly number[])[]): number[] {
  const totals = counts.map(() => 0)
  for (const row of counts) {
    for (const [column, count] of row.entries()) {
      totals[column] = at(totals, column) + count
    }
  }
  return totals
}

/**
 * 把矩阵核成一张 n×n 的计数方阵，读不成就照实说是哪儿不对。
 * Args: labels 类目, matrix 逐行的计数。
 */
function readCounts(
  labels: readonly string[],
  matrix: readonly (readonly (number | null)[])[],
): Reading {
  const size = labels.length
  if (matrix.length !== size) {
    return {
      rows: [],
      issue: `${size} 个类目配着 ${matrix.length} 行矩阵，对不上，这张混淆矩阵没法画`,
    }
  }
  const rows: number[][] = []
  for (const [index, row] of matrix.entries()) {
    if (row.length !== size) {
      return {
        rows: [],
        issue: `第 ${index + 1} 行有 ${row.length} 格，${size} 个类目要 ${size} 格`,
      }
    }
    const counts: number[] = []
    for (const cell of row) {
      if (cell === null || !Number.isFinite(cell) || cell < 0) {
        return { rows: [], issue: `第 ${index + 1} 行有一格不是行数` }
      }
      counts.push(cell)
    }
    rows.push(counts)
  }
  return { rows, issue: '' }
}

/**
 * 逐格算料：计数、行内占比、对角与否、热力强度。
 * Args: counts 计数方阵, supports 逐行合计, peak 全表最深错格的行数。
 */
function cellsOf(
  counts: readonly (readonly number[])[],
  supports: readonly number[],
  peak: number,
): MatrixCell[][] {
  return counts.map((row, index) =>
    row.map((count, column) => {
      const share = ratio(count, at(supports, index))
      const isHit = column === index
      return { count, share, isHit, heat: heatOf(count, share, isHit, peak) }
    }),
  )
}

/**
 * 一个类目的一整套账。
 * Args: label 类名, support 行合计, predicted 列合计, hit 对角格, total 总行数。
 */
function statOf(
  label: string,
  support: number,
  predicted: number,
  hit: number,
  total: number,
): ClassStat {
  const precision = ratio(hit, predicted)
  const recall = ratio(hit, support)
  return {
    label,
    hit,
    support,
    predicted,
    precision,
    recall,
    f1: f1Of(precision, recall),
    actualShare: ratio(support, total),
    predictedShare: ratio(predicted, total),
  }
}

/**
 * 一张混淆矩阵能算出来的全部账。
 * Args: labels 类目（升序）, matrix 第 i 行第 j 列 = 真实第 i 类判成第 j 类的行数。
 */
export function buildMatrixStats(
  labels: readonly string[],
  matrix: readonly (readonly (number | null)[])[],
): MatrixStats {
  const reading = readCounts(labels, matrix)
  if (reading.issue !== '') {
    return {
      labels,
      cells: [],
      classes: [],
      total: 0,
      correct: 0,
      accuracy: null,
      missPeak: 0,
      issue: reading.issue,
    }
  }
  const counts = reading.rows
  const supports = counts.map(sumOf)
  const predicts = columnTotals(counts)
  const total = sumOf(supports)
  const correct = counts.reduce((sum, row, index) => sum + at(row, index), 0)
  const missPeak = missPeakOf(counts)
  return {
    labels,
    cells: cellsOf(counts, supports, missPeak),
    classes: counts.map((row, index) =>
      statOf(
        labels[index] ?? '',
        at(supports, index),
        at(predicts, index),
        at(row, index),
        total,
      ),
    ),
    total,
    correct,
    accuracy: ratio(correct, total),
    missPeak,
    issue: '',
  }
}
