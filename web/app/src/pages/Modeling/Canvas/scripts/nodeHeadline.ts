/**
 * @fileoverview 一句话结果：跑完之后直接印在节点卡片上的那行数字。
 *
 * ⚠ 卡片上要看得见数：都藏在弹窗里的话，用户想比较两步之间行数掉了多少，得把
 * 两个弹窗轮流开关四次——而这正是看中间结果最常见的用法。
 */
import { grouped, niceNumber } from './numbers'
import type { Preview } from './preview'
import { portPreviewsOf } from './preview'

/**
 * 指标名在卡片上的短写法。列在这里的按顺序取前两个印出来。
 *
 * ⚠ 键名逐条对着后端真正产出的那四组（`evaluate.py::_metrics_of` 与
 * `_classification_scores`、`diagnostics.py::_residual_stats` 与 `_summary`）：
 * 漏掉一组，那个算子的卡片上就一个字都没有。`feature_importance` 的键是列名，
 * 数量与写法都由数据定，故不在这份名单里。
 */
const HEADLINE_METRICS: readonly [string, string][] = [
  ['r2', 'R²'],
  ['rmse', 'RMSE'],
  ['mae', 'MAE'],
  ['accuracy', '准确率'],
  ['f1', 'F1'],
  ['precision', '精确率'],
  ['recall', '召回率'],
  ['residual_mean', '残差均值'],
  ['residual_std', '残差标准差'],
  ['residual_max_abs', '最大残差'],
  ['score_mean', '折均分'],
  ['score_worst', '最差折'],
  ['folds', '折数'],
]

/** 卡片上最多印几个指标。再多一行就放不下了。 */
const MAX_METRICS = 2

function metricsLine(pairs: readonly [string, number | null][]): string {
  const table = new Map(pairs)
  const shown: string[] = []
  for (const [key, label] of HEADLINE_METRICS) {
    // ⚠ 无定义（null）的指标整条不印：`niceNumber` 会给「—」，而卡片上摆一个
    // 「R² —」等于用一行的位置说了句废话
    const value = table.get(key)
    if (value === undefined || value === null) continue
    shown.push(`${label} ${niceNumber(value)}`)
    if (shown.length >= MAX_METRICS) break
  }
  return shown.join(' · ')
}

/** 这一步的一句话结果。没什么好说的时候给空串，卡片就不印这一行。 */
export function headlineOf(preview: Preview): string {
  if (preview.kind === 'frame') {
    return `${grouped(preview.rowCount)} 行 × ${preview.colCount} 列`
  }
  if (preview.kind === 'model') {
    const features = preview.featureKeys.length
    return features === 0 ? preview.algo : `${features} 个特征`
  }
  if (preview.kind === 'metrics') return metricsLine(preview.metrics)
  return ''
}

/**
 * 直接读一个节点的结果摘要，给出卡片上那行数字。
 *
 * ⚠ 摘要**按端口建键**（见 `preview.ts::portPreviewsOf`）：拿整包去读 `kind`
 * 永远读不到，卡片上那行会一直是空的。
 * ⚠ 只取头一路说得出话的：卡片上只有一行的位置，而多路输出的那几步（切分、
 * 回归）在结果弹窗里是逐路摆开的。
 * Args: payload。
 */
export function headlineFromPayload(payload: Record<string, unknown>): string {
  for (const item of portPreviewsOf(payload)) {
    const line = headlineOf(item.preview)
    if (line !== '') return line
  }
  return ''
}
