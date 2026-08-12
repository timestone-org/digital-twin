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
