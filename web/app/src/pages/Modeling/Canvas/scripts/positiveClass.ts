/**
 * @fileoverview 分类评估的「正类是哪一个」：摘要里没有这一项，只能由报上来的
 * 精确率 / 召回率反查是哪一类（设计规格 §5-21、R-20）。
 *
 * ⚠ 这不是猜：后端的 TP/FP/FN 与混淆矩阵的行合计、列合计是同一批计数
 * （`evaluate._classification_scores` 与 `evaluate._confusion` 读的是同一对
 * truth/predicted），对得上就是它，对不上或对上两个就照实说不知道。
 */
import type { ClassStat } from './matrixStats'

/**
 * `found` 有徽标可画；`absent` 是正类一行都没出现过（P/R 双双无定义）；
 * `ambiguous` 是有两类的 P/R 一模一样，分不出来；`unknown` 是这份摘要根本没有
 * 正类相关指标，或测试集是空的。
 */
export type PositiveClassKind = 'found' | 'absent' | 'ambiguous' | 'unknown'

export interface PositiveClass {
  readonly kind: PositiveClassKind
  /** `found` 之外一律空串。 */
  readonly label: string
}

// 两个比率算不算同一个：同一批整数除出来本该逐位相同，留的是 JSON 往返的余量
const CLOSE = 1e-12

const NOTHING: PositiveClass = { kind: 'unknown', label: '' }

/** 两个比率是不是同一个。两边都无定义也算同一个。Args: left, right。 */
function same(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right
  return Math.abs(left - right) <= CLOSE * Math.max(1, Math.abs(left))
}

/**
 * 报上来的精确率与召回率是相对哪一类算的。
 *
 * ⚠ P 与 R 双双无定义 ⟺ 正类既没出现过也没被判到过 ⟺ 它不在 `labels` 里：
 * `labels` 是真实与预测两个集合的并集，在里面的类目至少有一侧的分母非零。
 * Args: classes 逐类的账, metrics 后端报上来的指标。
 */
export function positiveClassOf(
  classes: readonly ClassStat[],
  metrics: readonly (readonly [string, number | null])[],
): PositiveClass {
  const table = new Map(metrics)
  if (!table.has('precision') || !table.has('recall')) return NOTHING
  if (classes.length === 0) return NOTHING
  const precision = table.get('precision') ?? null
  const recall = table.get('recall') ?? null
  if (precision === null && recall === null)
    return { kind: 'absent', label: '' }
  const hit = classes.filter(
    (item) => same(item.precision, precision) && same(item.recall, recall),
  )
  const only = hit.length === 1 ? hit[0] : undefined
  if (only === undefined) return { kind: 'ambiguous', label: '' }
  return { kind: 'found', label: only.label }
}
