/** @fileoverview 历史桶转曲线；缺失桶显式留空，避免跨断档连线。 */
import type { CollectPoint, CollectHistoryAggregate } from '@dt/contracts'
import type { DtChartSeries, DtChartPoint } from '@dt/ui'

export function pointHistorySeries(
  point: CollectPoint | null,
  result: CollectHistoryAggregate | null,
): DtChartSeries[] {
  if (point === null || result === null) return []
  const rows = result.items
    .filter((row) => row.node_key === point.node_key)
    .sort((a, b) => Date.parse(a.bucket_start) - Date.parse(b.bucket_start))
  const points: DtChartPoint[] = []
  const intervalMs = result.interval === '15m' ? 900_000 : 60_000
  let previous: number | null = null
  for (const row of rows) {
    const at = Date.parse(row.bucket_start)
    if (previous !== null && at - previous > intervalMs)
      points.push([new Date(previous + intervalMs).toISOString(), null])
    points.push([row.bucket_start, row.value])
    previous = at
  }
  return points.length === 0
    ? []
    : [
        {
          key: point.node_key,
          name: point.name,
          unit: point.unit ?? '',
          axis: 'value',
          points,
        },
      ]
}
