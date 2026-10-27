/** @fileoverview 从 platform OpenAPI 生成的异常检测、规则计算与版本元数据契约。 */
import type {
  OpenModelInfo,
  OpenModelWarning,
  ModelingOperator,
  ModelingRunSummary,
} from './modeling'
export type DetectionRow = Record<string, number | string | null>

export type AnomalyDecision = {
  is_anomaly: boolean
  row: number
  score: number
  threshold: number
}

export type OpenModelDetect = {
  model: OpenModelInfo
  results: AnomalyDecision[]
  warnings: OpenModelWarning[]
}

export type OpenModelDetectRequest = { rows: DetectionRow[] }

export type ModelingJsonValue = unknown

export type OpenModelCalculateRequest = { rows: DetectionRow[] }

export type OpenModelCalculate = {
  model: OpenModelInfo
  results: Record<string, ModelingJsonValue>[]
}

export type ModelingVersionUpdateInput = {
  description?: string | null
  name?: string | null
}

export type ModelingBdmCatalogItem = {
  code: string
  history_available: boolean | null
  identifier: string
  name: string
  system: string | null
}

export type ModelingBdmKind = 'point' | 'raw' | 'formula'

export type ModelingBdmCatalog = {
  items: ModelingBdmCatalogItem[]
  kind: ModelingBdmKind
  page: number
  size: number
  system_filter_available: boolean | null
  total: number
}

export type ModelingConfiguration = {
  nodes: Record<string, Record<string, ModelingJsonValue>>
}

export type ModelingParameterNode = {
  alias: string
  config: Record<string, ModelingJsonValue>
  id: string
  known_columns: string[] | null
  operator: ModelingOperator
}

export type ModelingConfigurationDetail = {
  configuration: ModelingConfiguration
  instance?: ModelingInstance | null
  json_schema: Record<string, ModelingJsonValue>
  nodes: ModelingParameterNode[]
}

export type ModelingTemplateCreateInput = {
  description?: string | null
  name: string
  pipeline_id: string
}

export type ModelingTemplateUpdateInput = { is_enabled: boolean }

export type ModelingTemplate = {
  code: string
  created_at: string
  created_by_name: string
  description: string | null
  id: string
  is_enabled: boolean
  name: string
  node_count: number
  pipeline_id: string
  updated_at: string
  version: number
}

export type ModelingInstanceCreateInput = {
  code: string
  configuration?: ModelingConfiguration | null
  description?: string | null
  name: string
  template_id: string
}

export type ModelingInstanceConfigureInput = {
  configuration: ModelingConfiguration
  description?: string | null
  expected_revision: number
  name?: string | null
}

export type ModelingInstanceDeployInput = {
  code: string
  description?: string | null
  max_rows_per_call?: number
  model_version_id: string
  name: string
  rate_limit_per_minute?: number
}

export type ModelingInstance = {
  code: string
  created_at: string
  description: string | null
  id: string
  latest_run: ModelingRunSummary | null
  name: string
  revision: number
  template_id: string
  template_name: string
  template_version: number
  updated_at: string
}
