/**
 * @fileoverview 用户 / 角色 / 路由规则管理面的接口封装。
 * 组件不直接发请求，一律经这里。分页一律带 page/size，后端 size 上限 200。
 */

import type {
  AuthUser,
  HttpMethod,
  MatchMode,
  Page,
  RoleSummary,
  RouteRule,
  UserListFilters,
  UserListItem,
} from '@dt/contracts'

import { request, requestData } from './client'

// ⚠ 用 type 而不是 interface：interface 没有隐式索引签名，
// 传给 `request` 的 `query`（Record<...>）会被类型检查拒掉。
export type PageQuery = {
  page?: number | undefined
  size?: number | undefined
  sort?: string | undefined
}

/* ---------------- 用户 ---------------- */

/**
 * ⚠ 出参是 `UserListItem` 不是 `AuthUser`：列表不返回权限码数组，只给直权条数。
 * 需要完整权限码的地方（写直权的表单）必须再拉一次 `getUser`。
 */
export async function listUsers(
  filters: UserListFilters & PageQuery,
): Promise<Page<UserListItem>> {
  return await requestData<Page<UserListItem>>('/users', { query: filters })
}

export async function getUser(userId: string): Promise<AuthUser> {
  return await requestData<AuthUser>(`/users/${userId}`)
}

export interface UserCreateInput {
  username: string
  email: string
  password: string
  role_id: string
  full_name?: string | undefined
  phone?: string | undefined
  is_active?: boolean | undefined
}

export async function createUser(input: UserCreateInput): Promise<AuthUser> {
  return await requestData<AuthUser>('/users', {
    method: 'POST',
    body: input,
  })
}

export interface UserUpdateInput {
  email?: string | undefined
  full_name?: string | undefined
  phone?: string | undefined
}

export async function updateUser(
  userId: string,
  input: UserUpdateInput,
): Promise<AuthUser> {
  return await requestData<AuthUser>(`/users/${userId}`, {
    method: 'PATCH',
    body: input,
  })
}

export async function deleteUser(userId: string): Promise<void> {
  await request<null>(`/users/${userId}`, { method: 'DELETE' })
}

/** 启停账号。动作端点用 `:verb`，与后端口径一致。 */
export async function setUserActive(
  userId: string,
  isActive: boolean,
): Promise<AuthUser> {
  const verb = isActive ? 'activate' : 'deactivate'
  return await requestData<AuthUser>(`/users/${userId}:${verb}`, {
    method: 'POST',
  })
}

export async function resetUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  await request<null>(`/users/${userId}:reset-password`, {
    method: 'POST',
    body: { new_password: newPassword },
  })
}

/** 改派角色。提权入口，后端受四条授权不变式约束。 */
export async function assignRole(
  userId: string,
  roleId: string,
): Promise<AuthUser> {
  return await requestData<AuthUser>(`/users/${userId}:assign-role`, {
    method: 'POST',
    body: { role_id: roleId },
  })
}

/** 覆盖式写直权：给什么就是什么，不做增量合并。 */
export async function setDirectPermissions(
  userId: string,
  codes: string[],
): Promise<AuthUser> {
  return await requestData<AuthUser>(`/users/${userId}/permissions`, {
    method: 'PUT',
    body: { codes },
  })
}

/* ---------------- 角色 ---------------- */

export async function listRoles(
  query: PageQuery & { q?: string | undefined } = {},
): Promise<Page<RoleSummary>> {
  return await requestData<Page<RoleSummary>>('/roles', { query })
}

export async function createRole(input: {
  name: string
  description?: string | undefined
  codes: string[]
}): Promise<RoleSummary> {
  return await requestData<RoleSummary>('/roles', {
    method: 'POST',
    body: input,
  })
}

export async function updateRole(
  roleId: string,
  input: { name?: string | undefined; description?: string | undefined },
): Promise<RoleSummary> {
  return await requestData<RoleSummary>(`/roles/${roleId}`, {
    method: 'PATCH',
    body: input,
  })
}

export async function setRolePermissions(
  roleId: string,
  codes: string[],
): Promise<RoleSummary> {
  return await requestData<RoleSummary>(`/roles/${roleId}/permissions`, {
    method: 'PUT',
    body: { codes },
  })
}

export async function deleteRole(roleId: string): Promise<void> {
  await request<null>(`/roles/${roleId}`, { method: 'DELETE' })
}

/* ---------------- 路由规则 ---------------- */

export interface RouteRuleInput {
  path_pattern: string
  http_method: HttpMethod
  permission_codes: string[]
  match_mode: MatchMode
  priority: number
  is_enabled: boolean
  description?: string | undefined
}

export async function listRouteRules(
  query: PageQuery & {
    q?: string | undefined
    is_enabled?: boolean | undefined
  } = {},
): Promise<Page<RouteRule>> {
  return await requestData<Page<RouteRule>>('/route-rules', { query })
}

export async function createRouteRule(
  input: RouteRuleInput,
): Promise<RouteRule> {
  return await requestData<RouteRule>('/route-rules', {
    method: 'POST',
    body: input,
  })
}

export async function updateRouteRule(
  ruleId: string,
  input: Partial<RouteRuleInput>,
): Promise<RouteRule> {
  return await requestData<RouteRule>(`/route-rules/${ruleId}`, {
    method: 'PATCH',
    body: input,
  })
}

export async function deleteRouteRule(ruleId: string): Promise<void> {
  await request<null>(`/route-rules/${ruleId}`, { method: 'DELETE' })
}
