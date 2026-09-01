/**
 * @fileoverview 把 `@dt/contracts` 的台账出参类型钉在 platform-server 的
 * openapi.json 上。
 *
 * 手写的类型比真接口**宽松**时，typecheck、lint 与单测全绿——编译器无从知道
 * 后端把那个字段叫什么。做法：每个类型用 `Record<keyof T, true>` 在**类型层**
 * 枚举一遍键（漏一个或多一个都过不了 typecheck），再和 openapi 的 properties
 * 比对，两头都锁住。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type {
  DatasetAggFunc,
  DatasetBackfillJob,
  DatasetBackfillStatus,
  DatasetCatalogChoice,
  DatasetCatalogFunction,
  DatasetCollectMode,
  DatasetColumn,
  DatasetColumnSource,
  DatasetColumnType,
  DatasetExternalDep,
  DatasetFormulaCatalog,
  DatasetFormulaColumn,
  DatasetFormulaDef,
  DatasetFormulaDefWithUsages,
  DatasetFormulaDeps,
  DatasetFormulaParam,
  DatasetFormulaParamKind,
  DatasetFormulaPreview,
  DatasetFormulaTable,
  DatasetFormulaUsage,
  DatasetFormulaValidation,
  DatasetLatest,
  DatasetOverride,
  DatasetOverrideBulkClear,
  DatasetOverrideWrite,
  DatasetPrevDep,
  DatasetRecompute,
  DatasetRecord,
  DatasetRecordDelete,
  DatasetRecordSource,
  DatasetRecordWrite,
  DatasetSeries,
  DatasetSeriesPoint,
  DatasetTable,
  DatasetTableSummary,
  DatasetWholeDep,
  DatasetWindowDep,
} from '@dt/contracts'
import {
  DATASET_AGG_FUNCS,
  DATASET_BACKFILL_STATUSES,
  DATASET_COLLECT_MODES,
  DATASET_COLUMN_SOURCES,
  DATASET_COLUMN_TYPES,
  DATASET_FORMULA_PARAM_KINDS,
  DATASET_RECORD_SOURCES,
} from '@dt/contracts'

interface OpenApiSchema {
  properties?: Record<string, unknown>
}

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SPEC_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'openapi.json',
)

const schemas = (
  JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
    components: { schemas: Record<string, OpenApiSchema> }
  }
).components.schemas

/** 键集的类型层枚举。少写一个键、或写了接口上没有的键，vue-tsc 直接红。 */
type Keys<T> = Record<keyof T, true>

const SUMMARY_KEYS = {
  id: true,
  code: true,
  name: true,
  description: true,
  collect_mode: true,
  collect_interval_ms: true,
  retention_days: true,
  last_collected_ts: true,
  is_enabled: true,
  column_count: true,
  created_at: true,
  updated_at: true,
} satisfies Keys<DatasetTableSummary>

const TABLE_KEYS = {
  ...SUMMARY_KEYS,
  columns: true,
} satisfies Keys<DatasetTable>

const COLUMN_KEYS = {
  id: true,
  table_id: true,
  key: true,
  name: true,
  unit: true,
  decimals: true,
  data_type: true,
  source: true,
  agg: true,
  node_key: true,
  formula: true,
  formula_deps: true,
  order_index: true,
  is_required: true,
  default_value: true,
  created_at: true,
  updated_at: true,
} satisfies Keys<DatasetColumn>

const PREV_DEP_KEYS = {
  key: true,
  steps: true,
} satisfies Keys<DatasetPrevDep>

const WINDOW_DEP_KEYS = {
  func: true,
  key: true,
  window: true,
} satisfies Keys<DatasetWindowDep>

const WHOLE_DEP_KEYS = {
  func: true,
  key: true,
} satisfies Keys<DatasetWholeDep>

const EXTERNAL_DEP_KEYS = {
  table: true,
  key: true,
} satisfies Keys<DatasetExternalDep>

const DEPS_KEYS = {
  same_row: true,
  prev: true,
  window: true,
  whole: true,
  external: true,
  model: true,
  referenced_keys: true,
} satisfies Keys<DatasetFormulaDeps>

const CHOICE_KEYS = {
  value: true,
  label: true,
} satisfies Keys<DatasetCatalogChoice>

const CATALOG_FUNCTION_KEYS = {
  name: true,
  category: true,
  signature: true,
  description: true,
  example: true,
  args: true,
  min_args: true,
  max_args: true,
} satisfies Keys<DatasetCatalogFunction>

const FORMULA_COLUMN_KEYS = {
  key: true,
  name: true,
  unit: true,
  data_type: true,
  source: true,
} satisfies Keys<DatasetFormulaColumn>

const FORMULA_TABLE_KEYS = {
  code: true,
  name: true,
} satisfies Keys<DatasetFormulaTable>

