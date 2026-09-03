/**
 * @fileoverview 知识库对话的接口封装：会话的列建看改删，与推进一个回合的事件流。
 *
 * ⚠ 这一组打的是 knowledge-server，每个请求都要给 `baseUrl`：漏了会静默打到
 * auth 前缀上，拿回来的是一个 403 的 HTML 页。
 * ⚠ 出参直接用 `@dt/contracts` 的类型，形状由 `knowledge-shapes` 契约钉在
 * openapi.json 上——与助手那组同一口径，不再手写一层窄化。
 */
import type {
  KnowledgeChatAdvanceIn,
  KnowledgeChatSession,
  KnowledgeChatSessionDetail,
  KnowledgeChatSessionPatch,
} from '@dt/contracts'

import { KNOWLEDGE_BASE_URL } from '@/config/app'
import { openStream, request, requestData } from './client'
import type { RequestOptions } from './client'

const SESSIONS = '/chat-sessions'

function onKnowledge(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: KNOWLEDGE_BASE_URL }
}

interface PageOf<T> {
  items: T[]
}

/** 列对话。缺省只列没归档的。 */
export async function listSessions(
  isArchived = false,
): Promise<KnowledgeChatSession[]> {
  const page = await requestData<PageOf<KnowledgeChatSession>>(
    SESSIONS,
    onKnowledge({
      query: { page: 1, size: 100, is_archived: String(isArchived) },
    }),
  )
  return page.items
}

/**
 * 新建对话。
 * @param title 标题；摘不出时留空
 * @param baseScopeIds 检索范围；null = 全部知识库（缺省）。⚠ 空数组后端拒收
 */
export async function createSession(
  title = '',
  baseScopeIds: string[] | null = null,
): Promise<KnowledgeChatSession> {
  const body: KnowledgeChatSessionPatch = { title }
  if (baseScopeIds !== null) body.base_scope_ids = baseScopeIds
  return requestData<KnowledgeChatSession>(
    SESSIONS,
    onKnowledge({ method: 'POST', body }),
  )
}

/** 对话详情，连着全部消息与步骤。 */
export async function readSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<KnowledgeChatSessionDetail> {
  return requestData<KnowledgeChatSessionDetail>(
    `${SESSIONS}/${sessionId}`,
    onKnowledge({ signal }),
  )
}

/** 改标题。 */
export async function renameSession(
  sessionId: string,
  title: string,
): Promise<KnowledgeChatSession> {
  return requestData<KnowledgeChatSession>(
    `${SESSIONS}/${sessionId}`,
    onKnowledge({ method: 'PATCH', body: { title } }),
  )
}

/**
 * 改这个对话的检索范围。
 * ⚠ `null` 是「全部知识库」，与空数组不是一回事——后者后端当场 400。
 * ⚠ 一律带 `expected_version`：不带就是无条件覆盖，另一个标签页刚改过的范围
 * 会被悄悄顶掉，而两边都看不出来。冲突时后端回 409。
 * @param sessionId 哪个对话
 * @param baseScopeIds 范围；null = 全部
 * @param expectedVersion 手上那份的行版本
 */
export async function setSessionScope(
  sessionId: string,
  baseScopeIds: string[] | null,
  expectedVersion: number,
): Promise<KnowledgeChatSession> {
  return requestData<KnowledgeChatSession>(
    `${SESSIONS}/${sessionId}`,
    onKnowledge({
      method: 'PATCH',
      body: {
        base_scope_ids: baseScopeIds,
        expected_version: expectedVersion,
      } satisfies KnowledgeChatSessionPatch,
    }),
  )
}

/** 归档：不再默认列出，历史一条都不删。 */
export async function archiveSession(
  sessionId: string,
): Promise<KnowledgeChatSession> {
  return requestData<KnowledgeChatSession>(
    `${SESSIONS}/${sessionId}`,
    onKnowledge({ method: 'PATCH', body: { is_archived: true } }),
  )
}

/**
 * 删对话。消息与步骤跟着走。
 * ⚠ 走 `request` 不走 `requestData`：204 没有响应体，后者见 null 就抛。
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await request<unknown>(
    `${SESSIONS}/${sessionId}`,
    onKnowledge({ method: 'DELETE' }),
  )
}

/**
 * 推进一个回合，把事件流逐块交出来。
 * ⚠ 调用方**必须在卸载时 abort**：不 abort 的话组件没了而读取还在。
 */
export function advanceTurn(
  sessionId: string,
  body: KnowledgeChatAdvanceIn,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  return openStream(`${SESSIONS}/${sessionId}:advance`, {
    baseUrl: KNOWLEDGE_BASE_URL,
    body,
    signal,
  })
}
