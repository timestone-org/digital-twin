/**
 * @fileoverview 数据台账配置面的出入参类型，逐字对应
 * `server/services/platform-server/openapi.json` 的 `dataset-tables` 一族。
 *
 * ⚠ 台账不直连设备：它唯一的上游是点位历史，列绑的是**点位身份**而不是协议
 * 寻址串（docs/DATASET_DESIGN.md §1.2、§2.3）。
 * ⚠ 每个出参类型都被 `app/tests/contract/dataset-shapes.contract.spec.ts`
 * 钉在 openapi 上，改后端字段名会在那里红，不会等到线上。
 */

/** 一张台账的行怎么来：只人工录入，还是按周期从点位历史聚合。 */
export const DATASET_COLLECT_MODES = ['manual', 'aggregate'] as const
export type DatasetCollectMode = (typeof DATASET_COLLECT_MODES)[number]

/**
 * 一列的来源。
 * ⚠ 中间那档是 `point` 不是某个协议名：列绑的是一个点位，与它背后跑的是哪个
 * 协议无关（ADR-0011）。
 */
export const DATASET_COLUMN_SOURCES = ['manual', 'point', 'formula'] as const
export type DatasetColumnSource = (typeof DATASET_COLUMN_SOURCES)[number]

/** 一格里装的是什么。精确小数对外走 string，故没有单独的 decimal 档。 */
export const DATASET_COLUMN_TYPES = ['number', 'string', 'bool'] as const
export type DatasetColumnType = (typeof DATASET_COLUMN_TYPES)[number]

/**
 * 桶内的 N 条点位历史折成一个数的八种口径。
 * ⚠ `delta` 的口径是「跨桶：本桶末值 − 上一桶末值」，不是桶内 `last − first`
 * （docs/DATASET_DESIGN.md §4.4）。
 */
export const DATASET_AGG_FUNCS = [
  'avg',
  'min',
  'max',
  'last',
  'first',
  'sum',
  'count',
  'delta',
] as const
export type DatasetAggFunc = (typeof DATASET_AGG_FUNCS)[number]

/** 一列的定义。对应后端 `ColumnOut`。 */
export interface DatasetColumn {
  id: string
  table_id: string
  /** 公式里写作 `{key}`，也是 JSONB 字段名。⚠ 建后不可改。 */
  key: string
  name: string
  unit: string | null
  /** 展示小数位，null = 不限。 */
  decimals: number | null
  data_type: DatasetColumnType
  source: DatasetColumnSource
  /** 仅 `source === 'point'` 有意义。 */
  agg: DatasetAggFunc
  /** `source === 'point'` 时绑的点位身份 `{source_id}:{point_code}`。 */
  node_key: string | null
  formula: string | null
  /** 保存公式时解析出的依赖。公式引擎随第 2 期落地，在那之前恒为 null。 */
  formula_deps: string[] | null
  order_index: number
  /** 仅对人工录入列有意义。 */
  is_required: boolean
  /** 录入表单默认值，存原值保类型。 */
  default_value: unknown
  created_at: string
  updated_at: string
}

/** 列表页的台账条目。对应后端 `TableSummaryOut`。 */
export interface DatasetTableSummary {
  id: string
  /** 大屏绑定键 `ds:{code}:{列key}` 的前半段。⚠ 建后不可改。 */
  code: string
  name: string
  description: string | null
  collect_mode: DatasetCollectMode
  /** 一行覆盖的桶宽。 */
  collect_interval_ms: number
  /** null = 永久保留。 */
  retention_days: number | null
  /** 采集器水位。聚合采集器随第 5 期落地，在那之前恒为 null。 */
  last_collected_ts: string | null
  is_enabled: boolean
  column_count: number
  created_at: string
  updated_at: string
}

/** 台账详情：连列定义一起给。对应后端 `TableOut`。 */
export interface DatasetTable extends DatasetTableSummary {
  columns: DatasetColumn[]
}
