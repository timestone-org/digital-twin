/**
 * @fileoverview 把分析建模的线形钉在 platform-server 的 openapi.json 上。
 *
 * 手写的类型比真接口**宽松**时，typecheck、lint 与单测全绿——编译器无从知道
 * 后端把那个字段叫什么。做法：每个类型用 `Record<keyof T, true>` 在**类型层**
 * 枚举一遍键（漏一个或多一个都过不了 typecheck），再和 openapi 的 properties
 * 比对，两头都锁住。
 */
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { MODELING_TASKS } from '@dt/contracts'

import type {
  ModelingBuiltinTemplate,
  AnomalyDecision,
  OpenModelDetect,
  OpenModelCalculate,
  OpenModelCalculateRequest,
  ModelingVersionUpdateInput,
  ModelApiKey,
  ModelApiKeyMinted,
  ModelCallStat,
  ModelDeployment,
  ModelFormulaRegistration,
  ModelingBinding,
  ModelingBdmCatalog,
  ModelingBdmCatalogItem,
  ModelingBdmSystems,
  ModelingBdmCapabilities,
  ModelingBdmIndicatorSource,
  ModelingBdmIndicator,
  ModelingBdmIndicators,
  ModelingBindingImpact,
  ModelingBindingUsage,
  ModelingGraph,
  ModelingGraphCheck,
  ModelingGraphEdge,
  ModelingGraphIssue,
  ModelingGraphNode,
  ModelingNodePosition,
  ModelingNodeRun,
  ModelingNodeRunSummary,
  ModelingOperator,
  ModelingPipeline,
  ModelingPipelineSummary,
  ModelingParamMap,
  ModelingPort,
  ModelingRun,
  ModelingRunSummary,
  ModelingVersion,
  ModelingVersionSummary,
  OpenModelInfo,
  OpenModelPredict,
  OpenModelMissingPolicy,
  OpenModelInput,
  OpenModelDerived,
  OpenModelOutput,
  OpenModelFixedDataPeriod,
  OpenModelCalendarDataPeriod,
  OpenModelSignature,
  OpenModelWarning,
} from '@dt/contracts'

interface OpenApiSchema {
  properties?: Record<string, unknown>
  enum?: string[]
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

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
  components: { schemas: Record<string, OpenApiSchema> }
}

type Keys<T> = Record<keyof T, true>

const BDM_ITEM = {
  identifier: true,
  code: true,
  name: true,
  system: true,
  history_available: true,
  table_type: true,
  unit: true,
} satisfies Keys<ModelingBdmCatalogItem>
const BDM_SYSTEMS = {
  items: true,
  system_filter_available: true,
} satisfies Keys<ModelingBdmSystems>
const BDM_CATALOG = {
  kind: true,
  total: true,
  page: true,
  size: true,
  system_filter_available: true,
  items: true,
} satisfies Keys<ModelingBdmCatalog>
const BDM_CAPABILITIES = {
  is_configured: true,
  timezone: true,
  minute_intervals: true,
  max_identifiers: true,
  max_formula_identifiers: true,
  max_rows: true,
  load_timeout_s: true,
} satisfies Keys<ModelingBdmCapabilities>
const BDM_INDICATOR_SOURCE = {
  source_type: true,
  source_id: true,
  source_property: true,
  alias: true,
  unit: true,
  is_selectable: true,
} satisfies Keys<ModelingBdmIndicatorSource>
const BDM_INDICATOR = {
  id: true,
  code: true,
  name: true,
  unit: true,
  sources: true,
} satisfies Keys<ModelingBdmIndicator>
const BDM_INDICATORS = {
  total: true,
  page: true,
  size: true,
  items: true,
} satisfies Keys<ModelingBdmIndicators>

const PORT = {
  name: true,
  contract: true,
  label: true,
  is_required: true,
  description: true,
} satisfies Keys<ModelingPort>

const OPERATOR = {
  code: true,
  name: true,
  description: true,
  category: true,
  spec_version: true,
  icon: true,
  inputs: true,
  outputs: true,
  config_schema: true,
  fit_required: true,
  serving_enabled: true,
  serving_window_required: true,
  serving_channel: true,
} satisfies Keys<ModelingOperator>

const NODE_POSITION = {
  left: true,
  top: true,
} satisfies Keys<ModelingNodePosition>

const GRAPH_NODE = {
  id: true,
  operator: true,
  alias: true,
  config: true,
  position: true,
} satisfies Keys<ModelingGraphNode>

const GRAPH_EDGE = {
  id: true,
  from_node: true,
  from_port: true,
  to_node: true,
  to_port: true,
} satisfies Keys<ModelingGraphEdge>

const GRAPH = {
  format_version: true,
  nodes: true,
  edges: true,
} satisfies Keys<ModelingGraph>

