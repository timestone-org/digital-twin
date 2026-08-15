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
  /**
   * 起始前亲眼数到的全停分钟数（截断在回看上限）。
   * ⚠ null = 这行是旧抽取逻辑（LOGIC_VERSION < 2）的产物，不是「没停过」。
   */
  idle_minutes: number | null
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

/**
 * 模型状态。queued → training → ready|failed；重训回到 queued。
 * ⚠ failed 行上可能仍带着上一次成功的评估（重训失败保留上一份产物）。
 */
export const AC_MODEL_STATUSES = [
  'queued',
  'training',
  'ready',
  'failed',
] as const
export type AcModelStatus = (typeof AC_MODEL_STATUSES)[number]

/** 可靠性分档：按预测区间宽度，不按样本数。 */
export const MODEL_RELIABILITIES = ['reliable', 'indicative', 'weak'] as const
export type ModelReliability = (typeof MODEL_RELIABILITIES)[number]

/** 一组折外预测的误差统计。`coverage` 标称 0.8，显著更低说明区间在撒谎。 */
export interface ModelErrorStats {
  count: number
  mae: number
  medae: number
  rmse: number
  coverage: number
  mean_width: number
  /**
   * 决定系数。⚠ null 有两种成因：老评估没算过（重训能补），以及实际值没有
   * 离散度（只有一条热行时数学上无定义，重训也还是 null）。
   * 渲染成 `—`，绝不折成 0——0 的含义是「与永远猜平均值一样」。
   */
  r2: number | null
  reliability: ModelReliability
}

/**
 * 一组折外预测的评估：整体统计 + 热行（实际>0）单独一份。
 * ⚠ 整体 MAE 被大量「一开机就已达标」的零行灌水，判断模型好坏看 `hot`；
 * 热行/判零字段在老评估上是 null，重训后补齐。
 */
export interface ModelMetricsBlock extends ModelErrorStats {
  hot: ModelErrorStats | null
  zero_count: number | null
  /** 零行判零率与热行判出率；对应的行不存在（或老评估）时为 null。 */
  zero_hit_rate: number | null
  hot_hit_rate: number | null
}

/** 总体 + 按服务组合的评估。⚠ 没样本的组合是 null 不是零。 */
export interface ModelMetrics {
  overall: ModelMetricsBlock
  /** 键是组合的稳定写法：serial 升序加号相连，如 `K11+K12`。 */
  by_set: Record<string, ModelMetricsBlock | null>
}

/** 一个达标时长模型：一个房间一份配置 + 最近一次训练的产物。 */
export interface AcModel {
  id: string
  name: string
  description: string | null
  room: RoomRef
  workshop: WorkshopRef
  /** 服务组合：选的是服务面不是训练集——训练永远用房间全部可用事件。 */
  serving_sets: string[][]
  half_life_days: number
  status: AcModelStatus
  error: string | null
  feature_version: number | null
  trained_at: string | null
  sample_count: number | null
  window_start: string | null
  window_end: string | null
  metrics: ModelMetrics | null
  /** ⚠ 提示不是失效：数据已更新（批次指纹变了），训练产物照常可用。 */
  is_batch_stale: boolean
  /** 特征口径已更新（FEATURE_VERSION 变了），建议重训。 */
  is_feature_stale: boolean
  created_by: string
  created_at: string
  updated_at: string
}

/** 一条折外预测与实际的对比。 */
export interface ModelPrediction {
  started_at: string
  running_set: string[]
  actual_minutes: number
  p10: number
  p50: number
  p90: number
  fold: number
}

/** 试算时一台机组的读数。⚠ 缺测就省略字段，不要填 0——0 是真实读数。 */
export interface ModelPredictReadings {
  workshop_temp_avg?: number
  workshop_humidity_avg?: number
  fresh_air_temp?: number
  fresh_air_humidity?: number
  chilled_water_supply_temp?: number
}

/** 试算入参：一个假想的开机条件。`at` 省略即当下。 */
export interface ModelPredictInput {
  running_set: string[]
  readings?: Record<string, ModelPredictReadings>
  at?: string
  idle_minutes?: number
}

/** 试算结果。⚠ `is_in_serving_sets` 为假 = 对服务组合之外的外推。 */
export interface ModelPredictResult {
  p10: number
  p50: number
  p90: number
  interval_width_minutes: number
  /** 开机即达标（时长 0）的概率，0~1。 */
  instant_probability: number
  reliability: ModelReliability
  is_in_serving_sets: boolean
  /** 真 = 组合专属子模型在答话；假 = 组合样本不足，房间共用模型兜底。 */
  is_dedicated: boolean
  trained_at: string
}

/** 推荐入参：同一个起始条件，让全部服务组合同台比，故不选组合。 */
export interface ModelRecommendInput {
  readings?: Record<string, ModelPredictReadings>
  at?: string
  idle_minutes?: number
}

