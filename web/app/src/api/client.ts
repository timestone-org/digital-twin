/**
 * @fileoverview 原生 fetch 封装：注入令牌、解统一信封、401 先刷新再重试一次。
 *
 * ⚠ 信封里的 `code` 与 HTTP 状态码**都要看**：状态码给基础设施（重试、告警、
 * `response.ok`），`code` 给业务分支。前端一律按 `code` 分支，绝不按 message。
 */

import type { ApiEnvelope, FieldError } from '@dt/contracts'
import { SUCCESS_CODE } from '@dt/contracts'

import { AUTH_BASE_URL, REQUEST_TIMEOUT_MS } from '@/config/app'

/** 业务错误：HTTP 2xx 之外或信封 code 非 0。 */
export class BizError extends Error {
  readonly code: number
  readonly status: number
  readonly traceId: string
  /**
   * 信封里的字段级说明。
   * ⚠ 有几条拒绝的**具体内容只在这里**：删列被公式引用时，后端把引用它的
   * 那几列逐条摊在 `details` 里，`message` 只说得出一个条数。丢掉它，二次
   * 确认就只能问「仍然删吗」，答不出「会坏掉哪几条公式」。
   */
  readonly details: readonly FieldError[]

  constructor(
    code: number,
    message: string,
    status: number,
    traceId: string,
    details: readonly FieldError[] = [],
  ) {
    super(message || `业务错误 code=${code}`)
    this.name = 'BizError'
    this.code = code
    this.status = status
    this.traceId = traceId
    this.details = details
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
  /** 附加请求头，如 `Idempotency-Key`。不许在这里塞 Authorization。 */
  headers?: Record<string, string> | undefined
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
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  }
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

/**
 * 取信封里的字段级说明。
 * ⚠ 逐条筛形状而不是整块透传：`isEnvelope` 只认得 code / message / trace_id
 * 三个键，`details` 是什么样它一概不知。原样交出去，某个缺字段的条目会崩在
 * 二次确认的文案拼接里，而那里离真正的原因已经很远。
 * @param body 已确认是信封的响应体
 */
function readDetails(body: ApiEnvelope<unknown>): FieldError[] {
  const given: unknown = body.details
  if (!Array.isArray(given)) return []
  return given.filter(
    (item): item is FieldError =>
      typeof item === 'object' &&
      item !== null &&
      typeof Reflect.get(item, 'field') === 'string' &&
      typeof Reflect.get(item, 'code') === 'string' &&
      typeof Reflect.get(item, 'message') === 'string',
  )
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
      readDetails(envelope),
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
 * 取一段**字节**而不是信封。
 *
 * ⚠ 有这一条是因为 `<img src>` 带不上 `Authorization`：浏览器给图片请求发不了
 * 自定义头，而知识库的图不匿名可读（走的是同一条要认人的 API 前缀）。直接把
 * 端点地址写进 `src` 的表现是**整张图 401、界面上一个碎图标**，而且不报错。
 * 取回来的 Blob 由调用方转成 object URL，并在卸载时 revoke。
 *
 * ⚠ 401 的重试与 `request` 同一条口径：抖一下不该把人踢下线。
 * @param path 相对前缀的路径
 * @param options 前缀、query、中止信号
 */
export async function requestBytes(
  path: string,
  options: RequestOptions = {},
): Promise<Blob> {
  const first = await send(path, options)
  if (first.status !== 401 || options.anonymous) {
    return unwrapBytes(first)
  }
  const refreshed = await hooks.onRefresh()
  if (!refreshed) {
    hooks.onUnauthorized()
    return unwrapBytes(first)
  }
  return unwrapBytes(await send(path, options))
}

/** 把一个字节响应拆成 Blob；非 2xx 一律抛。 */
async function unwrapBytes(response: Response): Promise<Blob> {
  if (!response.ok) {
    throw new TransportError(response.status, '这张图取不回来')
  }
  return await response.blob()
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

/**
 * 发一个**流式**请求，把响应体逐块交出去。
 *
 * ⚠ 它**不走统一信封**：流一旦开始就没法再改状态码，所以这里只在开流之前判
 * 一次「受不受理」，之后的失败由载荷自己表达（见 ai-assistant 的 `error` 事件）。
 * ⚠ 它**不套 `REQUEST_TIMEOUT_MS`**：那个 20 秒是给一问一答用的，而一次模型
 * 回合可能跑几分钟。这条流的寿命由调用方的 `signal` 决定——**调用方必须在
 * 卸载时 abort**，否则组件没了而读取还在，一路写进已经销毁的状态。
 * @param path 相对前缀的路径
 * @param options 前缀、请求体、中止信号
 */
export async function* openStream(
  path: string,
  options: StreamOptions = {},
): AsyncGenerator<string> {
  const response = await sendStream(path, options)
  if (!response.ok || response.body === null) {
    // ⚠ 状态码要进这句话：它是用户唯一看得见的线索，而这几种失败的处置完全
    // 不同——400 是这次请求本身不合法（重发多少次都一样），502 是服务暂时
    // 不在（过一会儿就好）。只说「打不开」的话，两种都长成「助手坏了」
    throw new TransportError(
      response.status,
      `事件流打不开（HTTP ${response.status}）`,
    )
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value !== undefined) yield value
    }
  } finally {
    // ⚠ 必须取消：不取消的话，调用方 abort 之后底层连接仍挂着，
    // 而服务端那边的回合会一直跑到自己结束
    await reader.cancel().catch(() => undefined)
  }
}

export interface StreamOptions {
  baseUrl?: string | undefined
  body?: unknown
  signal?: AbortSignal | undefined
}

async function sendStream(
  path: string,
  options: StreamOptions,
): Promise<Response> {
  const first = await fetchStream(path, options)
  if (first.status !== 401) return first
  const refreshed = await hooks.onRefresh()
  if (!refreshed) {
    hooks.onUnauthorized()
    return first
  }
  return fetchStream(path, options)
}

async function fetchStream(
  path: string,
  options: StreamOptions,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  }
  const token = hooks.getToken()
  if (token !== null) headers.Authorization = `Bearer ${token}`
  try {
    return await fetch(`${options.baseUrl ?? AUTH_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body ?? {}),
      signal: options.signal ?? null,
    })
  } catch (error) {
    // ⚠ 中止不是故障：调用方卸载时 abort 是常态，把它当网络错会在界面上
    // 弹一条「无法连接服务器」，而其实只是用户关掉了面板
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new TransportError(0, '无法连接服务器，请检查网络')
  }
}