const GRAPH_ISSUE = {
  message: true,
  node_id: true,
  edge_id: true,
} satisfies Keys<ModelingGraphIssue>

const GRAPH_CHECK = {
  is_valid: true,
  issues: true,
  known_columns: true,
} satisfies Keys<ModelingGraphCheck>

const PIPELINE_SUMMARY = {
  id: true,
  code: true,
  name: true,
  description: true,
  node_count: true,
  source_table_codes: true,
  created_by_name: true,
  created_at: true,
  updated_at: true,
} satisfies Keys<ModelingPipelineSummary>

const PIPELINE = {
  ...PIPELINE_SUMMARY,
  graph: true,
} satisfies Keys<ModelingPipeline>

const NODE_RUN_SUMMARY = {
  node_id: true,
  operator: true,
  alias: true,
  ordinal: true,
  status: true,
  duration_ms: true,
  has_preview: true,
  error_text: true,
} satisfies Keys<ModelingNodeRunSummary>

const NODE_RUN = {
  ...NODE_RUN_SUMMARY,
  preview: true,
  is_preview_truncated: true,
  exported_ports: true,
  report: true,
  fitted: true,
} satisfies Keys<ModelingNodeRun>

const BUILTIN_TEMPLATE = {
  key: true,
  label: true,
  hint: true,
  category: true,
} satisfies Keys<ModelingBuiltinTemplate>

const RUN_SUMMARY = {
  id: true,
  pipeline_id: true,
  pipeline_name: true,
  pipeline_code: true,
  instance_id: true,
  published_version_id: true,
  auto_publish: true,
  publication_status: true,
  publication_error: true,
  status: true,
  trigger: true,
  started_at: true,
  finished_at: true,
  duration_ms: true,
  row_count: true,
  is_source_truncated: true,
  is_keeping_frames: true,
  error_text: true,
  created_by_name: true,
  created_at: true,
} satisfies Keys<ModelingRunSummary>

const RUN = {
  ...RUN_SUMMARY,
  graph: true,
  nodes: true,
} satisfies Keys<ModelingRun>

const VERSION_SUMMARY = {
  id: true,
  pipeline_id: true,
  run_id: true,
  version: true,
  name: true,
  algo: true,
  task: true,
  is_servable: true,
  serving_channel: true,
  unservable_reason: true,
  feature_keys: true,
  target_key: true,
  created_by_name: true,
  created_at: true,
  archived_at: true,
  instance_id: true,
  deployment_count: true,
  deployments_url: true,
} satisfies Keys<ModelingVersionSummary>

const VERSION = {
  ...VERSION_SUMMARY,
  signature: true,
  metrics: true,
  fingerprint: true,
  description: true,
} satisfies Keys<ModelingVersion>

const PARAM_MAP = {
  param: true,
  feature: true,
} satisfies Keys<ModelingParamMap>

const BINDING_USAGE = {
  table_code: true,
  column_key: true,
} satisfies Keys<ModelingBindingUsage>

const BINDING = {
  id: true,
  fx_code: true,
  model_version_id: true,
  model_name: true,
  model_version: true,
  param_map: true,
  is_enabled: true,
  is_orphaned: true,
  created_by_name: true,
  created_at: true,
  updated_at: true,
} satisfies Keys<ModelingBinding>

const BINDING_IMPACT = {
  ...BINDING,
  usages: true,
} satisfies Keys<ModelingBindingImpact>

const DEPLOYMENT = {
  id: true,
  code: true,
  revision: true,
  model_version_id: true,
  model_name: true,
  model_version: true,
  task: true,
  invoke_url: true,
  signature_url: true,
  name: true,
  description: true,
  is_enabled: true,
  is_servable: true,
  unservable_reason: true,
  max_rows_per_call: true,
  rate_limit_per_minute: true,
  key_count: true,
  created_by_name: true,
  created_at: true,
  updated_at: true,
} satisfies Keys<ModelDeployment>

// ⚠ 没有 `plaintext`：明文只在铸出来那一次的回执里出现
const API_KEY = {
  id: true,
  deployment_id: true,
  name: true,
  key_prefix: true,
  expires_at: true,
  revoked_at: true,
  last_used_at: true,
  created_by_name: true,
  created_at: true,
} satisfies Keys<ModelApiKey>

const API_KEY_MINTED = {
  ...API_KEY,
  plaintext: true,
} satisfies Keys<ModelApiKeyMinted>

const CALL_STAT = {
  day: true,
  total: true,
  failed: true,
} satisfies Keys<ModelCallStat>

const OPEN_MODEL_INFO = {
  code: true,
  version: true,
} satisfies Keys<OpenModelInfo>

const OPEN_MODEL_WARNING = {
  row: true,
  column: true,
  kind: true,
  message: true,
} satisfies Keys<OpenModelWarning>