/** 推荐结果里一个组合的成绩。 */
export interface ModelRecommendEntry {
  running_set: string[]
  set_key: string
  p10: number
  p50: number
  p90: number
  interval_width_minutes: number
  instant_probability: number
  reliability: ModelReliability
  is_dedicated: boolean
  /** 排序：p50 快者优先 → p90 → 少开机组；第一名为真。 */
  is_recommended: boolean
}

/** 推荐结果：全部服务组合按「更快达标」排好序。 */
export interface ModelRecommendResult {
  items: ModelRecommendEntry[]
  trained_at: string
}

/* 房间实时工况 —— 试算与推荐的当下入参 */

/** 一台机组的五项实时读数。⚠ 全部可空，null = 窗内没读到，不是 0。 */
export interface AcUnitReadingValues {
  workshop_temp_avg: number | null
  workshop_humidity_avg: number | null
  fresh_air_temp: number | null
  fresh_air_humidity: number | null
  chilled_water_supply_temp: number | null
}

/** 回看窗内某台的最后一行。⚠ `is_running` 三态：null = 未知，不等于停机。 */
export interface AcUnitLiveReading {
  serial: string
  sampled_at: string | null
  is_running: boolean | null
  readings: AcUnitReadingValues
}

/** 房间的实时工况快照。⚠ 外库不可达时是 503，绝不返回旧数据。 */
export interface RoomLiveReadings {
  as_of: string
  lookback_minutes: number
  units: AcUnitLiveReading[]
}

/** 半衰期的允许范围（天），与后端校验同值。 */
export const MODEL_HALF_LIFE_MIN_DAYS = 7
export const MODEL_HALF_LIFE_MAX_DAYS = 3650
export const MODEL_HALF_LIFE_DEFAULT_DAYS = 180

/* 预测下发 —— 模型的预测写进哪些 OPC UA 点位（docs/AC_PUBLISH_DESIGN.md） */

/** 一次下发的去向。⚠ 三档分开，理由见 `ModelPublishResult`。 */
export const MODEL_PUBLISH_STATUSES = ['ok', 'degraded', 'failed'] as const
export type ModelPublishStatus = (typeof MODEL_PUBLISH_STATUSES)[number]

/**
 * 「这一拍算不出数」的哨兵值，与后端逐字一致。
 * ⚠ 绝不能是 0：0 是合法预测值（一开机就已达标，现网占 48.7%），
 * 拿它当「没算出来」会让上位机把两件事读反。
 */
export const MODEL_NO_PREDICTION = -1

/** 区域推荐点位收文本；组合时间点位收浮点。⚠ 整数型放不下 12.4。 */
export const MODEL_RECOMMENDATION_DATA_TYPE = 'string'
export const MODEL_DURATION_DATA_TYPES = ['float', 'double'] as const

/** 一个服务组合绑的那个数字点位。 */
export interface AcModelSetBinding {
  set_key: string
  node_id: string
  identifier: string
  /** 假 = 模型改过服务组合，这条绑定落空了。⚠ 留着不删，但要标出来。 */
  is_serving: boolean
}

/** 一个模型的预测下发配置与它此刻的心跳。 */
export interface AcModelPublication {
  model_id: string
  opcua_instance_id: string
  recommendation_node_id: string | null
  recommendation_identifier: string | null
  is_enabled: boolean
  /** 实例 + 区域点位 + 每一个服务组合都绑齐了才会发布。 */
  is_fully_bound: boolean
  /** 还差哪几个组合没绑，set_key 升序。 */
  unbound_set_keys: string[]
  set_bindings: AcModelSetBinding[]
  last_published_at: string | null
  last_status: ModelPublishStatus | null
  last_error: string | null
}

/** 保存绑定的入参。⚠ 整份保存不是补丁，理由见后端 `PublicationPutIn`。 */
export interface AcModelPublicationInput {
  opcua_instance_id: string
  recommendation_node_id?: string | null
  set_bindings: { set_key: string; node_id: string }[]
  is_enabled: boolean
}

/** 一次下发里一个点位的去向。`set_key` 为 null 即区域推荐点位。 */
export interface ModelPublishItem {
  set_key: string | null
  identifier: string | null
  value: string | number | null
  is_written: boolean
  error: string | null
}

/**
 * 一次下发的结果。
 * ⚠ `degraded` 是「写进去了但写的是哨兵值」，`failed` 是「一个字节都没写进去」
 * ——后者上位机读到的还是旧值，而没有任何迹象说明它不新鲜了。
 */
export interface ModelPublishResult {
  model_id: string
  status: ModelPublishStatus
  published_at: string
  written_count: number
  items: ModelPublishItem[]
  error: string | null
}