const CATALOG_KEYS = {
  categories: true,
  functions: true,
  operators: true,
  window_units: true,
  rules: true,
  columns: true,
  tables: true,
  library: true,
} satisfies Keys<DatasetFormulaCatalog>

const VALIDATION_KEYS = {
  is_ok: true,
  error: true,
  deps: true,
  notation: true,
  notation_text: true,
} satisfies Keys<DatasetFormulaValidation>

const PREVIEW_KEYS = {
  is_ok: true,
  value: true,
  error: true,
  missing: true,
  should_suggest_sum: true,
  history_refs: true,
} satisfies Keys<DatasetFormulaPreview>

const OVERRIDE_KEYS = {
  value: true,
  by: true,
  by_name: true,
  at: true,
  reason: true,
} satisfies Keys<DatasetOverride>

const RECORD_KEYS = {
  row_id: true,
  ts: true,
  values: true,
  overrides: true,
  samples: true,
  computed: true,
  compute_error: true,
  source: true,
  created_by_name: true,
  created_at: true,
  updated_at: true,
} satisfies Keys<DatasetRecord>

const RECORD_WRITE_KEYS = {
  record: true,
  has_stale_downstream: true,
} satisfies Keys<DatasetRecordWrite>

const RECORD_DELETE_KEYS = {
  deleted_row_id: true,
  has_stale_downstream: true,
} satisfies Keys<DatasetRecordDelete>

const OVERRIDE_WRITE_KEYS = {
  ...RECORD_WRITE_KEYS,
  cleared: true,
} satisfies Keys<DatasetOverrideWrite>

const BULK_CLEAR_KEYS = {
  cleared_rows: true,
  cleared_cells: true,
  recomputed: true,
  failed: true,
  is_truncated: true,
  limit: true,
} satisfies Keys<DatasetOverrideBulkClear>

const LATEST_KEYS = {
  ts: true,
  values: true,
  computed: true,
} satisfies Keys<DatasetLatest>

const SERIES_POINT_KEYS = {
  ts: true,
  value: true,
} satisfies Keys<DatasetSeriesPoint>

const SERIES_KEYS = {
  series: true,
  is_truncated: true,
  limit: true,
} satisfies Keys<DatasetSeries>

const FORMULA_PARAM_KEYS = {
  name: true,
  kind: true,
  label: true,
  hint: true,
  default: true,
} satisfies Keys<DatasetFormulaParam>

const FORMULA_DEF_KEYS = {
  id: true,
  code: true,
  name: true,
  category: true,
  expression: true,
  params: true,
  description: true,
  is_builtin: true,
  is_enabled: true,
  signature: true,
  created_at: true,
  updated_at: true,
} satisfies Keys<DatasetFormulaDef>

const FORMULA_USAGE_KEYS = {
  table_id: true,
  table_code: true,
  table_name: true,
  column_id: true,
  column_key: true,
  column_name: true,
  formula: true,
  is_direct: true,
} satisfies Keys<DatasetFormulaUsage>

const FORMULA_DEF_WITH_USAGES_KEYS = {
  ...FORMULA_DEF_KEYS,
  usages: true,
} satisfies Keys<DatasetFormulaDefWithUsages>

const RECOMPUTE_KEYS = {
  recomputed: true,
  failed: true,
  is_truncated: true,
  limit: true,
} satisfies Keys<DatasetRecompute>

const BACKFILL_JOB_KEYS = {
  table_id: true,
  table_code: true,
  status: true,
  interval_ms: true,
  since: true,
  until: true,
  requested_since: true,
  requested_until: true,
  is_clamped: true,
  fast_path: true,
  total_buckets: true,
  done_buckets: true,
  written_rows: true,
  recomputed: true,
  recompute_failed: true,
  is_recompute_truncated: true,
  cursor: true,
  started_at: true,
  updated_at: true,
  finished_at: true,
  error: true,
  message: true,
  notes: true,
} satisfies Keys<DatasetBackfillJob>