const OPEN_MODEL_PREDICT = {
  model: true,
  predictions: true,
  warnings: true,
} satisfies Keys<OpenModelPredict>

const OPEN_MODEL_MISSING_POLICY = {
  on_missing: true,
  on_null: true,
} satisfies Keys<OpenModelMissingPolicy>
const OPEN_MODEL_INPUT = {
  key: true,
  label: true,
  unit: true,
  dtype: true,
  is_required: true,
  default_on_missing: true,
  missing_policy: true,
} satisfies Keys<OpenModelInput>
const OPEN_MODEL_DERIVED = {
  key: true,
  by: true,
  label: true,
} satisfies Keys<OpenModelDerived>
const OPEN_MODEL_OUTPUT = {
  key: true,
  label: true,
  unit: true,
  dtype: true,
  task: true,
} satisfies Keys<OpenModelOutput>
const OPEN_MODEL_SIGNATURE = {
  task: true,
  invoke_url: true,
  timestamp_key: true,
  format_version: true,
  requires_timestamp: true,
  data_period: true,
  inputs: true,
  derived: true,
  output: true,
} satisfies Keys<OpenModelSignature>
const OPEN_MODEL_DATA_PERIOD = {
  kind: true,
  interval_ms: true,
  calendar_unit: true,
  timezone: true,
} satisfies Keys<OpenModelFixedDataPeriod> & Keys<OpenModelCalendarDataPeriod>

const FORMULA_REGISTRATION = {
  formula: true,
  binding: true,
} satisfies Keys<ModelFormulaRegistration>

const ANOMALY_DECISION = {
  row: true,
  is_anomaly: true,
  score: true,
  threshold: true,
} satisfies Keys<AnomalyDecision>
const OPEN_MODEL_DETECT = {
  model: true,
  results: true,
  warnings: true,
} satisfies Keys<OpenModelDetect>

const OPEN_MODEL_CALCULATE = {
  model: true,
  results: true,
} satisfies Keys<OpenModelCalculate>
const OPEN_MODEL_CALCULATE_REQUEST = {
  rows: true,
} satisfies Keys<OpenModelCalculateRequest>
const VERSION_UPDATE = {
  name: true,
  description: true,
} satisfies Keys<ModelingVersionUpdateInput>

const PAIRS: ReadonlyArray<readonly [string, Record<string, true>]> = [
  ['BuiltinModelingTemplateOut', BUILTIN_TEMPLATE],
  ['PortOut', PORT],
  ['OperatorOut', OPERATOR],
  ['NodePosition', NODE_POSITION],
  ['GraphNode', GRAPH_NODE],
  ['GraphEdge', GRAPH_EDGE],
  ['PipelineGraph', GRAPH],
  ['GraphIssueOut', GRAPH_ISSUE],
  ['GraphCheckOut', GRAPH_CHECK],
  ['PipelineSummaryOut', PIPELINE_SUMMARY],
  ['PipelineOut', PIPELINE],
  ['NodeRunSummaryOut', NODE_RUN_SUMMARY],
  ['NodeRunOut', NODE_RUN],
  ['RunSummaryOut', RUN_SUMMARY],
  ['RunOut', RUN],
  ['ModelVersionSummaryOut', VERSION_SUMMARY],
  ['ModelVersionOut', VERSION],
  ['ParamMapOut', PARAM_MAP],
  ['ModelBindingUsageOut', BINDING_USAGE],
  ['ModelBindingOut', BINDING],
  ['ModelBindingImpactOut', BINDING_IMPACT],
  ['ModelFormulaOut', FORMULA_REGISTRATION],
  ['ModelDeploymentOut', DEPLOYMENT],
  ['ModelApiKeyOut', API_KEY],
  ['ModelApiKeyMintedOut', API_KEY_MINTED],
  ['ModelCallStatOut', CALL_STAT],
  ['OpenModelInfoOut', OPEN_MODEL_INFO],
  ['OpenModelWarningOut', OPEN_MODEL_WARNING],
  ['OpenModelPredictOut', OPEN_MODEL_PREDICT],
  ['OpenModelMissingPolicyOut', OPEN_MODEL_MISSING_POLICY],
  ['OpenModelInputOut', OPEN_MODEL_INPUT],
  ['OpenModelDerivedOut', OPEN_MODEL_DERIVED],
  ['OpenModelOutputOut', OPEN_MODEL_OUTPUT],
  ['OpenModelFixedDataPeriodOut', OPEN_MODEL_DATA_PERIOD],
  ['OpenModelCalendarDataPeriodOut', OPEN_MODEL_DATA_PERIOD],
  ['OpenModelSignatureOut', OPEN_MODEL_SIGNATURE],
  ['AnomalyDecisionOut', ANOMALY_DECISION],
  ['OpenModelDetectOut', OPEN_MODEL_DETECT],
  ['OpenModelCalculateOut', OPEN_MODEL_CALCULATE],
  ['OpenModelCalculateIn', OPEN_MODEL_CALCULATE_REQUEST],
  ['ModelVersionUpdateIn', VERSION_UPDATE],
  ['BdmCatalogItemOut', BDM_ITEM],
  ['BdmCatalogOut', BDM_CATALOG],
  ['BdmSystemsOut', BDM_SYSTEMS],
  ['BdmCapabilitiesOut', BDM_CAPABILITIES],
  ['BdmIndicatorSourceOut', BDM_INDICATOR_SOURCE],
  ['BdmIndicatorOut', BDM_INDICATOR],
  ['BdmIndicatorsOut', BDM_INDICATORS],
]

