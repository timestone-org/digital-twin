/**
 * @fileoverview 趋势分析页的深链契约：「谁跳过来、预选哪一张台账」只在这里
 * 定义一次，跳转方与接收方共用。
 *
 * ⚠ 两端各写一份 query 键名的字面量时，写歪一个字符不会有任何报错：跳过去了、
 * 页面也打开了，只是什么都没预选中，用户以为这个入口没做完。故跳转方一律用
 * `datasetTrendTo()`，接收方一律用 `readTrendDeepLink()`，谁都不许直接摸
 * `route.query` 里的这两个键。
 */

/** 趋势分析页的两个数据源。 */
export const TREND_SOURCES = ['point', 'dataset'] as const
export type TrendSource = (typeof TREND_SOURCES)[number]

/** query 的键名。改这里就是两端一起改。 */
const KEY_SOURCE = 'source'
const KEY_TABLE_ID = 'tableId'

/** 趋势分析页的站内路径。 */
export const TREND_PATH = '/trend'

/** 跳转目标：一段可直接喂给 RouterLink 的 `to`。 */
export interface TrendLocation {
  path: string
  query: Record<string, string>
}

/**
 * 台账详情的「在趋势分析页打开」跳过去的地址。
 * @param tableId 要预选的台账 id
 */
export function datasetTrendTo(tableId: string): TrendLocation {
  return {
    path: TREND_PATH,
    query: { [KEY_SOURCE]: 'dataset', [KEY_TABLE_ID]: tableId },
  }
}

/** 从地址里读出来的预选。 */
export interface TrendDeepLink {
  source: TrendSource
  /** 没带、带空串或带了重复键（`?tableId=a&tableId=b`）时为 null。 */
  tableId: string | null
}

/**
 * 解析进来的 `route.query`。
 * ⚠ 不认识的 source 回落到点位源而不是空白页；tableId 是数组或空串时当没传，
 * 让用户自己选——静默选中第一张表会让人以为看的是自己点进来的那一张。
 * @param query 路由上的 query
 */
export function readTrendDeepLink(
  query: Record<string, unknown>,
): TrendDeepLink {
  const rawSource = query[KEY_SOURCE]
  const source: TrendSource = rawSource === 'dataset' ? 'dataset' : 'point'
  const rawId = query[KEY_TABLE_ID]
  const tableId = typeof rawId === 'string' && rawId !== '' ? rawId : null
  return { source, tableId }
}
