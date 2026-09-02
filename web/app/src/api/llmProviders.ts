/**
 * @fileoverview 模型供应商目录的接口封装（ADR-0039）。组件不直接发请求，一律经这里。
 *
 * ⚠ 这一组打的是 platform-server，每个请求都要给 `baseUrl`：漏了会静默打到
 * auth-server 上，现象是「页面永远列不出供应商」而不是一个报错。
 * ⚠ 建供应商必须带 `Idempotency-Key`：网络抖动引发的重试在没有幂等键时会
 * **建两路同名的供应商**（第二次撞 409，而用户看到的是一条莫名的冲突）。
 * ⚠ 密钥只在建与改的请求体里出现一次，任何出参里都没有它。
 */
import type {
  LlmProbeResult,
  LlmProvider,
  LlmPurpose,
  Page,
} from '@dt/contracts'

import { PLATFORM_BASE_URL } from '@/config/app'
import { request, requestData, type RequestOptions } from './client'
import { newIdempotencyKey } from './idempotency'

const PROVIDERS = '/llm-providers'
const PURPOSES = '/llm-purposes'

function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

/** 登记一个模型的入参。嵌入模型必须带维数，对话模型不许带。 */
export interface LlmModelInput {
  name: string
  kind: string
  has_vision: boolean
  dimensions: number | null
}

/** 建一路供应商的入参。 */
export interface LlmProviderCreateInput {
  name: string
  base_url: string
  api_key: string
  is_enabled: boolean
  extra_body: Record<string, unknown> | null
  models: LlmModelInput[]
  notes: string
}

/** 改一路供应商的入参。缺省的字段不动；`api_key` 不给即沿用旧的。 */
export interface LlmProviderUpdateInput {
  name?: string | undefined
  base_url?: string | undefined
  api_key?: string | undefined
  is_enabled?: boolean | undefined
  extra_body?: Record<string, unknown> | null | undefined
  models?: LlmModelInput[] | undefined
  notes?: string | undefined
}

/** 列一页供应商。 */
export async function listProviders(
  query: { page?: number | undefined; size?: number | undefined } = {},
  signal?: AbortSignal,
): Promise<Page<LlmProvider>> {
  return requestData<Page<LlmProvider>>(
    PROVIDERS,
    onPlatform({ query, signal }),
  )
}

/** 建一路供应商。 */
export async function createProvider(
  input: LlmProviderCreateInput,
  key: string = newIdempotencyKey(),
): Promise<LlmProvider> {
  return requestData<LlmProvider>(
    PROVIDERS,
    onPlatform({
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': key },
    }),
  )
}

/** 改一路供应商。 */
export async function updateProvider(
  providerId: string,
  input: LlmProviderUpdateInput,
): Promise<LlmProvider> {
  return requestData<LlmProvider>(
    `${PROVIDERS}/${providerId}`,
    onPlatform({ method: 'PATCH', body: input }),
  )
}

/** 删一路供应商。⚠ 还被用途指着时后端回 409，先把用途改指别处。 */
export async function deleteProvider(providerId: string): Promise<void> {
  await request<null>(
    `${PROVIDERS}/${providerId}`,
    onPlatform({ method: 'DELETE' }),
  )
}

/** 保存前拿表单里的地址与密钥探一次端点。不落任何东西。 */
export async function probeDraft(input: {
  base_url: string
  api_key: string
}): Promise<LlmProbeResult> {
  return requestData<LlmProbeResult>(
    `${PROVIDERS}:probe`,
    onPlatform({ method: 'POST', body: input }),
  )
}

/** 拿库里那一把密钥探一次端点。密钥不出门。 */
export async function probeProvider(
  providerId: string,
): Promise<LlmProbeResult> {
  return requestData<LlmProbeResult>(
    `${PROVIDERS}/${providerId}:probe`,
    onPlatform({ method: 'POST' }),
  )
}

/** 全部用途，带各自此刻的分配。 */
export async function listPurposes(
  signal?: AbortSignal,
): Promise<LlmPurpose[]> {
  return requestData<LlmPurpose[]>(PURPOSES, onPlatform({ signal }))
}

/** 把一个用途指到一路供应商上的一个模型。 */
export async function assignPurpose(
  purpose: string,
  input: { provider_id: string; model_name: string },
): Promise<LlmPurpose> {
  return requestData<LlmPurpose>(
    `${PURPOSES}/${purpose}`,
    onPlatform({ method: 'PUT', body: input }),
  )
}

/** 清掉一个用途的分配，那一侧退回环境变量配的那一档。 */
export async function clearPurpose(purpose: string): Promise<void> {
  await request<null>(
    `${PURPOSES}/${purpose}`,
    onPlatform({ method: 'DELETE' }),
  )
}
