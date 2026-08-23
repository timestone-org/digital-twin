/**
 * @fileoverview 台账列表上那几格的取值口径：关键字匹配、取数方式、周期与保留期。
 *
 * ⚠ 这里**不写「未生效」一类的运行状态**：聚合采集器与保留期清理的总开关随
 * 第 5 期落地，眼下前端读不到它们的真实取值。写死一句「未生效」与写死一句
 * 「已生效」是同一种谎（docs/DATASET_DESIGN.md §7.9），故一句都不写。
 */

import type { DatasetTableSummary } from '@dt/contracts'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * 这一行是不是命中了关键字。按名称与编码两处匹配，与后端 `?q=` 同口径。
 * @param table 一行台账
 * @param keyword 搜索词，空串即不过滤
 */
export function matchesKeyword(
  table: DatasetTableSummary,
  keyword: string,
): boolean {
  const needle = keyword.trim().toLowerCase()
  if (needle === '') return true
  return (
    table.name.toLowerCase().includes(needle) ||
    table.code.toLowerCase().includes(needle)
  )
}

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

/**
 * 保留期那一格。
 * @param retentionDays 保留天数，null = 永久
 */
export function retentionLabel(retentionDays: number | null): string {
  return retentionDays === null ? '永久' : `${retentionDays} 天`
}
