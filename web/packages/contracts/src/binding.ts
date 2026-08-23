/**
 * @fileoverview 绑定的来源种类与取数形状：五种来源是闭合集合，
 * 未注册的值服务端一律 400（口径见 docs/DASHBOARD_DESIGN.md §4）。
 */

/**
 * 绑定的来源种类。
 * `opcua` 实时点位、`static` 常量、`computed` 同节点内其它槽的运算、
 * `archive` 点位历史序列、`dataset` 数据台账的某一列。
 * ⚠ 闭合集合：放开成任意字符串的话，`opuca` 这种拼写会照常入库、永不产数据、无任何告警。
 * ⚠ 加一档要连同后端 `apps/dashboard/source_kinds.py` 与那条 CHECK 约束一起改：
 * 只改这一侧的话，界面配得出来而写库被拒，报的是一句没头没尾的 400。
 */
export const BINDING_SOURCE_KINDS = [
  'opcua',
  'static',
  'computed',
  'archive',
  'dataset',
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

/**
 * `dataset` 来源的取数说明，落在绑定的 `detailJson`。
 * ⚠ 台账列的身份放在这里而**不是** `nodeKey`：那个字段的口径写死是
 * 「`{sourceId}:{pointCode}`，按第一个冒号切分」，塞一个 `ds:` 串进去，
 * 那句注释就对五种来源里的一种是假的。
 */
export interface DatasetBindingDetail {
  /** 台账列身份 `ds:{台账code}:{列key}`。 */
  datasetKey: string
  range: HistoryTimeRange
}

/** 一条绑定的取数说明。按 `sourceKind` 判别，其余来源为 null。 */
export type BindingDetail = ArchiveBindingDetail | DatasetBindingDetail

/** 台账列身份的前缀。 */
const DATASET_KEY_PREFIX = 'ds'

/** 拆开的台账列身份。 */
export interface DatasetKeyParts {
  /** 台账编码，建后不可改——大屏绑定靠它认表。 */
  code: string
  /** 列标识。 */
  columnKey: string
}

/**
 * 拼一个台账列身份。
 * ⚠ 拼接与解析各只有这一处：两端各写一份字面量时，写歪一个字符不会有任何
 * 报错，只是那条绑定永远取不到数——而那与「台账里这一格确实是空」长得一样。
 * @param code 台账编码
 * @param columnKey 列标识
 */
export function datasetBindingKey(code: string, columnKey: string): string {
  return `${DATASET_KEY_PREFIX}:${code}:${columnKey}`
}

/**
 * 把台账列身份拆回编码与列标识；不合口径给 null。
 * ⚠ 恰好切成三段才算数：台账编码是 ASCII 标识符、列标识明令禁止冒号
 * （docs/DATASET_DESIGN.md §4.2），故多一个冒号就是这个串本身不对，
 * 而不是「列名里带了冒号」。
 * @param key 形如 `ds:{code}:{列key}` 的串
 */
export function parseDatasetBindingKey(key: string): DatasetKeyParts | null {
  const parts = key.split(':')
  const [prefix, code, columnKey] = parts
  if (parts.length !== 3) return null
  if (prefix !== DATASET_KEY_PREFIX) return null
  if (code === undefined || code === '') return null
  if (columnKey === undefined || columnKey === '') return null
  return { code, columnKey }
}
