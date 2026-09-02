/**
 * @fileoverview 知识库对话的运行态：时间线，以及正在跑的那个回合。
 *
 * 与助手的 `useAiConversation` 同构，少了工作面与计划。时间线怎么长在
 * `features/ai/conversationLog.ts`，发话那几步的顺序在
 * `features/knowledgeChat/sender.ts`——那些规矩要能被单独测。
 *
 * ⚠ 掐回合与卸载都要把挂着的提问结掉（`features/ai/askQueue.ts`）。不结的话
 * 回合永远停在那次 await 上：界面既不动也不报错，输入框一直禁着。
 */
import { computed, onScopeDispose, ref, type Ref } from 'vue'
import type {
  AssistantAskAnswer,
  KnowledgeChatSessionDetail,
} from '@dt/contracts'

import { advanceTurn } from '@/api/knowledgeChat'
import { createAskQueue, type AskQueue } from '@/features/ai/askQueue'
import {
  emptyLog,
  withSaid,
  type ChatEntry,
  type ConversationLog,
} from '@/features/ai/conversationLog'
import type { RunState } from '@/features/ai/conversationSender'
import { replayedLog } from '@/features/ai/replayLog'
import {
  createKnowledgeSender,
  type KnowledgeSenderParts,
} from '@/features/knowledgeChat/sender'
import type { KnowledgeAdvanceStream } from '@/features/knowledgeChat/turnRunner'

export interface KnowledgeConversation {
  entries: Ref<readonly ChatEntry[]>
  isRunning: Ref<boolean>
  /** 正等着用户回答。⚠ 这期间输入框上锁。 */
  isAsking: Ref<boolean>
  /** 发一句话，跑一个回合。 */
  send: (text: string) => Promise<void>
  /** 掐掉正在跑的那个回合。 */
  stop: () => void
  /** 清空这一屏（不动库里的历史）。 */
  clear: () => void
  /** 用库里的历史整份替换时间线。⚠ 正在跑回合时不动。 */
  restore: (detail: KnowledgeChatSessionDetail) => void
  /** 用户在提问卡片上点了。 */
  answerAsk: (id: string, answer: AssistantAskAnswer) => void
  /** 往时间线上添一句界面自己的说明。 */
  note: (text: string) => void
}

/**
 * 造一段对话。
 * @param sessionId 会话 id 的读取函数；还没选时给 null
 * @param advance 推进面；缺省打真接口，用例注假的进来
 */
export function useKnowledgeConversation(
  sessionId: () => string | null,
  advance: KnowledgeAdvanceStream = advanceTurn,
): KnowledgeConversation {
  const log = ref<ConversationLog>(emptyLog())
  const isRunning = ref(false)
  const isAsking = ref(false)
  const state: RunState = { running: null }
  const edit = (next: (given: ConversationLog) => ConversationLog): void => {
    log.value = next(log.value)
  }
  const asks = createAskQueue({ edit, isAsking })

  const parts: KnowledgeSenderParts = {
    sessionId,
    advance,
    state,
    isRunning,
    edit,
    // 掐掉回合的同时把挂着的提问结成取消：只掐一头的话回合还停在 await 上
    abort: () => {
      state.running?.abort()
      state.running = null
      asks.cancelAll()
    },
  }

  onScopeDispose(() => {
    parts.abort()
    asks.detach()
  })

  return {
    entries: computed(() => log.value.entries),
    isRunning,
    isAsking,
    send: createKnowledgeSender(parts),
    ...controlsOf(parts, asks),
  }
}

/** 造出发话之外的那几个动作：停下、清空、回放、答一句、注一句。 */
function controlsOf(
  parts: KnowledgeSenderParts,
  asks: AskQueue,
): Pick<
  KnowledgeConversation,
  'stop' | 'clear' | 'restore' | 'answerAsk' | 'note'
> {
  return {
    // ⚠ 停下要在时间线上留一条：不留的话用户分不清「答完了」与「我掐了」
    stop: () => {
      const wasRunning = parts.state.running !== null
      parts.abort()
      parts.isRunning.value = false
      if (wasRunning) parts.edit((given) => withSaid(given, 'note', '已停下'))
    },
    clear: () => {
      parts.abort()
      parts.isRunning.value = false
      parts.edit(() => emptyLog())
    },
    restore: (detail) => {
      if (parts.state.running !== null) return
      parts.edit(() => replayedLog(detail))
    },
    answerAsk: asks.answer,
    note: (text) => parts.edit((given) => withSaid(given, 'note', text)),
  }
}
