/**
 * @fileoverview 知识库对话页的交互编排：把状态与动作绑成页面手上的一件东西。
 */
import * as actions from './knowledgeChatActions'
import { createState } from './knowledgeChatState'
import type { KnowledgeConversation } from '@/composables/useKnowledgeConversation'

export function useKnowledgeChatPage(chat?: KnowledgeConversation) {
  const state = createState(chat)
  return {
    ...state,
    reload: () => actions.reload(state),
    select: (sessionId: string | null) => actions.select(state, sessionId),
    create: () => actions.create(state),
    rename: (sessionId: string, title: string) =>
      actions.rename(state, sessionId, title),
    archive: (sessionId: string) => actions.archive(state, sessionId),
    remove: (sessionId: string) => actions.remove(state, sessionId),
    send: (text: string) => actions.send(state, text),
    setScope: (baseScopeIds: string[] | null) =>
      actions.setScope(state, baseScopeIds),
  }
}
