/**
 * @fileoverview 数据台账配置面与数据面的出入参类型，逐字对应
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
  /** 保存公式时解析出的依赖。非公式列恒为 null。 */
  formula_deps: DatasetFormulaDeps | null
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

/** 一处跨行引用。对应后端 `FormulaPrevDepOut`。 */
export interface DatasetPrevDep {
  key: string
  steps: number
}

/** 一处时间窗引用。`key` 跨表时形如 `表code.列key`。对应 `FormulaWindowDepOut`。 */
export interface DatasetWindowDep {
  func: string
  key: string
  /** 规范写法，如 `3mo`。⚠ `'3月'` 与 `'3mo'` 归一到同一个串。 */
  window: string
}

/** 一处整列聚合引用。对应后端 `FormulaWholeDepOut`。 */
export interface DatasetWholeDep {
  func: string
  key: string
}

/** 一处跨表直接引用。对应后端 `FormulaExternalDepOut`。 */
export interface DatasetExternalDep {
  table: string
  key: string
}

/**
 * 保存公式时解析出的依赖，也是库里 `formula_deps` 的形态。
 * 对应后端 `FormulaDepsOut`。
 */
export interface DatasetFormulaDeps {
  same_row: string[]
  prev: DatasetPrevDep[]
  window: DatasetWindowDep[]
  whole: DatasetWholeDep[]
  external: DatasetExternalDep[]
  /** 上面几项里本表列 key 的并集，反查「谁引用了这一列」用。 */
  referenced_keys: string[]
}

/** 目录里的一个可选项：分类、运算符、时间窗写法共用。对应 `CatalogChoiceOut`。 */
export interface DatasetCatalogChoice {
  value: string
  label: string
}

/**
 * 函数面板里的一个函数。对应后端 `CatalogFunctionOut`。
 * ⚠ 元数由后端从元数表注入：前端**不许**硬编码任何函数名或参数个数，
 * 否则后端加一族函数、界面上整族不可见（docs/DATASET_DESIGN.md §5.3）。
 */
export interface DatasetCatalogFunction {
  name: string
  category: string
  signature: string
  description: string
  example: string
  args: string[]
  min_args: number
  /** 不限参数个数时为 null。 */
  max_args: number | null
}

/** 公式里可引用的一列。对应后端 `FormulaColumnOut`。 */
export interface DatasetFormulaColumn {
  key: string
  name: string
  unit: string | null
  data_type: DatasetColumnType
  source: DatasetColumnSource
}

/** 公式里可跨表引用的一张台账。对应后端 `FormulaTableOut`。 */
export interface DatasetFormulaTable {
  code: string
  name: string
}

/** 函数目录 + 可引用的列与表 + 库公式。对应后端 `FormulaFunctionsOut`。 */
export interface DatasetFormulaCatalog {
  categories: DatasetCatalogChoice[]
  functions: DatasetCatalogFunction[]
  operators: DatasetCatalogChoice[]
  window_units: DatasetCatalogChoice[]
  rules: string[]
  columns: DatasetFormulaColumn[]
  tables: DatasetFormulaTable[]
  /** 库公式标识。⚠ 公式库随第 4 期落地，在那之前恒为空。 */
  library: string[]
}

/**
 * 校验结果。对应后端 `FormulaValidateOut`。
 * ⚠ 公式写错回 **200 + `is_ok: false`**，不是 HTTP 错误：编辑器里「还没写完」
 * 是正常状态（docs/DATASET_DESIGN.md §6.1）。
 */
export interface DatasetFormulaValidation {
  is_ok: boolean
  error: string | null
  deps: DatasetFormulaDeps | null
  /**
   * 记号树。递归结构，故是一团后端给的自由 JSON。
   * ⚠ 认不出的节点渲染成 `?`，**绝不白屏**；渲染失败时后端给 null。
   */
  notation: Record<string, unknown> | null
  notation_text: string | null
}

/** 试算结果。对应后端 `FormulaPreviewOut`。 */
export interface DatasetFormulaPreview {
  is_ok: boolean
  value: unknown
  error: string | null
  /** 公式引用了、但这次没给值的列。 */
  missing: string[]
  /** 仅纯加法且结果正是被缺失值弄空时为真——界面据此提议改用 `SUM(...)`。 */
  should_suggest_sum: boolean
  /** ⚠ 试算**不取历史**，这些引用一律按空处理，界面要照实说。 */
  history_refs: string[]
}

