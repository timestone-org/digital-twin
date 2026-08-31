/**
 * @fileoverview 一次对话的运行态：会话、时间线，以及正在跑的那个回合。
 *
 * ⚠ 卸载时必须 abort：不 abort 的话组件没了而回合还在跑，一路写进已经销毁的
 * 状态；服务端那边也会一直跑到自己结束。
 *
 * ⚠ 时间线怎么长（哪一小块接在哪一条后面、什么时候另起一条）不在这里，
 * 在 `features/ai/conversationLog.ts`；发话那几步的顺序在
 * `features/ai/conversationSender.ts`——那些规矩要能被单独测。
 *
 * ⚠ 掐回合与卸载都要把挂着的提问结掉（`features/ai/askQueue.ts`）。不结的话
 * 回合永远停在那次 await 上：界面既不动也不报错，输入框一直禁着。
 */
import { computed, onScopeDispose, ref, type Ref } from 'vue'
import type {
  AssistantAskAnswer,
  AssistantPlan,
  AssistantSessionDetail,
  AssistantSurfaceKind,
} from '@dt/contracts'

import { createAskQueue, type AskQueue } from '@/features/ai/askQueue'
import {
  emptyLog,
  withSaid,
  type ChatEntry,
  type ConversationLog,
} from '@/features/ai/conversationLog'
import {
  createSender,
  type RunState,
  type SenderParts,
} from '@/features/ai/conversationSender'
import { replayedLog } from '@/features/ai/replayLog'

export type { ChatEntry }

export interface AiConversation {
  entries: Ref<readonly ChatEntry[]>
  isRunning: Ref<boolean>
  /** 助手正等着用户回答。⚠ 这期间输入框上锁：新消息会与正跑的回合抢时间线。 */
  isAsking: Ref<boolean>
  /** 当前执行计划；没有就是 null。整份快照，来一份盖一份。 */
  plan: Ref<AssistantPlan | null>
  /** 发一句话，跑一个回合。 */
  send: (text: string, images?: string[]) => Promise<void>
  /** 掐掉正在跑的那个回合。 */
  stop: () => void
  /** 清空这一屏的对话（不动库里的历史）。 */
  clear: () => void
  /**
   * 用库里的历史整份替换时间线并恢复计划。
   * ⚠ 正在跑回合时不动：正跑着的流比库里的旧账新。
   */
  restore: (detail: AssistantSessionDetail) => void
  /** 用户在提问卡片上点了。 */
  answerAsk: (id: string, answer: AssistantAskAnswer) => void
  /** 往时间线上添一句界面自己的说明（回放失败这类），不是模型说的。 */
  note: (text: string) => void
}

/**
 * 造一段对话。
 * @param sessionId 会话 id 的读取函数；还没建出来时给 null
 * @param surface 当前工作面的种类与人读名字
 */
export function useAiConversation(
  sessionId: () => string | null,
  surface: () => { kind: AssistantSurfaceKind; label: string },
): AiConversation {
  const log = ref<ConversationLog>(emptyLog())
  const isRunning = ref(false)
  const isAsking = ref(false)
  const plan = ref<AssistantPlan | null>(null)
  const state: RunState = { running: null }
  const edit = (next: (given: ConversationLog) => ConversationLog): void => {
    log.value = next(log.value)
  }
  const asks = createAskQueue({ edit, isAsking })

  const parts: SenderParts = {
    sessionId,
    surface,
    state,
    isRunning,
    edit,
    plan,
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
    plan,
    send: createSender(parts),
    ...controlsOf(parts, asks),
  }
}

/** 造出发话之外的那几个动作：停下、清空、回放、答一句、注一句。 */
function controlsOf(
  parts: SenderParts,
  asks: AskQueue,
): Pick<AiConversation, 'stop' | 'clear' | 'restore' | 'answerAsk' | 'note'> {
  return {
    // ⚠ 停下要在时间线上留一条。不留的话，界面只是安静下来，而用户分不清
    // 「它做完了」与「我把它掐了」——下一轮他会以为上一轮的改动都落下去了
    stop: () => {
      const wasRunning = parts.state.running !== null
      parts.abort()
      parts.isRunning.value = false
      // 不是红的：这是用户自己按的，不是出了错
      if (wasRunning) parts.edit((given) => withSaid(given, 'note', '已停下'))
    },
    clear: () => {
      parts.abort()
      parts.isRunning.value = false
      parts.edit(() => emptyLog())
      parts.plan.value = null
    },
    restore: (detail) => {
      if (parts.state.running !== null) return
      parts.edit(() => replayedLog(detail))
      parts.plan.value = detail.plan_json
    },
    answerAsk: asks.answer,
    note: (text) => parts.edit((given) => withSaid(given, 'note', text)),
  }
}
