/**
 * @fileoverview 原生 fetch 封装：注入令牌、解统一信封、401 先刷新再重试一次。
 *
 * ⚠ 信封里的 `code` 与 HTTP 状态码**都要看**：状态码给基础设施（重试、告警、
 * `response.ok`），`code` 给业务分支。前端一律按 `code` 分支，绝不按 message。
 */

import type { ApiEnvelope } from '@dt/contracts'
import { SUCCESS_CODE } from '@dt/contracts'

import { AUTH_BASE_URL, REQUEST_TIMEOUT_MS } from '@/config/app'

/** 业务错误：HTTP 2xx 之外或信封 code 非 0。 */
export class BizError extends Error {
  readonly code: number
  readonly status: number
  readonly traceId: string

  constructor(code: number, message: string, status: number, traceId: string) {
    super(message || `业务错误 code=${code}`)
    this.name = 'BizError'
    this.code = code
    this.status = status
    this.traceId = traceId
  }
}

/** 传输层错误：网络不可达、超时、响应不是 JSON。 */
export class TransportError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'TransportError'
    this.status = status
  }
}

interface ClientHooks {
  getToken: () => string | null
  onRefresh: () => Promise<boolean>
  onUnauthorized: () => void
}

let hooks: ClientHooks = {
  getToken: () => null,
  onRefresh: () => Promise.resolve(false),
  onUnauthorized: () => undefined,
}

/** 注入运行时钩子。auth store 创建时调用一次。 */
export function configureApiClient(next: Partial<ClientHooks>): void {
  hooks = { ...hooks, ...next }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined
  body?: unknown
  query?: Record<string, string | number | boolean | undefined> | undefined
  /**
   * 后端服务前缀，缺省打 auth-server。
   * ⚠ 取值只从 `config/app.ts` 的常量里来，不在调用处拼字符串——前缀是边缘的
   * 路由键，写歪一个字符会被反代兜底成前端静态资源，拿到的是一段 HTML。
   */
  baseUrl?: string | undefined
  /** 跳过令牌注入与 401 重试（登录、刷新自己走这条）。 */
  anonymous?: boolean | undefined
  signal?: AbortSignal | undefined
}

function buildUrl(path: string, options: RequestOptions): string {
  const { query } = options
  const url = `${options.baseUrl ?? AUTH_BASE_URL}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const search = params.toString()
  return search ? `${url}?${search}` : url
}

/**
 * 校验响应体确实是统一信封。
 * ⚠ 不用 `as` 断言：反代挂了会返回一段 HTML 或别的形状的 JSON，断言会让它
 * 一路流进业务层，最后崩在某个深层组件里，而不是在这里报「格式异常」。
 * @param body 已解析的 JSON
 */
function isEnvelope(body: unknown): body is ApiEnvelope<unknown> {
  if (typeof body !== 'object' || body === null) return false
  const shape: Record<string, unknown> = { ...body }
  return (
    typeof shape.code === 'number' &&
    typeof shape.message === 'string' &&
    typeof shape.trace_id === 'string'
  )
}

async function readEnvelope<T>(
  response: Response,
): Promise<ApiEnvelope<T> | null> {
  if (response.status === 204) return null
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new TransportError(response.status, '服务端响应格式异常')
  }
  if (!isEnvelope(body)) {
    throw new TransportError(response.status, '服务端响应格式异常')
  }
  // 全仓唯一一处对后端数据的断言：形状由 openapi 契约测试锁，见
  // app/tests/contract/openapi-shapes.contract.spec.ts。调用侧一律不许再断言。
  return { ...body, data: body.data as T }
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (!options.anonymous) {
    const token = hooks.getToken()
    if (token !== null) headers.Authorization = `Bearer ${token}`
  }
  // ⚠ 每个跨进程调用都要有超时：没有超时的请求会在下游卡住时永远挂着
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout
  try {
    return await fetch(buildUrl(path, options), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new TransportError(0, '请求超时，请稍后重试')
    }
    throw new TransportError(0, '无法连接服务器，请检查网络')
  }
}

async function unwrap<T>(response: Response): Promise<T | null> {
  const envelope = await readEnvelope<T>(response)
  if (envelope === null) return null
  if (!response.ok || envelope.code !== SUCCESS_CODE) {
    throw new BizError(
      envelope.code,
      envelope.message,
      response.status,
      envelope.trace_id,
    )
  }
  return envelope.data
}

/**
 * 发一个请求并解包。
 * ⚠ 401 时先尝试刷新令牌再重试一次；刷新也失败才交给 onUnauthorized——
 * 会话过期与网络抖动必须区分，否则抖一下就把人踢下线。
 * @param path 相对 auth 前缀的路径
 * @param options 方法、请求体、query、是否匿名
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T | null> {
  const first = await send(path, options)
  if (first.status !== 401 || options.anonymous) {
    return unwrap<T>(first)
  }
  const refreshed = await hooks.onRefresh()
  if (!refreshed) {
    hooks.onUnauthorized()
    return unwrap<T>(first)
  }
  return unwrap<T>(await send(path, options))
}

/**
 * 发一个**必须带 data** 的请求。
 * ⚠ 用它而不是 `(await request(...)) as T`：断言会把 204 或空 data 当成对象放行，
 * 真正的崩溃点跑到几层之外的渲染里，看不出是接口没给数据。
 * @param path 相对 auth 前缀的路径
 * @param options 方法、请求体、query、是否匿名
 */
export async function requestData<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const data = await request<T>(path, options)
  if (data === null) {
    throw new TransportError(0, '服务端未返回数据')
  }
  return data
}
