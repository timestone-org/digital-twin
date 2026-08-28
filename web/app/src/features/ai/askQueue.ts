/**
 * @fileoverview 对话这一侧接住提问：摆到时间线上、等用户点、把答案交回回合。
 *
 * ⚠ resolve 与时间线上那张卡片**由同一处持有**。分开放的话，掐掉回合时只结掉
 * 其中一头：要么回合继续挂着，要么卡片一直摆着一排点了没人接的按钮。
 *
 * ⚠ 中止一律回**取消**而不是抛。取消是这条工具的正常回执（设计文档 §1），
 * 而抛出去会让模型去排查一个不存在的故障。
 */
import type { Ref } from 'vue'
import type { AssistantAskAnswer, AssistantAskRequest } from '@dt/contracts'

import { ASK_CANCELLED, clearAskHandler, setAskHandler } from './askBridge'
import { withAnswered, withAsk, type ConversationLog } from './conversationLog'

export interface AskQueue {
  /** 用户点了。认不出的 id 一律忽略（回放出来的卡片不该有人在等）。 */
  answer: (id: string, answer: AssistantAskAnswer) => void
  /**
   * 把挂着的提问全部结成取消。
   * ⚠ 掐回合与卸载都必须调：不调的话 `runTurn` 永远停在 await 上。
   */
  cancelAll: () => void
  /** 撤掉处理器。页面卸载时调。 */
  detach: () => void
}

export interface AskQueueParts {
  edit: (next: (log: ConversationLog) => ConversationLog) => void
  /** 此刻有没有等着回答的提问。输入框据它上锁。 */
  isAsking: Ref<boolean>
}

/** 挂着的一次提问。 */
interface Waiting {
  settle: (answer: AssistantAskAnswer) => void
}

let seed = 0

/** 提问条目的 id。⚠ 走 `a…`，与时间线自己的 `e…` 撞不到一起。 */
function nextAskId(): string {
  seed += 1
  return `a${seed}`
}

/**
 * 造一条提问队列，并就地装上处理器。
 * @param parts 往哪条时间线上摆、拿哪一格记「正等着」
 */
export function createAskQueue(parts: AskQueueParts): AskQueue {
  const waiting = new Map<string, Waiting>()

  function settle(id: string, answer: AssistantAskAnswer): void {
    const one = waiting.get(id)
    if (one === undefined) return
    waiting.delete(id)
    parts.isAsking.value = waiting.size > 0
    parts.edit((log) => withAnswered(log, id, answer))
    one.settle(answer)
  }

  async function handler(
    request: AssistantAskRequest,
  ): Promise<AssistantAskAnswer> {
    const id = nextAskId()
    parts.edit((log) => withAsk(log, id, request))
    parts.isAsking.value = true
    return new Promise<AssistantAskAnswer>((resolve) => {
      waiting.set(id, { settle: resolve })
    })
  }

  setAskHandler(handler)

  return {
    answer: settle,
    cancelAll: () => {
      for (const id of [...waiting.keys()]) settle(id, ASK_CANCELLED)
    },
    detach: () => clearAskHandler(handler),
  }
}

/** 只给测试用：让提问 id 回到起点。 */
export function __resetAskIds(): void {
  seed = 0
}
