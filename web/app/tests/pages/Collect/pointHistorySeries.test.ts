/** @fileoverview 采集点位的交互与数据完整性契约。 */
import { describe, expect, it } from 'vitest'
import type { CollectPoint, CollectHistoryAggregate } from '@dt/contracts'
import { pointHistorySeries } from '@/pages/Collect/Opcua/scripts/pointHistorySeries'
const point: CollectPoint = {
  id: 'p1',
  source_id: 's1',
  node_key: 's1:p1',
  code: 'p1',
  name: '温度',
  address: 'ns=2;s=Temp',
  data_type: 'float',
  unit: '℃',
  sampling_interval_ms: 1000,
  deadband: 0,
  archive_enabled: true,
  archive_max_interval_ms: 60000,
  archive_retention_days: null,
  created_at: '',
  updated_at: '',
}
const result: CollectHistoryAggregate = {
  items: [],
  interval: '1m',
  aggregate: 'avg',
  timezone: 'UTC',
  is_truncated: false,
}
describe('历史断档', () => {
  it('缺失分钟桶不连成连续曲线，零值保留', () => {
    const series = pointHistorySeries(point, {
      ...result,
      items: [
        {
          node_key: 's1:p1',
          bucket_start: '2026-09-11T00:02:00Z',
          value: 2,
          sample_count: 1,
        },
        {
          node_key: 's1:p1',
          bucket_start: '2026-09-11T00:00:00Z',
          value: 0,
          sample_count: 1,
        },
      ],
    })
    expect(series[0]?.points).toEqual([
      ['2026-09-11T00:00:00Z', 0],
      ['2026-09-11T00:01:00.000Z', null],
      ['2026-09-11T00:02:00Z', 2],
    ])
  })
  it('不把别的点位或空结果画进曲线', () => {
    expect(pointHistorySeries(null, result)).toEqual([])
    expect(pointHistorySeries(point, null)).toEqual([])
    expect(pointHistorySeries(point, result)).toEqual([])
  })
})