/** 一行台账是谁写出来的。 */
export const DATASET_RECORD_SOURCES = ['manual', 'collect', 'import'] as const
export type DatasetRecordSource = (typeof DATASET_RECORD_SOURCES)[number]

/**
 * 一格人工修正的痕迹。对应后端 `OverrideOut`。
 * ⚠ 它只是**标记**，不参与取值——取值已经在 `DatasetRecord.values` 里生效了。
 * ⚠ `by_name` 冗余带一份是刻意的：账号可能被删，而这一格要一直答得出「谁改的」。
 */
export interface DatasetOverride {
  value: unknown
  /** 修正人的用户 id。数据迁移带进来的修正没有它。 */
  by: string | null
  by_name: string | null
  at: string
  reason: string | null
}

/**
 * 一行台账。对应后端 `RecordOut`。
 * ⚠ `values` **已经是 effective**（人工修正优先，docs/DATASET_DESIGN.md D4）：
 * 前端绝不再叠一次 `overrides[].value`。修正前的原值是刻意不给的。
 */
export interface DatasetRecord {
  row_id: string
  ts: string
  /** 生效值：人工修正优先于采集与录入值。 */
  values: Record<string, unknown>
  /** 整行没有修正时是 null，不是空对象。 */
  overrides: Record<string, DatasetOverride> | null
  /** 各点位汇总列的桶内样本数。⚠ `n = 0` 与「值为空」是两件事，文案必须分开。 */
  samples: Record<string, number> | null
  computed: Record<string, unknown>
  /** 求值失败的列 `{列key: 原因}`，null = 全部成功。 */
  compute_error: Record<string, string> | null
  source: DatasetRecordSource
  created_by_name: string | null
  created_at: string
  updated_at: string
}

/**
 * 一次写入的回执。对应后端 `RecordWriteOut`。
 * ⚠ `has_stale_downstream`：改历史行会让它**之后**那些行的 `PREV` / 时间窗 /
 * 整表公式结果不准。后端只上报、不级联重算，界面据此出横幅提示去重算
 * （docs/DATASET_DESIGN.md §5.10）。
 */
export interface DatasetRecordWrite {
  record: DatasetRecord
  has_stale_downstream: boolean
}

/** 删一行的回执。对应后端 `RecordDeleteOut`。 */
export interface DatasetRecordDelete {
  deleted_row_id: string
  has_stale_downstream: boolean
}

/**
 * 写 / 撤销人工修正的回执。对应后端 `OverrideWriteOut`。
 * ⚠ `cleared` 不能省：提交为空的那几格是**撤销修正**而不是「修正成空」，
 * 不分开说的话，用户撤了一格却会看到「已修正 1 格」。
 */
export interface DatasetOverrideWrite extends DatasetRecordWrite {
  cleared: string[]
}

/** 批量撤销修正的回执。对应后端 `OverrideBulkClearOut`。 */
export interface DatasetOverrideBulkClear {
  cleared_rows: number
  /** 被清掉的格数。一行可能清掉多列。 */
  cleared_cells: number
  recomputed: number
  /** 重算中出现求值错误的行数。 */
  failed: number
  /** 待处理的行数触顶，本次只处理了最早的 `limit` 行。 */
  is_truncated: boolean
  limit: number
}

/** 最后一行的值。对应后端 `LatestOut`。大屏实时取数读它。 */
export interface DatasetLatest {
  /** 一行都没有时为 null。 */
  ts: string | null
  values: Record<string, unknown>
  computed: Record<string, unknown>
}

/**
 * 序列上的一个点。对应后端 `DatasetSeriesPointOut`。
 * ⚠ 字段名与点位历史读侧的 `HistoryPoint` 对齐，趋势页的渲染代码两边共用一份。
 */
export interface DatasetSeriesPoint {
  ts: string
  value: unknown
}

/**
 * 若干列的时间序列，按 ts 升序。对应后端 `SeriesOut`。
 * ⚠ `is_truncated` 必须用上：只看 `series` 的话，界面分不清「这段时间就这么多
 * 数据」与「数据太多被砍了」，用户看到的是一段看不出不完整的曲线（§6.2）。
 */
export interface DatasetSeries {
  series: Record<string, DatasetSeriesPoint[]>
  is_truncated: boolean
  limit: number
}

/** 一次重算的回执。对应后端 `RecomputeOut`。 */
export interface DatasetRecompute {
  recomputed: number
  failed: number
  /** 待重算的行数触顶，本次只算了最早的 `limit` 行。 */
  is_truncated: boolean
  limit: number
}
