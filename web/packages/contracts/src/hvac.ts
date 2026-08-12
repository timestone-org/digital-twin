/**
 * @fileoverview 空调台账与空间配置的类型。
 * ⚠ 与 `server/services/platform-server/openapi.json` 手工对齐，一致性由
 * `app/tests/contract/hvac-shapes.contract.spec.ts` 逐字段锁死；改接口先改这里。
 *
 * 层级是固定两级：车间 → 房间 → 空调。**同一房间内的空调互相影响**，房间因此
 * 是分组单位而不只是一个标签。
 */

/** 车间的引用形态：只给指认它所需的最少字段。 */
export interface WorkshopRef {
  id: string
  name: string
}

/** 房间的引用形态。 */
export interface RoomRef {
  id: string
  name: string
}

export interface Workshop {
  id: string
  name: string
  room_count: number
  ac_unit_count: number
  created_at: string
  updated_at: string
}

export interface Room {
  id: string
  name: string
  workshop: WorkshopRef
  /** 这个热力空间里的空调台数。 */
  ac_unit_count: number
  created_at: string
  updated_at: string
}

export interface AcUnit {
  id: string
  /** 全场唯一的设备编号（铭牌号 / 资产号），不是排序号。 */
  serial: string
  name: string
  room: RoomRef
  workshop: WorkshopRef
  created_at: string
  updated_at: string
}

/** 批量改派的结果。`moved_count` 只数真的换了房间的那些。 */
export interface AcUnitRelocateResult {
  moved_count: number
  room: RoomRef
  workshop: WorkshopRef
}

// ⚠ 用 type 而不是 interface：interface 没有隐式索引签名，
// 传给 `request` 的 `query`（Record<...>）会被类型检查拒掉。
export type AcUnitFilters = {
  q?: string | undefined
  room_id?: string | undefined
  workshop_id?: string | undefined
}

/** 一次批量改派的上限，与后端 `MAX_RELOCATE_BATCH` 同值。 */
export const AC_UNIT_RELOCATE_MAX = 200

/** 不分页的集合响应内层。数据集目录、绑定、达标范围三处同形。 */
export interface AcItemList<TItem> {
  items: TItem[]
}

/**
 * 指标的 Y 轴分组。同组共用一条轴，取值落到 `DtLineChart` 的 `axis`。
 * ⚠ openapi 把 `group` 声明成自由 `string`，这个闭集来自
 * docs/AC_DATA_DESIGN.md §4，并与后端 `datasets.py` 的 `GROUP_*` 常量由
 * 契约测试双向锁死——后端加一个分组而这里没跟上，穷尽分支会静默漏掉它。
 */
export const AC_METRIC_GROUPS = [
  'temperature',
  'humidity',
  'pressure',
  'frequency',
] as const
export type AcMetricGroup = (typeof AC_METRIC_GROUPS)[number]

/** 数据集里的一个可读量。指标选择器与 Y 轴分组都读它。 */
export interface AcMetric {
  key: string
  name: string
  unit: string
  group: AcMetricGroup
  /** 能配达标范围。界面据此渲染，不在前端硬编码指标名。 */
  is_limitable: boolean
  /** 折线图初始就画它。 */
  is_charted_by_default: boolean
}

/** 一台空调可看的一类数据。加一类数据是往目录里加一项，不是加一个页面。 */
export interface AcDataset {
  key: string
  name: string
  description: string
  metrics: AcMetric[]
}

/** 「这台空调的这个数据集，读那个对象」这条对应关系。 */
export interface AcDataBinding {
  dataset: string
  /** 外部 EMS 库里承载这个数据集的视图名，例如 `KTStartData_K01`。 */
  source_object: string
  created_at: string
  updated_at: string
}

/** 一个指标的达标范围。单边为 `null` 表示该侧不限制。 */
export interface AcMetricLimit {
  metric: string
  /**
   * ⚠ 精确小数按 **string** 传，不是 number：JSON number 会把 20.15 读成
   * 20.149999999999999。判定与显示前一律不许 `Number()` 再做算术，
   * 见 docs/agents/code-style-typescript.md §8。
   */
  lower_limit: string | null
  upper_limit: string | null
}

/** 一次覆盖式提交能带的指标条数上限，与后端 `MAX_METRIC_LIMITS` 同值。 */
export const AC_METRIC_LIMITS_MAX = 64

/** 外部库里一个可绑定的对象。 */
export interface AcSourceObject {
  name: string
  /** 厂商给的中文别名，取不到时为 null。 */
  caption: string | null
  row_count_hint: number | null
}

/**
 * 原始数据表格里的一行：一个时刻上的 19 个测点原值。
 *
 * ⚠ 逐个列出而不是用索引签名：字段与目录逐一对应这件事由 `hvac-shapes` 的
 * 契约用例双向钉死，索引签名会让「后端少给一个字段」在编译期完全看不见。
 * ⚠ 测点值是 JSON number（传感器精度本身低于 float64），而 `null` 一律保持
 * `null`——折成 0 会把数据断档读成一次真实的停机。
 */
