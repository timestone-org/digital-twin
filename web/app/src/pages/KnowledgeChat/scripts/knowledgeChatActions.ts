/**
 * @fileoverview 知识库对话页的动作：列、建、选、改名、归档、删、发一句。
 */
import {
  archiveSession,
  createSession,
  deleteSession,
  listSessions,
  renameSession,
} from '@/api/knowledgeChat'
import { guarded, replaySelected } from './knowledgeChatState'
import type { KnowledgeChatState } from './knowledgeChatState'

/**
 * 取对话清单。⚠ 不自动选中第一个：用户进来多半是要开新的一问，
 * 自动选中上一次的会让他对着一段旧对话发新问题。
 * @param state 页面状态
 */
export async function reload(state: KnowledgeChatState): Promise<void> {
  await guarded(state, async () => {
    state.isLoading.value = true
    try {
      state.sessions.value = await listSessions()
    } finally {
      state.isLoading.value = false
    }
  })
}

/**
 * 切到某个对话并回放它的历史。
 * ⚠ 先掐掉正跑着的回合：不掐的话它的步骤会继续写进新对话的时间线。
 * @param state 页面状态
 * @param sessionId 切到哪个；null = 一个都不选
 */
export async function select(
  state: KnowledgeChatState,
  sessionId: string | null,
): Promise<void> {
  state.chat.clear()
  state.selectedId.value = sessionId
  await guarded(state, () => replaySelected(state))
}

/**
 * 新建一个对话并切过去。
 * @param state 页面状态
 */
export async function create(state: KnowledgeChatState): Promise<void> {
  await guarded(state, async () => {
    const made = await createSession()
    state.sessions.value = [made, ...state.sessions.value]
    await select(state, made.id)
  })
}

/**
 * 改标题。
 * @param state 页面状态
 * @param sessionId 哪个
 * @param title 新标题
 */
export async function rename(
  state: KnowledgeChatState,
  sessionId: string,
  title: string,
): Promise<void> {
  await guarded(state, async () => {
    const updated = await renameSession(sessionId, title.trim())
    state.sessions.value = state.sessions.value.map((one) =>
      one.id === sessionId ? updated : one,
    )
  })
}

/**
 * 归档：从清单里拿掉，历史不删。
 * @param state 页面状态
 * @param sessionId 哪个
 */
export async function archive(
  state: KnowledgeChatState,
  sessionId: string,
): Promise<void> {
  await guarded(state, async () => {
    await archiveSession(sessionId)
    await dropFromList(state, sessionId)
  })
}

/**
 * 删对话。
 * @param state 页面状态
 * @param sessionId 哪个
 */
export async function remove(
  state: KnowledgeChatState,
  sessionId: string,
): Promise<void> {
  await guarded(state, async () => {
    await deleteSession(sessionId)
    await dropFromList(state, sessionId)
  })
}

/**
 * 发一句话。⚠ 还没有对话时**先建一个再发**：进来就想问的人不该先找一个
 * 「新建」按钮。
 * @param state 页面状态
 * @param text 说了什么
 */
export async function send(
  state: KnowledgeChatState,
  text: string,
): Promise<void> {
  const wanted = text.trim()
  if (wanted === '') return
  if (state.selectedId.value === null) {
    await create(state)
    if (state.selectedId.value === null) return
  }
  await state.chat.send(wanted)
}

async function dropFromList(
  state: KnowledgeChatState,
  sessionId: string,
): Promise<void> {
  state.sessions.value = state.sessions.value.filter(
    (one) => one.id !== sessionId,
  )
  if (state.selectedId.value === sessionId) await select(state, null)
}
