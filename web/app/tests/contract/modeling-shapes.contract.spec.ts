/**
 * @fileoverview 把分析建模的线形钉在 platform-server 的 openapi.json 上。
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
  ModelingBinding,
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

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
  components: { schemas: Record<string, OpenApiSchema> }
}

type Keys<T> = Record<keyof T, true>

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
} satisfies Keys<ModelingNodeRun>

const RUN_SUMMARY = {
  id: true,
  pipeline_id: true,
  status: true,
  trigger: true,
  started_at: true,
  finished_at: true,
  duration_ms: true,
  row_count: true,
  is_source_truncated: true,
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
} satisfies Keys<ModelingVersionSummary>

const VERSION = {
  ...VERSION_SUMMARY,
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

const PAIRS: ReadonlyArray<readonly [string, Record<string, true>]> = [
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
]

describe('分析建模线形与 openapi 一致', () => {
  it.each(PAIRS)('%s 的键与线形逐字相等', (name, wire) => {
    const schema = spec.components.schemas[name]
    expect(schema).toBeDefined()
    const declared = Object.keys(schema?.properties ?? {}).sort()
    expect(Object.keys(wire).sort()).toEqual(declared)
  })
})
