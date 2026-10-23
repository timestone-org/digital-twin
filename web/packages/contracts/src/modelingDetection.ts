/** @fileoverview 从 platform OpenAPI 生成的异常检测、规则计算与版本元数据契约。 */
import type { OpenModelInfo, OpenModelWarning } from './modeling'
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
