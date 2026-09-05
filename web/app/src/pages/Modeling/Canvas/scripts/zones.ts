/**
 * @fileoverview 结果面的分区顺序：块自带分区、不自带顺序，摆哪儿由这张常量表定。
 *
 * ⚠ 顺序不看 `report.blocks` 的数组顺序：24 个算子分批写，顺序若由每条自己定，
 * 两批人写出来的结果面读着不像同一个产品（结果展示规格 §2-P1）。
 */

/** 五个分区，声明顺序就是渲染顺序。⚠ 与后端 `reporting.py::ZONES` 逐字对齐。 */
export const ZONE_ORDER = [
  'step',
  'stats',
  'charts',
  'formula',
  'table',
] as const

export type ReportZone = (typeof ZONE_ORDER)[number]

/** 区名。锚点条与各区的小标题印的都是它。 */
export const ZONE_TITLES: Record<ReportZone, string> = {
  step: '这一步做了什么',
  stats: '关键数字',
  charts: '对比图',
  formula: '怎么算的',
  table: '完整数据',
}

/** 「完整数据」那一区：主体视图与它自己的块摆在一处。 */
export const TABLE_ZONE: ReportZone = 'table'

/** 「对比图」那一区：唯一一个再分主体位与辅图格的区（规格 §3.2）。 */
export const CHART_ZONE: ReportZone = 'charts'

/** 「怎么算的」那一区：公式摆在这儿，而公式不是块（规格 §6）。 */
export const FORMULA_ZONE: ReportZone = 'formula'

/** 摆在主体视图之前的四区。 */
export const LEAD_ZONES: readonly ReportZone[] = ZONE_ORDER.filter(
  (zone) => zone !== TABLE_ZONE,
)

export function isReportZone(value: string): value is ReportZone {
  return ZONE_ORDER.some((zone) => zone === value)
}

/** 一个分区连它的块。 */
export interface ZoneGroup<T> {
  zone: ReportZone
  blocks: T[]
}

/**
 * 按 `ZONE_ORDER` 分区。空区不产——没有块的区连标题都不摆。
 *
 * ⚠ 遍历的是 `ZONE_ORDER` 而不是 `zones`：调用方把分区写颠倒也排不乱。
 * Args: blocks；zones 只挑这几区，缺省全要。
 */
export function groupByZone<T extends { zone: ReportZone }>(
  blocks: readonly T[],
  zones: readonly ReportZone[] = ZONE_ORDER,
): ZoneGroup<T>[] {
  const groups: ZoneGroup<T>[] = []
  for (const zone of ZONE_ORDER) {
    if (!zones.includes(zone)) continue
    const kept = blocks.filter((block) => block.zone === zone)
    if (kept.length > 0) groups.push({ zone, blocks: kept })
  }
  return groups
}

/**
 * 挑出属于某一路输出的块。空串是节点级——它不属于任何一个端口。
 *
 * Args: blocks, port。
 */
export function blocksOfPort<T extends { port: string }>(
  blocks: readonly T[],
  port: string,
): T[] {
  return blocks.filter((block) => block.port === port)
}

/**
 * 给某一区留一个位置，哪怕它一块都没有。
 *
 * ⚠ 公式随算子代码走、不随运行走，因此不是块（规格 §6）：只按块分区的话，④ 区
 * 在「有公式没块」的算子上整个不出现，而那正是最该有公式的那几个。
 * Args: groups 已经按 `ZONE_ORDER` 排好的分组；zone 要留位置的那一区。
 */
export function withZone<T>(
  groups: readonly ZoneGroup<T>[],
  zone: ReportZone,
): ZoneGroup<T>[] {
  if (groups.some((group) => group.zone === zone)) return [...groups]
  const seat = ZONE_ORDER.indexOf(zone)
  const at = groups.findIndex((group) => ZONE_ORDER.indexOf(group.zone) > seat)
  const one: ZoneGroup<T> = { zone, blocks: [] }
  if (at < 0) return [...groups, one]
  return [...groups.slice(0, at), one, ...groups.slice(at)]
}
