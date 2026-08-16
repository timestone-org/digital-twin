/**
 * @fileoverview 数据采集配置面的出入参类型，逐字对应
 * `server/services/platform-server/openapi.json` 的 `collect-*` 一族。
 *
 * ⚠ 这里的「数据源 / 点位」是**采集侧**的，与 `opcua.ts` 里的 OPC UA 服务端
 * 方向相反：那边本平台是服务端、被上位机连；这边本平台是客户端、去连 PLC
 * （docs/COLLECT_DESIGN.md §1）。两套类型不许互相顶替。
 * ⚠ 每个出参类型都被 `app/tests/contract/collect-shapes.contract.spec.ts`
 * 钉在 openapi 上，改后端字段名会在那里红，不会等到线上。
 */

/** 已实现的采集协议。第二个驱动进来时后端与这里同时加一项。 */
export const COLLECT_PROTOCOLS = ['opcua'] as const
export type CollectProtocol = (typeof COLLECT_PROTOCOLS)[number]

/** 订阅还是轮询。驱动不支持订阅时采集运行时自动降级，配置面照原样存。 */
export const COLLECT_READ_MODES = ['subscribe', 'poll'] as const
export type CollectReadMode = (typeof COLLECT_READ_MODES)[number]

/** 点位的值类型，协议无关。 */
export const COLLECT_DATA_TYPES = ['float', 'int', 'bool', 'string'] as const
export type CollectDataType = (typeof COLLECT_DATA_TYPES)[number]

/**
 * 数据源此刻的采集运行态。
 * ⚠ `unknown` 是**平台侧**的取值，表示采集侧还没写过这一行——通常意味着
 * collector 没起来。它与 `offline`（接手了但连不上）处置完全不同。
 */
export const COLLECT_SOURCE_STATES = [
  'online',
  'connecting',
  'offline',
  'unknown',
] as const
export type CollectSourceState = (typeof COLLECT_SOURCE_STATES)[number]

/** 连不上的归类。 */
export const COLLECT_ERROR_CATEGORIES = ['transient', 'config', 'auth'] as const
export type CollectErrorCategory = (typeof COLLECT_ERROR_CATEGORIES)[number]

/** 一次寻址串校验的三档结论。 */
export const COLLECT_CHECK_STATUSES = [
  'passed',
  'rejected',
  'unverified',
] as const
export type CollectCheckStatus = (typeof COLLECT_CHECK_STATUSES)[number]

/**
 * 数据源此刻的采集运行态：collector 写、平台只读。
 * ⚠ 与 `CollectSource.is_enabled` 不是一回事：那是「配置说它该采」，这里是
 * 「它此刻真在采吗」。显示成同一个状态灯是现场最常见的误判。
 */
export interface CollectSourceRuntime {
  state: CollectSourceState
  /**
   * 采集侧此刻真的挂着的点位数。与 `CollectSource.point_count`（配了多少个）
   * 对不上时，差额就是没订上的那些。
   */
  point_count: number
  error_category: CollectErrorCategory | null
  /** 异常类型名，不是异常原文——原文可能带凭据。 */
  error_detail: string | null
  leader_instance: string | null
  updated_at: string | null
}

/** 一个采集数据源。⚠ 没有凭据字段：后端任何出参都不回它。 */
export interface CollectSource {
  id: string
  name: string
  /** 身份，建好就不可改：改名等于换身份，历史会断成两段。 */
  code: string
  protocol: CollectProtocol
  endpoint: string
  has_credential: boolean
  options_json: Record<string, string>
  read_mode: CollectReadMode
  poll_interval_ms: number
  is_enabled: boolean
  /** 配了多少个点位。 */
  point_count: number
  /** 实时值最多覆盖多少个点位（按 code 升序取前 N）。 */
  live_point_limit: number
  runtime: CollectSourceRuntime
  created_at: string
  updated_at: string
}

