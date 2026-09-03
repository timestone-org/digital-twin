/**
 * @fileoverview 知识库对话页的动作：列、建、选、改名、归档、删、发一句。
 */
import { KNOWLEDGE_CHAT_CONFLICT_CODE } from '@dt/contracts'

import { BizError } from '@/api/client'
import { listBases, readCapability } from '@/api/knowledge'
import {
  archiveSession,
  createSession,
  deleteSession,
  listSessions,
  renameSession,
  setSessionScope,
} from '@/api/knowledgeChat'
import { guarded, replaySelected } from './knowledgeChatState'
import type { KnowledgeChatState } from './knowledgeChatState'

/**
 * 首屏：对话清单、知识库清单与「接没接语音识别」并行取。
 * @param state 页面状态
 */
export async function reload(state: KnowledgeChatState): Promise<void> {
  await Promise.all([
    loadSessions(state),
    loadBases(state),
    loadSpeechCapability(state),
  ])
}

/** 取库清单给范围选择器用。取不到只剩「全部」一项，不为它挡对话、也不报错。 */
async function loadBases(state: KnowledgeChatState): Promise<void> {
  try {
    state.bases.value = await listBases()
  } catch {
    state.bases.value = []
  }
}

/**
 * 取对话清单。⚠ 不自动选中第一个：用户进来多半是要开新的一问，
 * 自动选中上一次的会让他对着一段旧对话发新问题。
 */
async function loadSessions(state: KnowledgeChatState): Promise<void> {
  await guarded(state, async () => {
    state.isLoading.value = true
    try {
      state.sessions.value = await listSessions()
    } finally {
      state.isLoading.value = false
    }
  })
}

/** 取不到能力就当没接语音：麦克风键只是锦上添花，不为它挡对话、也不报错。 */
async function loadSpeechCapability(state: KnowledgeChatState): Promise<void> {
  try {
    state.isAsrEnabled.value = (await readCapability()).isAsrEnabled
  } catch {
    state.isAsrEnabled.value = false
  }
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
  // 暂存的范围只服务「下一个新对话」；切过去之后由那条会话自己的范围说了算
  state.pendingScope.value = null
  await guarded(state, () => replaySelected(state))
}

/**
 * 新建一个对话并切过去。
 * @param state 页面状态
 */
export async function create(state: KnowledgeChatState): Promise<void> {
  await guarded(state, async () => {
    const made = await createSession('', state.pendingScope.value)
    state.sessions.value = [made, ...state.sessions.value]
    await select(state, made.id)
  })
}

/**
 * 改这次对话的检索范围。还没有会话时先暂存，建会话那一刻带上去。
 * ⚠ 冲突（别处刚改过）时重新载入清单并说清楚：默默覆盖的话，另一个标签页刚
 * 划好的范围会不声不响地没掉。
 * @param state 页面状态
 * @param baseScopeIds 选中的库；null = 全部知识库
 */
export async function setScope(
  state: KnowledgeChatState,
  baseScopeIds: string[] | null,
): Promise<void> {
  const one = state.current.value
  if (one === null) {
    state.pendingScope.value = baseScopeIds
    return
  }
  await guarded(state, async () => {
    try {
      const updated = await setSessionScope(
        one.id,
        baseScopeIds,
        one.row_version,
      )
      state.sessions.value = state.sessions.value.map((each) =>
        each.id === updated.id ? updated : each,
      )
    } catch (cause) {
      if (
        cause instanceof BizError &&
        cause.code === KNOWLEDGE_CHAT_CONFLICT_CODE
      ) {
        await loadSessions(state)
        throw new Error('这个对话的范围在别处改过了，已重新载入，请再改一次')
      }
      throw cause
    }
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