describe('分析建模线形与 openapi 一致', () => {
  it('固定周期的字段类型与必填性由 OpenAPI 生成', () => {
    expectTypeOf<OpenModelFixedDataPeriod>().toEqualTypeOf<{
      kind: 'fixed'
      interval_ms: number
      calendar_unit?: null
      timezone?: null
    }>()
    expect(
      spec.components.schemas['OpenModelFixedDataPeriodOut'],
    ).toMatchObject({
      required: ['kind', 'interval_ms'],
      properties: {
        kind: { const: 'fixed', type: 'string' },
        interval_ms: { type: 'integer', exclusiveMinimum: 0 },
        calendar_unit: { type: 'null' },
        timezone: { type: 'null' },
      },
    })
  })
  it('日历周期保留单位和时区，签名允许未知周期', () => {
    expectTypeOf<OpenModelCalendarDataPeriod>().toEqualTypeOf<{
      kind: 'calendar'
      interval_ms?: null
      calendar_unit: 'day' | 'month'
      timezone: string
    }>()
    expectTypeOf<Pick<OpenModelSignature, 'data_period'>>().toEqualTypeOf<{
      data_period?:
        OpenModelFixedDataPeriod | OpenModelCalendarDataPeriod | null
    }>()
    expect(
      spec.components.schemas['OpenModelCalendarDataPeriodOut'],
    ).toMatchObject({
      required: ['kind', 'calendar_unit', 'timezone'],
      properties: {
        kind: { const: 'calendar', type: 'string' },
        interval_ms: { type: 'null' },
        calendar_unit: { enum: ['day', 'month'], type: 'string' },
        timezone: { type: 'string', minLength: 1 },
      },
    })
    expect(
      spec.components.schemas['OpenModelSignatureOut']?.properties?.[
        'data_period'
      ],
    ).toMatchObject({
      anyOf: [
        { $ref: '#/components/schemas/OpenModelFixedDataPeriodOut' },
        { $ref: '#/components/schemas/OpenModelCalendarDataPeriodOut' },
        { type: 'null' },
      ],
    })
    expect(spec.components.schemas['OpenModelSignatureOut']).not.toMatchObject({
      required: expect.arrayContaining(['data_period']),
    })
  })
  it('部署必需声明与模型版本一致的任务类型', () => {
    expect(spec.components.schemas['ModelDeploymentOut']).toMatchObject({
      required: expect.arrayContaining(['task']),
      properties: {
        task: { type: 'string', enum: [...MODELING_TASKS].sort() },
      },
    })
  })

  it('BDM 数据类别与生成类型一致', () => {
    const kinds = [
      'point',
      'raw',
      'formula',
    ] satisfies ModelingBdmCatalog['kind'][]
    expect(spec.components.schemas['BdmKind']?.enum).toEqual(kinds)
  })
  it('内置模板用途与生成类型一致', () => {
    const categories = {
      prediction: true,
      detection: true,
      analysis: true,
      rule: true,
    } satisfies Record<ModelingBuiltinTemplate['category'], true>
    expect(spec.components.schemas['BuiltinTemplateCategory']?.enum).toEqual(
      Object.keys(categories),
    )
  })
  it.each(PAIRS)('%s 的键与线形逐字相等', (name, wire) => {
    const schema = spec.components.schemas[name]
    expect(schema).toBeDefined()
    const declared = Object.keys(schema?.properties ?? {}).sort()
    expect(Object.keys(wire).sort()).toEqual(declared)
  })

  it('异常检测、规则计算和版本元数据的生成类型与 OpenAPI 逐字一致', async () => {
    const execute = promisify(execFile)
    await expect(
      execute(
        'uv',
        [
          'run',
          '--no-sync',
          'python',
          '-m',
          'scripts.export_modeling_detection_types',
          '--check',
        ],
        { cwd: dirname(SPEC_PATH), timeout: 60_000 },
      ),
    ).resolves.toMatchObject({ stdout: '' })
  }, 60_000)
})
