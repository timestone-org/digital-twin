/** @fileoverview 从 platform OpenAPI 生成的异常检测契约。 */
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