// ⚠ 用 type 而不是 interface：interface 没有隐式索引签名，`{ ts, ...readings }`
// 解出来的那半就没法当 `Record<string, number | null>` 用，而按 key 查读数正是
// 表格唯一的取值方式（列由目录生成，不是写死的属性名）。
export type RawSampleReadings = {
  workshop_temp_avg: number | null
  workshop_humidity_avg: number | null
  ac_temp_setpoint: number | null
  ac_humidity_setpoint: number | null
  fresh_air_temp: number | null
  fresh_air_humidity: number | null
  supply_air_temp: number | null
  supply_air_humidity: number | null
  return_air_temp: number | null
  return_air_humidity: number | null
  mixed_air_temp: number | null
  mixed_air_humidity: number | null
  chilled_water_supply_temp: number | null
  chilled_water_supply_pressure: number | null
  heat_steam_temp: number | null
  heat_steam_pressure: number | null
  humidify_steam_temp: number | null
  humidify_steam_pressure: number | null
  fan_frequency: number | null
}

export type RawSample = RawSampleReadings & { ts: string }

/** 聚合序列上的一个桶。整桶全空的指标给 null，不给 0。 */
export interface SeriesPoint {
  ts: string
  values: Record<string, number | null>
}

/** 聚合后的时序。`interval_minutes` 是服务端按点数上限挑的桶宽，必须显示出来。 */
export interface RawSeries {
  interval_minutes: number
  metrics: string[]
  points: SeriesPoint[]
}

/** 表格一页最多取多少条，与后端 `limit` 的上限同值。 */
export const RAW_SAMPLES_PAGE_MAX = 200

/** 折线图一次最多要多少个桶，与后端 `max_points` 的上限同值。 */
export const RAW_SERIES_POINTS_MAX = 2000

/* 开机事件 —— docs/AC_STARTUP_DESIGN.md */

/**
 * 一次开机的结局。
 * ⚠ openapi 把它声明成自由 `string`，闭集来自后端 `startups.py` 的 `OUTCOME_*`，
 * 由契约用例双向锁死。丢弃原因与「可用」同样要显示——它们说明数据为什么少。
 */
export const STARTUP_OUTCOMES = [
  'usable',
  'set_changed',
  'timeout',
  'data_gap',
] as const
export type StartupOutcome = (typeof STARTUP_OUTCOMES)[number]

/** 抽取批次的状态，同样与后端 `BATCH_STATUS_*` 由契约用例锁死。 */
export const STARTUP_BATCH_STATUSES = ['running', 'ready', 'failed'] as const
export type StartupBatchStatus = (typeof STARTUP_BATCH_STATUSES)[number]

/** 起始帧上每台的原始读数：空调序号 → 指标 key → 取值。 */
export type StartupReadings = Record<string, Record<string, number | null>>

/** 一次开机事件。房间级，不是空调级。 */
export interface StartupEpisode {
  started_at: string
  /** 这次开机里同时运行的那几台，按序号。 */
  running_set: string[]
  complied_at: string | null
  /**
   * 达标时长（分钟）；没达标就是 null。
   * ⚠ **可以是 0**——风机一起来房间就已经在范围内，实测占三成多。
   * 拿真假判空会把这批事件整段吞掉，页面上看不出少了什么。
   */
  duration_minutes: number | null
  outcome: StartupOutcome
  readings: StartupReadings
  /** ⚠ 被排除的事件仍在列表里，只是置灰——消失会让人以为数据没了。 */
  is_excluded: boolean
  exclusion_reason: string | null
}

export interface StartupBatch {
  id: string
  status: StartupBatchStatus
  is_current: boolean
  params_fingerprint: string
  logic_version: number
  window_start: string
  window_end: string
  shard_total: number
  shard_done: number
  episode_count: number
  /** 重算后对不上任何事件的人工排除条数。非零必须说出来：人工判断在悄悄流失。 */
  unmatched_exclusion_count: number
  created_at: string
  updated_at: string
}

/** 一个运行组合攒下了多少可用事件。够不够建模看它。 */
export interface CombinationCoverage {
  running_set: string[]
  usable_count: number
}

export interface StartupBatches {
  items: StartupBatch[]
  current: StartupBatch | null
  coverage: CombinationCoverage[]
  expected_fingerprint: string
  /**
   * ⚠ 只有「有当前批次**且**指纹不符」才为真。没算过的房间它是假，
   * 页面该说的是「还没算过」而不是「该重算了」——两者要人做的事不同。
   */
  is_stale: boolean
  /**
   * 外库里实际有数据的那一段，用来给区间控件定上下界。
   * ⚠ 为 null 有两种可能：房间一台都没绑数据源，或外库此刻不可达。
   * 两种情况页面都只能不预设范围，因此不细分。
   */
  source_range: SourceRange | null
}

/** 外部数据源里实际有数据的那一段。 */
export interface SourceRange {
  start: string
  end: string
}

export interface StartupRebuildResult {
  batch_id: string
  status: StartupBatchStatus
  shard_total: number
  /** 后端最终决定抽的那一段——省略的那端由它算出来，回显给用户看。 */
  window_start: string
  window_end: string
  /** 请求的区间被数据源的实际范围夹过。夹了要说，不然用户以为抽了他填的那段。 */
  is_clamped: boolean
}

export interface StartupExclusion {
  started_at: string
  reason: string
  excluded_by: string
  created_at: string
}

/** 排除原因的长度上限，与后端 `MAX_EXCLUSION_REASON` 同值。 */
export const STARTUP_EXCLUSION_REASON_MAX = 500
