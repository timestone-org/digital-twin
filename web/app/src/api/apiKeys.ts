/**
 * @fileoverview API 密钥管理面的接口封装（ADR-0013）。
 *
 * ⚠ 这里管的是**发给第三方系统的凭据**，不是普通前端会话自己的凭据。唯一例外
 * 是 ADR-0051 的受控嵌入首航：API Key 只在内存里换短期令牌，绝不落 storage。
 */

import type { ApiKey, ApiKeyFilters, ApiKeySecret, Page } from '@dt/contracts'

import type { PageQuery } from './admin'
import { requestData } from './client'

export async function listApiKeys(
  query: ApiKeyFilters & PageQuery = {},
): Promise<Page<ApiKey>> {
  return await requestData<Page<ApiKey>>('/api-keys', { query })
}

export interface ApiKeyCreateInput {
  user_id: string
  name: string
  /** ⚠ 必填，`null` 才是「永不过期」——它得是有人主动选的，不能是漏填。 */
  expires_in_days: number | null
}

/** 签发。⚠ 回参里的 `secret` 是明文且**只此一次**，调用方必须当场展示。 */
export async function issueApiKey(
  input: ApiKeyCreateInput,
): Promise<ApiKeySecret> {
  return await requestData<ApiKeySecret>('/api-keys', {
    method: 'POST',
    body: input,
  })
}

/** 吊销。立刻生效，且不删行——审计要留痕。重复调用无副作用。 */
export async function revokeApiKey(keyId: string): Promise<ApiKey> {
  return await requestData<ApiKey>(`/api-keys/${keyId}:revoke`, {
    method: 'POST',
  })
}
