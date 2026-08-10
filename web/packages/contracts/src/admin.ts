/**
 * @fileoverview 用户 / 角色 / 路由规则管理面的类型。
 * ⚠ 与 `server/services/auth-server/openapi.json` 手工对齐，一致性由
 * `app/tests/contract/openapi-shapes.test.ts` 逐字段锁死；改接口先改这里。
 */

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  '*',
] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export const MATCH_MODES = ['all', 'any'] as const
export type MatchMode = (typeof MATCH_MODES)[number]

export interface RoleSummary {
  id: string
  name: string
  description: string | null
  is_builtin: boolean
  created_at: string
  updated_at: string
  permissions: string[]
  user_count: number
}

export interface RouteRule {
  id: string
  path_pattern: string
  http_method: HttpMethod
  permission_codes: string[]
  match_mode: MatchMode
  priority: number
  is_enabled: boolean
  is_builtin: boolean
  description: string | null
  created_at: string
  updated_at: string
}

export type UserListFilters = {
  q?: string | undefined
  is_active?: boolean | undefined
  role_id?: string | undefined
}
