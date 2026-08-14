/**
 * @fileoverview 折外预测的汇总口径：平均绝对误差、按折稳定性、错得最离谱的几条。
 *
 * ⚠ 空集一律给 null 不给 0：「这个组合没有热行」与「这个组合零误差」是两回事，
 * 折成 0 会把没数据说成完美。
 */
import type { ModelPrediction } from '@dt/contracts'

import { signedError } from '@/features/hvac/modelView'

/** Top 榜取几条。 */
const TOP_ERROR_COUNT = 5

/** 一折的稳定性。⚠ 该折没有热行时 `hotMae` 是 null，不是 0。 */
export interface FoldStat {
  fold: number
  hotMae: number | null
  count: number
}

/** 平均绝对误差；空集给 null。 */
export function meanAbsError(rows: readonly ModelPrediction[]): number | null {
  if (rows.length === 0) return null
  const sum = rows.reduce((acc, row) => acc + Math.abs(signedError(row)), 0)
  return sum / rows.length
}

/** 按折汇总，折号升序。K 折数按数据里实际出现的去重，不写死 5。 */
export function foldStatsOf(rows: readonly ModelPrediction[]): FoldStat[] {
  const byFold = new Map<number, ModelPrediction[]>()
  for (const row of rows) {
    const bucket = byFold.get(row.fold)
    if (bucket === undefined) byFold.set(row.fold, [row])
    else bucket.push(row)
  }
  return [...byFold.entries()]
    .sort(([left], [right]) => left - right)
    .map(([fold, items]) => ({
      fold,
      hotMae: meanAbsError(items.filter((row) => row.actual_minutes > 0)),
      count: items.length,
    }))
}

/**
 * 误差最大的几次。
 * ⚠ **不排除零行**：一条实际 0 分钟却被预测成 40 分钟的记录是严重错误，
 * 藏起来说不过去。
 */
export function topErrorsOf(
  rows: readonly ModelPrediction[],
): ModelPrediction[] {
  return [...rows]
    .sort(
      (left, right) =>
        Math.abs(signedError(right)) - Math.abs(signedError(left)),
    )
    .slice(0, TOP_ERROR_COUNT)
}
