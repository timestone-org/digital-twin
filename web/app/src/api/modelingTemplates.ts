/** @fileoverview 模板建模的完整配置与生命周期接口。 */
import type {
  ModelDeployment,
  ModelingConfigurationDetail,
  ModelingInstance,
  ModelingInstanceConfigureInput,
  ModelingInstanceCreateInput,
  ModelingInstanceDeployInput,
  ModelingRun,
  ModelingTemplate,
  ModelingTemplateCreateInput,
  Page,
} from '@dt/contracts'
import { PLATFORM_BASE_URL } from '@/config/app'
import { requestData, type RequestOptions } from './client'
import { newIdempotencyKey } from './idempotency'

interface Query {
  page: number
  size: number
  q?: string
}

function read<T>(
  path: string,
  signal?: AbortSignal,
  query?: Query | { run_id: string },
): Promise<T> {
  return requestData<T>(path, {
    baseUrl: PLATFORM_BASE_URL,
    ...(signal ? { signal } : {}),
    ...(query ? { query: { ...query } } : {}),
  })
}

function write<T>(
  path: string,
  body: unknown,
  method: RequestOptions['method'] = 'POST',
): Promise<T> {
  return requestData<T>(path, {
    baseUrl: PLATFORM_BASE_URL,
    method,
    body,
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  })
}

export const listTemplates = (query: Query, signal?: AbortSignal) =>
  read<Page<ModelingTemplate>>('/modeling-templates', signal, query)
export const publishTemplate = (body: ModelingTemplateCreateInput) =>
  write<ModelingTemplate>('/modeling-templates', body)
export const getTemplateConfiguration = (id: string, signal?: AbortSignal) =>
  read<ModelingConfigurationDetail>(
    `/modeling-templates/${id}/configuration`,
    signal,
  )
export const setTemplateEnabled = (id: string, isEnabled: boolean) =>
  write<ModelingTemplate>(
    `/modeling-templates/${id}`,
    { is_enabled: isEnabled },
    'PATCH',
  )
export const listInstances = (query: Query, signal?: AbortSignal) =>
  read<Page<ModelingInstance>>('/modeling-instances', signal, query)
export const createInstance = (body: ModelingInstanceCreateInput) =>
  write<ModelingInstance>('/modeling-instances', body)
export const getInstance = (id: string, signal?: AbortSignal) =>
  read<ModelingInstance>(`/modeling-instances/${id}`, signal)
export const getInstanceConfiguration = (
  id: string,
  signal?: AbortSignal,
  runId?: string,
) =>
  read<ModelingConfigurationDetail>(
    `/modeling-instances/${id}/configuration`,
    signal,
    runId ? { run_id: runId } : undefined,
  )
export const configureInstance = (
  id: string,
  body: ModelingInstanceConfigureInput,
) =>
  write<ModelingInstance>(
    `/modeling-instances/${id}/configuration`,
    body,
    'PUT',
  )
export const trainInstance = (id: string) =>
  write<ModelingRun>(`/modeling-instances/${id}:train`, { trigger: 'manual' })
export const deployInstance = (id: string, body: ModelingInstanceDeployInput) =>
  write<ModelDeployment>(`/modeling-instances/${id}:deploy`, body)
