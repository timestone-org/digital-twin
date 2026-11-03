/** @fileoverview 从 platform OpenAPI 生成的流水线迁移契约。 */
import type { ModelingGraph } from './modeling'
export type ModelingTransferDocument = {
  format_version: '1.0'
  operators: ModelingTransferOperator[]
  pipeline: ModelingTransferPipeline
}

export type ModelingPipelineImportInput = {
  code: string
  description?: string | null
  document: ModelingTransferDocument
  name: string
}

export type ModelingImportInspection = {
  can_import: boolean
  document: ModelingTransferDocument
  edge_count: number
  issues: ModelingTransferIssue[]
  node_count: number
  source_table_codes: string[]
}

export type ModelingTransferPipeline = {
  code: string
  description?: string | null
  graph: ModelingGraph
  name: string
}

export type ModelingTransferOperator = {
  operator: string
  spec_version: string
}

export type ModelingTransferIssue = {
  edge_id?: string
  level: 'error' | 'warning'
  message: string
  node_id?: string
}
