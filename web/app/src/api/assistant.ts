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
  AssistantCredentialStatus,
  AssistantDeviceLoginPoll,
  AssistantDeviceLoginStart,
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

/**
 * 改会话：标题、归档，或换一路模型。
 * ⚠ 换模型落在**会话**上而不是每次推进带：工具回填那几次是循环自己发的，
 * 那时界面手上没有用户的选择。
 * @param sessionId 会话 id
 * @param patch 只带要改的那几格
 */
export async function patchSession(
  sessionId: string,
  patch: {
    title?: string
    is_archived?: boolean
    model_profile?: string
    reasoning_effort?: string
  },
): Promise<AssistantSession | null> {
  return request<AssistantSession>(
    `/sessions/${sessionId}`,
    onAssistant({ method: 'PATCH', body: patch }),
  )
}

/** 读一路模型账号的登录态。⚠ 回来的东西里没有令牌，也永远不该有。 */
export async function readCredential(
  provider: string,
  signal?: AbortSignal,
): Promise<AssistantCredentialStatus | null> {
  return request<AssistantCredentialStatus>(
    `/credentials/${provider}`,
    onAssistant({ signal }),
  )
}

/** 开一次设备码登录：拿用户码与验证地址。 */
export async function startDeviceLogin(
  provider: string,
  key: string = newIdempotencyKey(),
): Promise<AssistantDeviceLoginStart> {
  return requestData<AssistantDeviceLoginStart>(
    `/credentials/${provider}:start-login`,
    onAssistant({ method: 'POST', headers: { 'Idempotency-Key': key } }),
  )
}

/**
 * 问一次「用户点完了没」。
 * ⚠ 下一次要隔多久由**返回值**说了算：上游让慢下来时它会变大，照原间隔接着
 * 打的话，被限流的是整台机器而不只是这一次登录。
 * @param provider 哪一路
 * @param ref 这次登录的句柄
 * @param signal 中止信号
 */
export async function pollDeviceLogin(
  provider: string,
  ref: string,
  signal?: AbortSignal,
): Promise<AssistantDeviceLoginPoll> {
  return requestData<AssistantDeviceLoginPoll>(
    `/credentials/${provider}:poll-login`,
    onAssistant({ method: 'POST', body: { ref }, signal }),
  )
}

/** 退出模型账号。⚠ 整套部署共用一份，退的是所有人的。 */
export async function forgetCredential(provider: string): Promise<void> {
  await request<null>(
    `/credentials/${provider}`,
    onAssistant({ method: 'DELETE' }),
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
  /**
   * 这一屏此刻的摘要，进提示词。
   * ⚠ **每次推进都带**：提示词一轮一拼，只在用户发话那次带的话，助手动了
   * 两下之后读到的是一屏过期的画布。
   */
  surface_context?: Record<string, unknown>
  /**
   * 这一页实现了哪些客户端工具，每轮自报；没实现的模型看不见。
   * ⚠ 空数组与不带是两回事：空数组 = 这一页明说一个客户端工具都没有。
   */
  client_tools?: string[]
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
