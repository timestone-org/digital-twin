/** @fileoverview 工作流定时训练、直接发布与记录清理接口。 */
import type {
  ModelDeployment,
  ModelingPipeline,
  ModelingSchedule,
  ModelingScheduleInput,
} from '@dt/contracts'
import { PLATFORM_BASE_URL } from '@/config/app'
import { request, requestData } from './client'
import { newIdempotencyKey } from './idempotency'

export function getModelingSchedule(
  pipelineId: string,
  signal?: AbortSignal,
): Promise<ModelingSchedule> {
  return requestData(`/modeling-pipelines/${pipelineId}/schedule`, {
    baseUrl: PLATFORM_BASE_URL,
    ...(signal ? { signal } : {}),
  })
}

export function saveModelingSchedule(
  pipelineId: string,
  body: ModelingScheduleInput,
): Promise<ModelingSchedule> {
  return requestData(`/modeling-pipelines/${pipelineId}/schedule`, {
    baseUrl: PLATFORM_BASE_URL,
    method: 'PUT',
    body,
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  })
}

export function deployModelingRun(
  runId: string,
  isSignatureChangeConfirmed = false,
): Promise<ModelDeployment> {
  return requestData(`/modeling-runs/${runId}:deploy`, {
    baseUrl: PLATFORM_BASE_URL,
    method: 'POST',
    body: { is_signature_change_confirmed: isSignatureChangeConfirmed },
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  })
}

export async function deleteModelingRun(runId: string): Promise<void> {
  await request(`/modeling-runs/${runId}`, {
    baseUrl: PLATFORM_BASE_URL,
    method: 'DELETE',
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  })
}

export async function deleteModelingVersion(versionId: string): Promise<void> {
  await request(`/modeling-model-versions/${versionId}`, {
    baseUrl: PLATFORM_BASE_URL,
    method: 'DELETE',
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  })
}

export function createWorkflowFromTemplate(
  templateId: string,
  body: { code: string; name: string; description?: string | null },
): Promise<ModelingPipeline> {
  return requestData(`/modeling-templates/${templateId}:create-workflow`, {
    baseUrl: PLATFORM_BASE_URL,
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  })
}
