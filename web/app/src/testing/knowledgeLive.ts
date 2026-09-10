/** @fileoverview 采集接口的完整测试形状。 */
import type { CollectPoint, CollectSource } from '@dt/contracts'
import type { LivePoint } from '@/features/knowledgeChat/liveTools'
export const SOURCE_ID = '00000000-0000-4000-8000-000000000001'
export const POINT: CollectPoint = {
  id: '00000000-0000-4000-8000-000000000002',
  source_id: SOURCE_ID,
  node_key: `${SOURCE_ID}:temp`,
  code: 'temp',
  name: '出口温度',
  description: '一号机送风测温',
  address: 'ns=2;s=temp',
  data_type: 'float',
  unit: '℃',
  sampling_interval_ms: 1000,
  deadband: 0,
  archive_enabled: true,
  archive_max_interval_ms: 60000,
  archive_retention_days: null,
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
}
export const SOURCE: CollectSource = {
  id: SOURCE_ID,
  name: '一号机',
  code: 'line1',
  description: null,
  protocol: 'opcua',
  endpoint: 'opc.tcp://private-device:4840',
  username: 'private-user',
  has_credential: true,
  options_json: {},
  read_mode: 'subscribe',
  poll_interval_ms: 1000,
  is_enabled: true,
  point_count: 1,
  live_point_limit: 1000,
  runtime: {
    state: 'online',
    point_count: 1,
    error_category: null,
    error_detail: null,
    leader_instance: null,
    updated_at: null,
  },
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
}
export const LIVE_POINT: LivePoint = {
  kind: 'collect.live.v1',
  node_key: POINT.node_key,
  name: POINT.name,
  source_name: SOURCE.name,
  unit: POINT.unit,
}
export const POINT_PAGE = { items: [POINT], total: 1, page: 1, size: 200 }
