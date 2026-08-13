/**
 * @fileoverview 绑定的来源种类与取数形状：四种来源是闭合集合，
 * 未注册的值服务端一律 400（口径见 docs/DASHBOARD_DESIGN.md §4）。
 */

/**
 * 绑定的来源种类。
 * `opcua` 实时点位、`static` 常量、`computed` 同节点内其它槽的运算、`archive` 历史序列。
 * ⚠ 闭合集合：放开成任意字符串的话，`opuca` 这种拼写会照常入库、永不产数据、无任何告警。
 */
export const BINDING_SOURCE_KINDS = [
  'opcua',
  'static',
  'computed',
  'archive',
] as const
export type BindingSourceKind = (typeof BINDING_SOURCE_KINDS)[number]

/** `computed` 的运算符。 */
export const COMPUTE_OPS = [
  'sum',
  'avg',
  'min',
  'max',
  'product',
  'diff',
  'ratio',
] as const
export type ComputeOp = (typeof COMPUTE_OPS)[number]

/** 派生取值的规格，落在绑定的 `computeJson`。 */
export interface ComputeSpec {
  /** `diff` 是 `inputs[0]` 减去其余之和，`ratio` 是 `inputs[0] / inputs[1]`。 */
  op: ComputeOp
  /**
   * 参与运算的槽键，取同一节点内其它**非 computed** 的槽。
   * ⚠ 顺序对 `diff` / `ratio` 有意义，重排会改变结果。
   */
  inputs: string[]
  /** 四舍五入到几位小数；缺省不动。 */
  precision?: number | null
}

/** 取到值之后的定值变换，落在绑定的 `transformJson`。 */
export interface BindingTransform {
  /** 乘数。 */
  scale?: number | null
  /** 加数，在乘数之后生效。 */
  offset?: number | null
  /** 四舍五入到几位小数。 */
  round?: number | null
}

/**
 * 历史序列上的一个点。
 * ⚠ 键名 `t` / `v` 是线上形状：一屏几千个点时，字段名本身也是流量。
 */
export interface HistoryPoint {
  /** 采样时刻，UTC 毫秒。 */
  t: number
  /** 该时刻的值；非数值原样保留。 */
  v: unknown
}

/**
 * 历史取数的范围。两种口径都在这个对象里表达：按时间窗（`fromMs` / `toMs`
 * 或相对窗 `lastWindow`）、按数量（只给 `limit` = 不限时间取最新 N 个点）。
 */
export interface HistoryTimeRange {
  /** 左边界，UTC 毫秒，含。 */
  fromMs?: number
  /** 右边界，UTC 毫秒，含。 */
  toMs?: number
  /** 相对窗，形如 `1h` / `7d`；与 `fromMs` 同时给时以 `fromMs` 为准。 */
  lastWindow?: string
  /** 最多取多少个点，取最新的那批。 */
  limit?: number
}

/** `archive` 来源的取数说明，落在绑定的 `detailJson`。 */
export interface ArchiveBindingDetail {
  /** 点位身份 `{sourceId}:{pointCode}`。 */
  nodeKey: string
  range: HistoryTimeRange
}
