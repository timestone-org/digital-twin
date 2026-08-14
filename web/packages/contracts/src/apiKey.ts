/**
 * @fileoverview API 密钥的对外类型（ADR-0013）。
 * ⚠ 手写自 `server/services/auth-server/openapi.json`，一致性由
 * `app/tests/contract/openapi-shapes.contract.spec.ts` 逐字段锁死。
 */

/**
 * 一枚密钥的元信息。
 *
 * ⚠ 这里**没有明文**，也永远不会有：库里只存散列，读面拿不回来。
 * 明文只在签发那一次的 `ApiKeySecret.secret` 里出现。
 */
export interface ApiKey {
  id: string
  user_id: string
  name: string
  /** 明文的前 8 位，列表里靠它指认是哪一枚。 */
  prefix: string
  /** 未吊销且未过期。⚠ 它由后端按「此刻」算，不要在前端用 expires_at 自己推。 */
  is_active: boolean
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

/** 签发回执。`secret` 是完整明文，**只此一次**。 */
export interface ApiKeySecret {
  api_key: ApiKey
  secret: string
}

/**
 * 列表筛选。
 *
 * ⚠ 用 `type` 而不是 `interface`：interface 没有隐式索引签名，传给 `request`
 * 的 `query`（`Record<...>`）会被类型检查拒掉。与 `UserListFilters` 同因。
 */
export type ApiKeyFilters = {
  user_id?: string | undefined
  /** 默认只列未吊销的——吊销的行永不删除，会一直堆着。 */
  should_include_revoked?: boolean | undefined
}
