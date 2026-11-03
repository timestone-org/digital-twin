/** @fileoverview 流水线迁移的预检、独立导入与已保存图导出。 */
import type {
  ModelingImportInspection,
  ModelingPipeline,
  ModelingPipelineImportInput,
  ModelingTransferDocument,
} from '@dt/contracts'

import { PLATFORM_BASE_URL } from '@/config/app'
import { requestData } from './client'

export async function inspectPipelineImport(
  document: unknown,
  signal?: AbortSignal,
): Promise<ModelingImportInspection> {
  return await requestData<ModelingImportInspection>(
    '/modeling-pipelines:inspect-import',
    {
      baseUrl: PLATFORM_BASE_URL,
      method: 'POST',
      body: document,
      ...(signal ? { signal } : {}),
    },
  )
}

export async function importPipeline(
  input: ModelingPipelineImportInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ModelingPipeline> {
  return await requestData<ModelingPipeline>('/modeling-pipelines:import', {
    baseUrl: PLATFORM_BASE_URL,
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': idempotencyKey },
    ...(signal ? { signal } : {}),
  })
}

export async function exportPipeline(
  pipelineId: string,
  signal?: AbortSignal,
): Promise<ModelingTransferDocument> {
  return await requestData<ModelingTransferDocument>(
    `/modeling-pipelines/${encodeURIComponent(pipelineId)}:export`,
    {
      baseUrl: PLATFORM_BASE_URL,
      method: 'POST',
      ...(signal ? { signal } : {}),
    },
  )
}
