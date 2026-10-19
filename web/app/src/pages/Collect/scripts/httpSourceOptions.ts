/** @fileoverview HTTP 请求配置与认证选项的表单边界校验。 */
import type { DtSelectOption } from '@dt/contracts'

export const HTTP_AUTH_OPTIONS: readonly DtSelectOption[] = [
  { value: 'none', label: '无认证' },
  { value: 'basic', label: 'Basic 用户名 / 密码' },
  { value: 'digest', label: 'Digest 用户名 / 密码' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'api_key', label: 'API Key（请求头）' },
  { value: 'oauth2_client_credentials', label: 'OAuth 2.0 Client Credentials' },
]
export const HTTP_METHOD_OPTIONS: readonly DtSelectOption[] = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST（查询接口）' },
]
const HEADER_NAME = /^[!#$%&'*+.^_`|~A-Za-z0-9-]+$/
const SENSITIVE_NAMES = new Set(
  [
    'authorization',
    'proxy_authorization',
    'cookie',
    'set_cookie',
    'password',
    'passwd',
    'secret',
    'client_secret',
    'access_token',
    'refresh_token',
    'token',
    'api_key',
    'apikey',
    'x_api_key',
    'key',
  ].map((name) => name.replace(/[^a-z0-9]/g, '')),
)
const MAX_CONFIG_BYTES = 65_536

function isSensitiveName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return (
    SENSITIVE_NAMES.has(normalized) ||
    ['token', 'password', 'secret', 'apikey'].some((suffix) =>
      normalized.endsWith(suffix),
    )
  )
}

function validateMapEntry(
  key: string,
  item: unknown,
  isHeaders: boolean,
): string | null {
  if (!key || typeof item !== 'string') return '名称不能为空，取值必须是字符串'
  if (isSensitiveName(key))
    return '认证信息不可放在普通请求参数中，请使用认证配置'
  if (!isHeaders) return null
  if (!HEADER_NAME.test(key) || /[^\x20-\x7e]/.test(item))
    return '请求头名称或取值格式不合法'
  if (
    ['host', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())
  )
    return '请求头不可覆盖路由或报文长度'
  return null
}

export function defaultHttpOptions(): Record<string, string> {
  return {
    method: 'GET',
    auth_type: 'none',
    timeout_s: '5',
    max_response_bytes: '1048576',
    headers_json: '{}',
    query_json: '{}',
  }
}

function validateStringMap(
  value: string,
  label: string,
  isHeaders: boolean,
): string | null {
  if (value.trim() === '') return null
  if (new TextEncoder().encode(value).length > MAX_CONFIG_BYTES)
    return `${label}不能超过 64 KiB`
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return `${label}应是 JSON 字符串映射，例如 {"name":"value"}`
    const entries = Object.entries(parsed)
    if (entries.length > 64) return `${label}最多 64 个字段`
    if (hasDuplicatedHeaders(entries, isHeaders)) return '请求头名称不能重复'
    return (
      entries
        .map(([key, item]) => validateMapEntry(key, item, isHeaders))
        .find((problem) => problem !== null) ?? null
    )
  } catch {
    return `${label}不是有效 JSON`
  }
  return null
}

function validateBounds(options: Record<string, string>): string | null {
  const timeout = Number(options['timeout_s'] ?? '5')
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 10)
    return 'HTTP 超时应大于 0 且不超过 10 秒'
  const bytes = Number(options['max_response_bytes'] ?? '1048576')
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 4_194_304)
    return 'HTTP 响应上限应为 1 到 4194304 字节的整数'
  return null
}

function hasDuplicatedHeaders(
  entries: readonly [string, unknown][],
  isHeaders: boolean,
): boolean {
  return (
    isHeaders &&
    new Set(entries.map(([key]) => key.toLowerCase())).size !== entries.length
  )
}

function validateBody(options: Record<string, string>): string | null {
  const body = options['body_json'] ?? ''
  if (body.trim() === '') return null
  if ((options['method'] ?? 'GET') !== 'POST')
    return '只有 POST 查询可以配置 JSON 请求体'
  if (new TextEncoder().encode(body).length > MAX_CONFIG_BYTES)
    return '请求体不能超过 64 KiB'
  try {
    const parsed: unknown = JSON.parse(body)
    return validatePublicJson(parsed)
  } catch {
    return '请求体不是有效 JSON'
  }
}

function isNonFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && !Number.isFinite(value)
}

function validatePublicJson(value: unknown, depth = 0): string | null {
  if (depth > 64) return '请求体 JSON 不能超过 64 层'
  if (isNonFiniteNumber(value)) return '请求体 JSON 数值必须是有限数值'
  if (Array.isArray(value))
    return (
      value
        .map((child: unknown) => validatePublicJson(child, depth + 1))
        .find((problem) => problem !== null) ?? null
    )
  if (typeof value !== 'object' || value === null) return null
  if (Object.keys(value).some(isSensitiveName))
    return '请求体不可包含认证秘密，请使用认证配置'
  return (
    Object.values(value)
      .map((child: unknown) => validatePublicJson(child, depth + 1))
      .find((problem) => problem !== null) ?? null
  )
}

function validateHeaders(options: Record<string, string>): string | null {
  const raw = options['headers_json'] ?? ''
  const error = validateStringMap(raw, '请求头', true)
  if (error !== null) return error
  if (options['auth_type'] !== 'api_key' || raw.trim() === '') return null
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) return null
  const authHeader = (options['auth_header'] ?? 'X-API-Key').toLowerCase()
  return Object.keys(parsed).some((name) => name.toLowerCase() === authHeader)
    ? 'API Key 请求头应只在认证配置中设置，不能与普通请求头重复'
    : null
}

function validateAuthAccount(auth: string, username: string): string | null {
  if (
    !['basic', 'digest', 'oauth2_client_credentials'].includes(auth) ||
    username.trim() !== ''
  )
    return null
  return auth === 'oauth2_client_credentials'
    ? '请填写 OAuth Client ID'
    : '请填写认证用户名'
}

function validateAuthHeader(options: Record<string, string>): string | null {
  const name = options['auth_header'] ?? 'X-API-Key'
  if (!HEADER_NAME.test(name) || name.length > 128)
    return 'API Key 请求头名称不合法'
  if (
    [
      'host',
      'cookie',
      'set-cookie',
      'proxy-authorization',
      'content-length',
      'transfer-encoding',
    ].includes(name.toLowerCase())
  )
    return 'API Key 不可使用此请求头名称'
  return null
}

export function validateHttpEndpoint(endpoint: URL): string | null {
  if ([...endpoint.searchParams.keys()].some(isSensitiveName))
    return 'HTTP 接口地址不可包含认证秘密，请使用认证配置'
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    !endpoint.hostname ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.port === '0'
  )
    return '请填写无账户、口令和片段的 HTTP / HTTPS 接口地址'
  return null
}

function validateOAuthEndpoint(options: Record<string, string>): string | null {
  try {
    return validateHttpEndpoint(new URL(options['token_endpoint'] ?? ''))
  } catch {
    return '请填写有效的 OAuth Token URL'
  }
}

export function validateHttpOptions(
  options: Record<string, string>,
): string | null {
  if (
    !HTTP_METHOD_OPTIONS.some(
      (item) => item.value === (options['method'] ?? 'GET'),
    )
  )
    return 'HTTP 仅支持 GET 或 POST 查询接口'
  if (
    !HTTP_AUTH_OPTIONS.some(
      (item) => item.value === (options['auth_type'] ?? 'none'),
    )
  )
    return '请选择支持的 HTTP 认证方式'
  return (
    validateBounds(options) ??
    validateHeaders(options) ??
    validateStringMap(options['query_json'] ?? '', '查询参数', false) ??
    validateBody(options)
  )
}

export function validateHttpAuth(
  options: Record<string, string>,
  username: string,
  hasCredential: boolean,
): string | null {
  const auth = options['auth_type'] ?? 'none'
  if (auth === 'none') return null
  if (!hasCredential) return '请填写认证凭据'
  return (
    validateAuthAccount(auth, username) ??
    validateAuthHeader(options) ??
    (auth === 'oauth2_client_credentials'
      ? validateOAuthEndpoint(options)
      : null)
  )
}