const SHAPES: Record<string, Record<string, true>> = {
  TableSummaryOut: { ...SUMMARY_KEYS },
  TableOut: { ...TABLE_KEYS },
  ColumnOut: { ...COLUMN_KEYS },
  FormulaPrevDepOut: { ...PREV_DEP_KEYS },
  FormulaWindowDepOut: { ...WINDOW_DEP_KEYS },
  FormulaWholeDepOut: { ...WHOLE_DEP_KEYS },
  FormulaExternalDepOut: { ...EXTERNAL_DEP_KEYS },
  FormulaDepsOut: { ...DEPS_KEYS },
  CatalogChoiceOut: { ...CHOICE_KEYS },
  CatalogFunctionOut: { ...CATALOG_FUNCTION_KEYS },
  FormulaColumnOut: { ...FORMULA_COLUMN_KEYS },
  FormulaTableOut: { ...FORMULA_TABLE_KEYS },
  FormulaFunctionsOut: { ...CATALOG_KEYS },
  FormulaValidateOut: { ...VALIDATION_KEYS },
  FormulaPreviewOut: { ...PREVIEW_KEYS },
  OverrideOut: { ...OVERRIDE_KEYS },
  RecordOut: { ...RECORD_KEYS },
  RecordWriteOut: { ...RECORD_WRITE_KEYS },
  RecordDeleteOut: { ...RECORD_DELETE_KEYS },
  OverrideWriteOut: { ...OVERRIDE_WRITE_KEYS },
  OverrideBulkClearOut: { ...BULK_CLEAR_KEYS },
  LatestOut: { ...LATEST_KEYS },
  // ⚠ 类名带 `Dataset` 前缀是被迫的：空调面已有一个 `SeriesPointOut`，
  // 同名会让 FastAPI 把**两边**的形状名都改成带模块路径的长名
  DatasetSeriesPointOut: { ...SERIES_POINT_KEYS },
  SeriesOut: { ...SERIES_KEYS },
  FormulaParamSpec: { ...FORMULA_PARAM_KEYS },
  FormulaDefOut: { ...FORMULA_DEF_KEYS },
  FormulaUsageOut: { ...FORMULA_USAGE_KEYS },
  FormulaDefWithUsagesOut: { ...FORMULA_DEF_WITH_USAGES_KEYS },
  RecomputeOut: { ...RECOMPUTE_KEYS },
  BackfillJobOut: { ...BACKFILL_JOB_KEYS },
}

