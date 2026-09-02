/**
 * @fileoverview 一句话结果：跑完之后直接印在节点卡片上的那行数字。
 *
 * ⚠ 卡片上要看得见数：都藏在弹窗里的话，用户想比较两步之间行数掉了多少，得把
 * 两个弹窗轮流开关四次——而这正是看中间结果最常见的用法。
 */
import type { Preview } from './preview'

/** 指标名在卡片上的短写法。列在这里的按顺序取前两个印出来。 */
const HEADLINE_METRICS: readonly [string, string][] = [
  ['r2', 'R²'],
  ['rmse', 'RMSE'],
  ['mae', 'MAE'],
  ['accuracy', '准确率'],
  ['f1', 'F1'],
]

/** 卡片上最多印几个指标。再多一行就放不下了。 */
const MAX_METRICS = 2

/** 一个数印在卡片上的样子：四位有效小数，整数不补零。 */
function short(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * 行数带千分位——六位数字连成一串读不出量级。
 *
 * ⚠ 自己插逗号而不用 `toLocaleString`：本仓的 CI runner 是中文 locale、开发机
 * 是 en-US，不钉 locale 的格式化会本地绿、CI 红。
 */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function metricsLine(pairs: readonly [string, number | null][]): string {
  const table = new Map(pairs)
  const shown: string[] = []
  for (const [key, label] of HEADLINE_METRICS) {
    // ⚠ 无定义（null）的指标不往卡片上印：印成 0 就是一个假数
    const value = table.get(key)
    if (value === undefined || value === null) continue
    shown.push(`${label} ${short(value)}`)
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
