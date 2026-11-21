/** @fileoverview 知识库当前已发布向量索引的可用状态。 */
export const KNOWLEDGE_VECTOR_STATUSES = [
  'unindexed',
  'ready',
  'legacy_unverified',
  'model_unavailable',
  'space_mismatch',
] as const

export type KnowledgeVectorStatus = (typeof KNOWLEDGE_VECTOR_STATUSES)[number]

export const KNOWLEDGE_REEMBEDDING_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type KnowledgeReembeddingStatus =
  (typeof KNOWLEDGE_REEMBEDDING_STATUSES)[number]

export interface KnowledgeReembeddingPreview {
  target_model: string | null
  target_dimensions: number | null
  target_space_id: string | null
  content_revision: number
  total_documents: number
  total_chunks: number
  can_start: boolean
  note: string
}

export interface KnowledgeReembeddingStart {
  target_space_id: string
  expected_revision: number
}

export interface KnowledgeReembeddingJob {
  id: string
  base_id: string
  status: KnowledgeReembeddingStatus
  target_model: string
  target_dimensions: number
  total_chunks: number
  completed_chunks: number
  created_at: string
  finished_at: string | null
  error_message: string | null
}