describe('台账线形与 openapi 一致', () => {
  it.each(Object.keys(SHAPES))('%s 的键与手写类型逐字相等', (name) => {
    const schema = schemas[name]
    expect(schema).toBeDefined()
    const declared = Object.keys(schema?.properties ?? {}).sort()
    expect(Object.keys(SHAPES[name] ?? {}).sort()).toEqual(declared)
  })

  it('列的三组闭合取值与后端 CHECK 约束同集合', () => {
    // ⚠ 前端多一档就是一个永远存不进库的选项，少一档就是一列显示成空白
    const enums: Record<string, readonly string[]> = {
      DatasetCollectMode: DATASET_COLLECT_MODES,
      DatasetColumnSource: DATASET_COLUMN_SOURCES,
      DatasetColumnType: DATASET_COLUMN_TYPES,
      DatasetAggFunc: DATASET_AGG_FUNCS,
      DatasetRecordSource: DATASET_RECORD_SOURCES,
    }
    expect(Object.values(enums).map((values) => [...values].sort())).toEqual([
      ['aggregate', 'manual'],
      ['formula', 'manual', 'point'],
      ['bool', 'number', 'string'],
      ['avg', 'count', 'delta', 'first', 'last', 'max', 'min', 'sum'],
      ['collect', 'import', 'manual'],
    ])
  })

  it('库公式的形参种类是两档闭合取值', () => {
    // ⚠ 两档差在**实参能是什么**：`column` 只收裸列引用，`value` 收任意
    // 表达式。前端多一档就是一个永远存不进库的选项
    const kind: DatasetFormulaParamKind = 'value'
    expect([...DATASET_FORMULA_PARAM_KINDS].sort()).toEqual(['column', 'value'])
    expect(DATASET_FORMULA_PARAM_KINDS).toContain(kind)
  })

  it('停用与删除在类型上是两件事，但破坏力相同', () => {
    // ⚠ 停用不是「藏起来」：引用它的台账列会在解析期报错，那张表的录入、
    // 导入、修正与重算一起失败——界面必须把这句话说出来，故 `is_enabled`
    // 与 `is_builtin` 都要在类型里（docs/DATASET_DESIGN.md §5.11）
    const def: DatasetFormulaDef = {
      id: 'f-1',
      code: '占比',
      name: '占比(%)',
      category: 'basic',
      expression: '{部分} / {整体} * 100',
      params: [
        { name: '部分', kind: 'column', label: '', hint: '', default: null },
        { name: '整体', kind: 'value', label: '', hint: '', default: 1 },
      ],
      description: null,
      is_builtin: true,
      is_enabled: false,
      signature: '@占比(部分, 整体)',
      created_at: '2026-08-24T10:00:00.000Z',
      updated_at: '2026-08-24T10:00:00.000Z',
    }
    expect([def.is_builtin, def.is_enabled]).toEqual([true, false])
  })

  it('间接引用在类型上分得出来', () => {
    // ⚠ `is_direct: false` 表示这一列是被**别的库公式**带进来的：改这一列
    // 救不了，要去改那条库公式
    const usage: DatasetFormulaUsage = {
      table_id: 't-1',
      table_code: 'shift',
      table_name: '班次台账',
      column_id: 'c-1',
      column_key: '净水',
      column_name: '净水量',
      formula: '@翻倍净值({进水}, {出水})',
      is_direct: false,
    }
    expect(usage.is_direct).toBe(false)
  })

  it('一行的来源是三档闭合取值', () => {
    // ⚠ 采集写出来的行与人填的行在界面上的处置不同（能不能改、撤销的措辞），
    // 前端多一档就是一个永远不会出现的分支，少一档就是一行显示不出来源
    const source: DatasetRecordSource = 'collect'
    expect(DATASET_RECORD_SOURCES).toContain(source)
  })

  it('一行的取值口径已经生效，前端不再叠一次修正', () => {
    // ⚠ `values` 出参已经是 effective（docs/DATASET_DESIGN.md D4）：类型上
    // `overrides[].value` 与 `values[key]` 是两个不相干的字段，谁也不是谁的
    // 补丁。写成「原值 + 补丁」的形状，前端迟早会去叠第二遍
    const record: DatasetRecord = {
      row_id: 'r-1',
      ts: '2026-08-23T10:00:00.000Z',
      values: { 温度: 25 },
      overrides: {
        温度: {
          value: 25,
          by: 'u-1',
          by_name: '张三',
          at: '2026-08-23T10:05:00.000Z',
          reason: null,
        },
      },
      samples: null,
      computed: {},
      compute_error: null,
      source: 'manual',
      created_by_name: '张三',
      created_at: '2026-08-23T10:00:00.000Z',
      updated_at: '2026-08-23T10:05:00.000Z',
    }
    expect(record.values['温度']).toBe(record.overrides?.['温度']?.value)
  })

  it('序列的截断标记与行数上限都在类型里', () => {
    // ⚠ 只有 series 的话，界面分不清「这段时间就这么多数据」与「数据太多被
    // 砍了」，用户看到的是一段看不出不完整的曲线（§6.2）
    const series: DatasetSeries = {
      series: { 产量: [{ ts: '2026-08-23T10:00:00.000Z', value: 1 }] },
      is_truncated: true,
      limit: 20000,
    }
    expect([series.is_truncated, series.limit]).toEqual([true, 20000])
  })

  it('回填的四档状态与后端字面量同集合', () => {
    // ⚠ `cancelled` 与 `failed` 分成两档是刻意的：前者是人按的「不用跑了」，
    // 后者要有人去看日志。合成一档，界面只能给出一句谁也不知道该不该管的话
    const status: DatasetBackfillStatus = 'cancelled'
    expect([...DATASET_BACKFILL_STATUSES].sort()).toEqual([
      'cancelled',
      'done',
      'failed',
      'running',
    ])
    expect(DATASET_BACKFILL_STATUSES).toContain(status)
  })

  it('回填回执同时带请求区间与实际区间', () => {
    // ⚠ 只给实际区间的话，被 clamp 掉的那一段在界面上无从对比，用户看到的
    // 只是「它补的比我要的少」，而少在哪一头看不出来（§14.3）
    const job: DatasetBackfillJob = {
      table_id: 't-1',
      table_code: 'shift',
      status: 'running',
      interval_ms: 3600000,
      since: '2026-08-20T00:00:00.000Z',
      until: '2026-08-23T00:00:00.000Z',
      requested_since: '2026-07-01T00:00:00.000Z',
      requested_until: '2026-08-24T00:00:00.000Z',
      is_clamped: true,
      fast_path: 'raw',
      total_buckets: 72,
      done_buckets: 0,
      written_rows: 0,
      recomputed: 0,
      recompute_failed: 0,
      is_recompute_truncated: false,
      cursor: null,
      started_at: '2026-08-24T05:30:00.000Z',
      updated_at: '2026-08-24T05:30:00.000Z',
      finished_at: null,
      error: null,
      message: '已开始回填 72 个桶',
      notes: ['起点早于点位历史的保留期（30 天）'],
    }
    expect(job.requested_since < job.since).toBe(true)
    // ⚠ 本仓的点位历史没有连续聚合视图，界面不要按「有快路可选」渲染
    expect([job.fast_path, job.notes.length]).toEqual(['raw', 1])
  })

  it('中间那档列来源是 point 而不是协议名', () => {
    // ⚠ 写死协议名会让「同一张台账里既有 OPC UA 点位又有 Modbus 点位」
    // 这件本来天然成立的事看起来像是没做（ADR-0011）
    const source: DatasetColumnSource = 'point'
    const mode: DatasetCollectMode = 'aggregate'
    const kind: DatasetColumnType = 'number'
    const agg: DatasetAggFunc = 'delta'
    expect([source, mode, kind, agg]).toEqual([
      'point',
      'aggregate',
      'number',
      'delta',
    ])
  })
})
