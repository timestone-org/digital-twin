/**
 * @fileoverview AI 助手的接口封装。组件不直接发请求，一律经这里。
 *
 * ⚠ 这一组打的是 ai-assistant，每个请求都要给 `baseUrl`：漏了会静默打到
 * auth-server 上，现象是「助手永远说不出话」而不是一个报错。
 * ⚠ 能力探测**取不到就当作助手不存在**，不是「暂时故障」：某些现场根本不部署
 * 这套服务，那时边缘直接 502，入口就该干净地不出现。
 */
import type {
  AssistantCapability,
  AssistantParsedTable,
  AssistantSession,
  AssistantSessionDetail,
  AssistantSurfaceKind,
  Page,
} from '@dt/contracts'

import { ASSISTANT_BASE_URL } from '@/config/app'
import { openStream, request, requestData, type RequestOptions } from './client'
import { newIdempotencyKey } from './idempotency'

function onAssistant(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: ASSISTANT_BASE_URL }
}

/**
 * 探一次助手能力。
 * ⚠ 任何失败都收成 `null` 交出去：调用方据此决定摆不摆入口，而「服务没部署」
 * 与「服务坏了」在界面上是同一件事——都该是安静地没有助手。
 */
export async function probeCapability(): Promise<AssistantCapability | null> {
  try {
    return await requestData<AssistantCapability>(
      '/capabilities',
      onAssistant(),
    )
  } catch {
    return null
  }
}

/** 列出自己的会话。 */
export async function listSessions(
  surfaceKind: AssistantSurfaceKind,
  signal?: AbortSignal,
): Promise<Page<AssistantSession> | null> {
  return request<Page<AssistantSession>>(
    '/sessions',
    onAssistant({ query: { surface_kind: surfaceKind }, signal }),
  )
}

/** 建一个会话。 */
export async function createSession(
  surfaceKind: AssistantSurfaceKind,
  surfaceRef: string | null,
  key: string = newIdempotencyKey(),
): Promise<AssistantSession> {
  return requestData<AssistantSession>(
    '/sessions',
    onAssistant({
      method: 'POST',
      body: { surface_kind: surfaceKind, surface_ref: surfaceRef },
      headers: { 'Idempotency-Key': key },
    }),
  )
}

/** 读一个会话，含全部消息与步骤。 */
export async function readSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<AssistantSessionDetail | null> {
  return request<AssistantSessionDetail>(
    `/sessions/${sessionId}`,
    onAssistant({ signal }),
  )
}

/** 归档一个会话。 */
export async function archiveSession(
  sessionId: string,
): Promise<AssistantSession | null> {
  return request<AssistantSession>(
    `/sessions/${sessionId}`,
    onAssistant({ method: 'PATCH', body: { is_archived: true } }),
  )
}

/** 一次推进要交上去的东西。发话与工具回填**二选一**。 */
export interface AdvanceBody {
  surface_kind: AssistantSurfaceKind
  surface_label?: string
  user_text?: string
  tool_results?: {
    call_id: string
    output?: unknown
    error?: string | null
  }[]
}

/**
 * 推进一个回合，把事件流逐块交出来。
 * ⚠ 调用方**必须在卸载时 abort**：不 abort 的话组件没了而读取还在，
 * 一路写进已经销毁的状态；服务端那边的回合也会一直跑到自己结束。
 * @param sessionId 会话 id
 * @param body 发话或工具回填
 * @param signal 中止信号
 */
export function advanceTurn(
  sessionId: string,
  body: AdvanceBody,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  return openStream(`/sessions/${sessionId}:advance`, {
    baseUrl: ASSISTANT_BASE_URL,
    body,
    signal,
  })
}

/**
 * 把一张点表交给服务端解析。
 * ⚠ 内容走 base64 放在 JSON 里，不用 multipart——本仓一个 multipart 端点都没有
 * （素材的字节是直传对象存储的），引一个解析库就是为一个端点多一个依赖。
 * @param filename 原文件名，服务端按后缀选解析方式
 * @param contentBase64 文件内容
 */
export async function parseAttachment(
  filename: string,
  contentBase64: string,
): Promise<AssistantParsedTable> {
  return requestData<AssistantParsedTable>(
    '/attachments:parse',
    onAssistant({
      method: 'POST',
      body: { filename, content_base64: contentBase64 },
    }),
  )
}
