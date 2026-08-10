/**
 * @fileoverview auth-server 的接口封装。组件不直接发请求，一律经这里与 store。
 */

import type {
  AuthUser,
  PermissionCatalog,
  SessionResult,
  TokenPair,
} from '@dt/contracts'

import { request, requestData } from './client'

/** 登录并创建会话。匿名请求：此时还没有令牌。 */
export async function createSession(
  username: string,
  password: string,
): Promise<SessionResult> {
  return await requestData<SessionResult>('/sessions', {
    method: 'POST',
    body: { username, password },
    anonymous: true,
  })
}

/** 用刷新令牌换一对新令牌。⚠ 必须匿名发，否则 401 会递归触发刷新。 */
export async function refreshSession(
  refreshToken: string,
): Promise<SessionResult> {
  return await requestData<SessionResult>('/sessions:refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    anonymous: true,
  })
}

/** 登出：吊销刷新令牌。重复调用无副作用。 */
export async function revokeSession(refreshToken: string): Promise<void> {
  await request<null>('/sessions:revoke', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    anonymous: true,
  })
}

/** 当前用户（含权限码）。 */
export async function fetchMe(): Promise<AuthUser> {
  return await requestData<AuthUser>('/users/me')
}

/** 改自己的资料。 */
export async function updateMe(
  changes: Partial<Pick<AuthUser, 'email' | 'full_name' | 'phone'>>,
): Promise<AuthUser> {
  return await requestData<AuthUser>('/users/me', {
    method: 'PATCH',
    body: changes,
  })
}

/** 改自己的密码。 */
export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request<null>('/users/me:change-password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  })
}

/** 权限目录（只读）。 */
export async function fetchPermissionCatalog(): Promise<PermissionCatalog> {
  return await requestData<PermissionCatalog>('/permissions')
}

export type { AuthUser, SessionResult, TokenPair }
