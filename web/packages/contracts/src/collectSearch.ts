/** @fileoverview 从 platform OpenAPI 生成的点位语义检索契约。 */
export type PointMatchOut = {
  code: string
  description: string | null
  id: string
  is_enabled: boolean
  is_exact: boolean
  name: string
  node_key: string
  score: number
  source_id: string
  source_name: string
  unit: string | null
}

export type PointMatchesOut = {
  items: PointMatchOut[]
  mode: 'hybrid' | 'keyword'
  note?: string | null
  pending_count: number
}
