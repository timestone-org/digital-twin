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
  DatasetCatalogChoice,
  DatasetCatalogFunction,
  DatasetCollectMode,
  DatasetColumn,
  DatasetColumnSource,
  DatasetColumnType,
  DatasetExternalDep,
  DatasetFormulaCatalog,
  DatasetFormulaColumn,
  DatasetFormulaDeps,
  DatasetFormulaPreview,
  DatasetFormulaTable,
  DatasetFormulaValidation,
  DatasetPrevDep,
  DatasetTable,
  DatasetTableSummary,
  DatasetWholeDep,
  DatasetWindowDep,
} from '@dt/contracts'
import {
  DATASET_AGG_FUNCS,
  DATASET_COLLECT_MODES,
  DATASET_COLUMN_SOURCES,
  DATASET_COLUMN_TYPES,
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
    }
    expect(Object.values(enums).map((values) => [...values].sort())).toEqual([
      ['aggregate', 'manual'],
      ['formula', 'manual', 'point'],
      ['bool', 'number', 'string'],
      ['avg', 'count', 'delta', 'first', 'last', 'max', 'min', 'sum'],
    ])
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
