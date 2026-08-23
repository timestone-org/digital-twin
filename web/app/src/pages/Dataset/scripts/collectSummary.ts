/**
 * @fileoverview 取数方式那一格的口径。列表页与详情页共用，故放在分组目录的
 * `scripts/` 而不是任一页自己的目录里——两页各写一份会漂，一页引另一页的
 * 私有脚本又会让被引的那页不敢重构。
 *
 * ⚠ 这里**不写「未生效」一类的运行状态**：聚合采集器的总开关随第 5 期落地，
 * 眼下前端读不到它的真实取值。写死一句「未生效」与写死一句「已生效」是同一种
 * 谎（docs/DATASET_DESIGN.md §7.9），故一句都不写。
 */

import type { DatasetTableSummary } from '@dt/contracts'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * 桶宽的人话。整除才进位，`90000` 显示成「90 秒」而不是「1.5 分钟」——
 * 台账周期是要拿去对采集节拍的，四舍五入过的数对不上。
 * @param intervalMs 一行覆盖的桶宽，毫秒
 */
export function formatInterval(intervalMs: number): string {
  const units: readonly (readonly [number, string])[] = [
    [DAY_MS, '天'],
    [HOUR_MS, '小时'],
    [MINUTE_MS, '分钟'],
    [SECOND_MS, '秒'],
  ]
  for (const [size, unit] of units) {
    if (intervalMs >= size && intervalMs % size === 0) {
      return `${intervalMs / size} ${unit}`
    }
  }
  return `${intervalMs} 毫秒`
}

/** 取数方式那一格：一句标签加一句解释。 */
export interface CollectSummary {
  label: string
  hint: string
}

/**
 * 取数方式。
 * ⚠ 认不出的档位显示原始代码而不是藏起来：后端加了一档而前端还没跟上时，
 * 「显示成空白」会被读成「这张台账没配」（§7.13）。
 * @param table 一行台账
 */
export function collectSummary(table: DatasetTableSummary): CollectSummary {
  if (table.collect_mode === 'manual') {
    return { label: '人工录入', hint: '行由人手工填，不从点位历史汇总。' }
  }
  if (table.collect_mode === 'aggregate') {
    const every = formatInterval(table.collect_interval_ms)
    return {
      label: `自动采集 · 每 ${every}`,
      hint: `每 ${every} 从点位历史汇总出一行。`,
    }
  }
  return {
    label: table.collect_mode,
    hint: '这个取数方式本界面还不认识，按后端的取值原样显示。',
  }
}
