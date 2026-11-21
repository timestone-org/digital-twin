/** @fileoverview 知识库整库重嵌的预检、启动、进度与取消。 */
import { KNOWLEDGE_REEMBEDDING_STATUSES } from '@dt/contracts'
import type {
  KnowledgeReembeddingJob,
  KnowledgeReembeddingPreview,
  KnowledgeReembeddingStart,
  Page,
} from '@dt/contracts'
import { KNOWLEDGE_BASE_URL } from '@/config/app'
import { requestData, TransportError } from './client'

function jobs(baseId: string): string {
  return `/knowledge-bases/${encodeURIComponent(baseId)}/reembeddings`
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasTarget(preview: KnowledgeReembeddingPreview): boolean {
  return (
    typeof preview.target_space_id === 'string' &&
    /^[0-9a-f]{64}$/.test(preview.target_space_id) &&
    typeof preview.target_model === 'string' &&
    preview.target_model.trim() !== '' &&
    isCount(preview.target_dimensions) &&
    preview.target_dimensions > 0
  )
}

function checkedJob(
  job: KnowledgeReembeddingJob,
  baseId: string,
  jobId?: string,
): KnowledgeReembeddingJob {
  if (
    !job ||
    job.base_id !== baseId ||
    !job.id ||
    !KNOWLEDGE_REEMBEDDING_STATUSES.includes(job.status) ||
    ![job.completed_chunks, job.total_chunks].every(isCount)
  ) {
    throw new TransportError(0, '重嵌任务的响应与当前知识库不符')
  }
  if (jobId !== undefined && job.id !== jobId)
    throw new TransportError(0, '返回的重嵌任务编号不匹配')
  return job
}

export async function previewReembedding(
  baseId: string,
  signal: AbortSignal,
): Promise<KnowledgeReembeddingPreview> {
  const result = await requestData<KnowledgeReembeddingPreview>(
    `${jobs(baseId)}:preview`,
    {
      baseUrl: KNOWLEDGE_BASE_URL,
      method: 'POST',
      body: {},
      signal,
    },
  )
  if (
    ![
      result.content_revision,
      result.total_chunks,
      result.total_documents,
    ].every(isCount)
  ) {
    throw new TransportError(0, '重嵌预检的工作量或修订号无效')
  }
  if (result.can_start && !hasTarget(result)) {
    throw new TransportError(0, '重嵌预检缺少目标空间或内容修订号')
  }
  return result
}

export async function latestReembedding(
  baseId: string,
  signal: AbortSignal,
): Promise<KnowledgeReembeddingJob | null> {
  const page = await requestData<Page<KnowledgeReembeddingJob>>(jobs(baseId), {
    baseUrl: KNOWLEDGE_BASE_URL,
    query: { page: 1, size: 1 },
    signal,
  })
  const first = page.items[0]
  if (first) return checkedJob(first, baseId)
  if (page.total !== 0)
    throw new TransportError(0, '重嵌任务列表不完整，请刷新')
  return null
}

export async function readReembedding(
  baseId: string,
  jobId: string,
  signal: AbortSignal,
): Promise<KnowledgeReembeddingJob> {
  const job = await requestData<KnowledgeReembeddingJob>(
    `${jobs(baseId)}/${encodeURIComponent(jobId)}`,
    { baseUrl: KNOWLEDGE_BASE_URL, signal },
  )
  return checkedJob(job, baseId, jobId)
}

export async function startReembedding(
  baseId: string,
  body: KnowledgeReembeddingStart,
  key: string,
): Promise<KnowledgeReembeddingJob> {
  const job = await requestData<KnowledgeReembeddingJob>(jobs(baseId), {
    baseUrl: KNOWLEDGE_BASE_URL,
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': key },
  })
  return checkedJob(job, baseId)
}

export async function cancelReembedding(
  baseId: string,
  jobId: string,
): Promise<KnowledgeReembeddingJob> {
  const job = await requestData<KnowledgeReembeddingJob>(
    `${jobs(baseId)}/${encodeURIComponent(jobId)}:cancel`,
    {
      baseUrl: KNOWLEDGE_BASE_URL,
      method: 'POST',
    },
  )
  return checkedJob(job, baseId, jobId)
}