export interface CollectSourceCreateInput {
  name: string
  code: string
  protocol: CollectProtocol
  endpoint: string
  credential?: string | undefined
  options_json?: Record<string, string> | undefined
  read_mode?: CollectReadMode | undefined
  poll_interval_ms?: number | undefined
  is_enabled?: boolean | undefined
}

/**
 * 改数据源。缺省的字段不动。
 * ⚠ 没有 `code`：编码是身份，要换名字就新建一个。
 * ⚠ `credential` 给 `null` 是**清空**，不给是**不动**——两者必须分得开，
 * 否则每次改端点都会顺手把口令抹掉。
 */
export interface CollectSourceUpdateInput {
  name?: string | undefined
  endpoint?: string | undefined
  credential?: string | null | undefined
  options_json?: Record<string, string> | undefined
  read_mode?: CollectReadMode | undefined
  poll_interval_ms?: number | undefined
  is_enabled?: boolean | undefined
}

/** 一次连通性测试的结论。⚠ 不可达也是 200，结论在 `is_reachable` 里。 */
export interface CollectConnectivity {
  source_id: string
  is_reachable: boolean
  detail: string | null
}

/** 地址空间里的一项。`address` 可直接填进点位配置。 */
export interface CollectBrowseItem {
  address: string
  name: string
  has_children: boolean
  /** 只有变量节点能当点位；对象节点只用来往下走。 */
  is_variable: boolean
}

export interface CollectBrowseResult {
  items: CollectBrowseItem[]
}

/** 一个采集点位。`node_key` 是它在全系统里的身份 `{source_id}:{code}`。 */
export interface CollectPoint {
  id: string
  source_id: string
  node_key: string
  code: string
  name: string
  /** 协议寻址串，可改；改它不断历史。 */
  address: string
  data_type: CollectDataType
  unit: string | null
  sampling_interval_ms: number
  deadband: number
  archive_enabled: boolean
  archive_max_interval_ms: number
  archive_retention_days: number | null
  created_at: string
  updated_at: string
}

/** 批量建点里的一项。数据源在批的层面上给，一批只对一个源。 */
export interface CollectPointItemInput {
  code: string
  name: string
  address: string
  data_type?: CollectDataType | undefined
  unit?: string | null | undefined
  sampling_interval_ms?: number | undefined
  deadband?: number | undefined
  archive_enabled?: boolean | undefined
  archive_max_interval_ms?: number | undefined
  archive_retention_days?: number | null | undefined
}

export interface CollectPointCreateInput {
  source_id: string
  items: CollectPointItemInput[]
}

export interface CollectPointUpdateInput {
  name?: string | undefined
  address?: string | undefined
  data_type?: CollectDataType | undefined
  unit?: string | null | undefined
  sampling_interval_ms?: number | undefined
  deadband?: number | undefined
  archive_enabled?: boolean | undefined
  archive_max_interval_ms?: number | undefined
  archive_retention_days?: number | null | undefined
}

/**
 * 一条寻址串在现场的校验结论。
 * ⚠ `unverified` 不是「通过」：超时、采集侧离线、动作不被支持都落这一档。
 * 显示成通过，用户就再也不知道这条寻址串还没被现场确认过。
 */
export interface CollectAddressCheck {
  address: string
  status: CollectCheckStatus
  detail: string | null
}

/** 一次批量建点的结果。 */
export interface CollectPointBatch {
  items: CollectPoint[]
  address_checks: CollectAddressCheck[]
}

/** 一次改点位的结果，带这次寻址串校验的结论。 */
export interface CollectPointSaved {
  point: CollectPoint
  address_check: CollectAddressCheck | null
}

/** 一次下发写值的结论。 */
export interface CollectWriteResult {
  point_id: string
  node_key: string
  is_written: boolean
}

/** 批量建点的单批上限，与后端 `MAX_BATCH` 同值。超了后端 422。 */
export const COLLECT_POINT_BATCH_MAX = 200
/** 采样与轮询周期的下限，与后端 `MIN_INTERVAL_MS` 同值。 */
export const COLLECT_MIN_INTERVAL_MS = 50
