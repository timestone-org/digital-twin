/**
 * @fileoverview 把 `@dt/contracts` 的出参类型钉在 auth-server 的 openapi.json 上。
 *
 * ⚠ 这条闸是补出来的：`UserListItem` 原本被写成了 `AuthUser`，于是页面对着列表项
 * 读 `direct_permissions.length`，运行时取到 undefined，**整页崩在渲染里**，
 * 而 typecheck、lint、单测全绿——手写的类型比真接口宽松，编译器无从发现。
 *
 * 做法：每个类型用 `Record<keyof T, true>` 在**类型层**枚举一遍键（漏一个或多一个
 * 都过不了 typecheck），再把这份键集和 openapi 的 properties 比对。两头都锁住，
 * 中间就不会漂。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ApiEnvelope,
  ApiKey,
  ApiKeySecret,
  AuthUser,
  FieldError,
  Page,
  PermissionCatalog,
  PermissionGroup,
  PermissionItem,
  RoleRef,
  RoleSummary,
  RouteRule,
  SessionResult,
  TokenPair,
  UserListItem,
} from '@dt/contracts'

interface OpenApiSchema {
  properties?: Record<string, unknown>
}

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SPEC_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'auth-server',
  'openapi.json',
)

const schemas = (
  JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
    components: { schemas: Record<string, OpenApiSchema> }
  }
).components.schemas

/** 键集的类型层枚举。少写一个键、或写了接口上没有的键，vue-tsc 直接红。 */
type Keys<T> = Record<keyof T, true>

const SHAPES: Record<string, Record<string, true>> = {
  UserListItemOut: {
    id: true,
    username: true,
    email: true,
    full_name: true,
    avatar_url: true,
    phone: true,
    is_active: true,
    last_login_at: true,
    created_at: true,
    updated_at: true,
    role: true,
    direct_permission_count: true,
  } satisfies Keys<UserListItem>,

  UserDetailOut: {
    id: true,
    username: true,
    email: true,
    full_name: true,
    avatar_url: true,
    phone: true,
    is_active: true,
    last_login_at: true,
    created_at: true,
    updated_at: true,
    role: true,
    role_permissions: true,
    direct_permissions: true,
    permissions: true,
  } satisfies Keys<AuthUser>,

  RoleRef: {
    id: true,
    name: true,
    description: true,
    is_builtin: true,
  } satisfies Keys<RoleRef>,

  RoleOut: {
    id: true,
    name: true,
    description: true,
    is_builtin: true,
    created_at: true,
    updated_at: true,
    permissions: true,
    user_count: true,
  } satisfies Keys<RoleSummary>,

  RouteRuleOut: {
    id: true,
    path_pattern: true,
    http_method: true,
    permission_codes: true,
    match_mode: true,
    priority: true,
    is_enabled: true,
    is_builtin: true,
    description: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<RouteRule>,

  PermissionOut: {
    id: true,
    code: true,
    name: true,
    description: true,
    group_code: true,
    group_label: true,
    sort_order: true,
    kind: true,
    is_builtin: true,
  } satisfies Keys<PermissionItem>,

  PermissionGroupOut: {
    code: true,
    label: true,
    items: true,
  } satisfies Keys<PermissionGroup>,

  PermissionCatalogOut: {
    items: true,
    groups: true,
  } satisfies Keys<PermissionCatalog>,

  TokenPairOut: {
    access_token: true,
    refresh_token: true,
    token_type: true,
    expires_in_s: true,
  } satisfies Keys<TokenPair>,

  SessionOut: {
    token: true,
    user: true,
  } satisfies Keys<SessionResult>,

  FieldErrorOut: {
    field: true,
    code: true,
    message: true,
  } satisfies Keys<FieldError>,

  ApiKeyOut: {
    id: true,
    user_id: true,
    name: true,
    prefix: true,
    is_active: true,
    expires_at: true,
    last_used_at: true,
    revoked_at: true,
    created_at: true,
  } satisfies Keys<ApiKey>,

  ApiKeySecretOut: {
    api_key: true,
    secret: true,
  } satisfies Keys<ApiKeySecret>,

  Page_UserListItemOut_: {
    items: true,
    page: true,
    size: true,
    total: true,
  } satisfies Keys<Page<UserListItem>>,

  ApiResponse_UserDetailOut_: {
    code: true,
    message: true,
    data: true,
    trace_id: true,
    details: true,
  } satisfies Keys<Required<ApiEnvelope<AuthUser>>>,
}

describe('@dt/contracts 与 openapi.json 的字段一致', () => {
  it.each(Object.keys(SHAPES))('%s', (schemaName) => {
    const schema = schemas[schemaName]
    expect(schema, `openapi.json 里没有 ${schemaName}`).toBeDefined()
    const actual = Object.keys(schema?.properties ?? {}).sort()
    const declared = Object.keys(SHAPES[schemaName] ?? {}).sort()
    expect(actual).toEqual(declared)
  })

  it('密钥的读面永远没有明文——只有签发回执带 secret', () => {
    const readKeys = Object.keys(schemas.ApiKeyOut?.properties ?? {})
    expect(readKeys).not.toContain('secret')
    expect(readKeys).not.toContain('hashed_secret')
    expect(Object.keys(schemas.ApiKeySecretOut?.properties ?? {})).toContain(
      'secret',
    )
  })

  it('列表项与详情不是同一个形状——混用会在运行时取到 undefined', () => {
    const listKeys = Object.keys(schemas.UserListItemOut?.properties ?? {})
    expect(listKeys).not.toContain('direct_permissions')
    expect(listKeys).not.toContain('permissions')
    expect(listKeys).toContain('direct_permission_count')
  })
})
