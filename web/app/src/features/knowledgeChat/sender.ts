/**
 * @fileoverview 「发一句话」这个动作：掐上一个回合、开新的、跑循环、收摊。
 *
 * 与助手那份（`features/ai/conversationSender.ts`）同构，少了工作面与计划。
 * ⚠ 这几步的顺序错一步，就是「两个回合的步骤交替写进同一个列表」。
 */
import type { Ref } from 'vue'

import {
  withDelta,
  withReply,
  withSaid,
  withStep,
  type ConversationLog,
} from '@/features/ai/conversationLog'
import type { RunState } from '@/features/ai/conversationSender'
import {
  runKnowledgeTurn,
  type KnowledgeAdvanceStream,
  type KnowledgeRunnerSink,
} from './turnRunner'

export interface KnowledgeSenderParts {
  sessionId: () => string | null
  advance: KnowledgeAdvanceStream
  state: RunState
  isRunning: Ref<boolean>
  edit: (next: (given: ConversationLog) => ConversationLog) => void
  /** 掐掉上一个回合，但**不往时间线上写字**。 */
  abort: () => void
  /** 服务端给这个会话自动起了标题。 */
  onTitled?: ((title: string, rowVersion: number) => void) | undefined
}

/** 造出「发一句话」这个动作。 */
export function createKnowledgeSender(
  parts: KnowledgeSenderParts,
): (text: string) => Promise<void> {
  return async function send(text: string): Promise<void> {
    const id = parts.sessionId()
    if (id === null) {
      parts.edit((log) => withSaid(log, 'error', '先选一个对话，或者新建一个'))
      return
    }
    // 连着发两句时先掐掉上一个，否则两条流的步骤会交替写进同一个列表
    parts.abort()
    const controller = new AbortController()
    parts.state.running = controller
    parts.isRunning.value = true
    parts.edit((log) => withSaid(log, 'user', text))
    try {
      await runKnowledgeTurn(
        {
          advance: parts.advance,
          sessionId: id,
          userText: text,
          signal: controller.signal,
          onTitled: parts.onTitled,
        },
        sinkOf(parts),
      )
    } catch (error) {
      if (!controller.signal.aborted) {
        parts.edit((log) => withSaid(log, 'error', reason(error)))
      }
    } finally {
      if (parts.state.running === controller) {
        parts.state.running = null
        parts.isRunning.value = false
      }
    }
  }
}

function sinkOf(parts: KnowledgeSenderParts): KnowledgeRunnerSink {
  return {
    onDelta: (channel, text) =>
      parts.edit((log) => withDelta(log, channel, text)),
    onStep: (step) => parts.edit((log) => withStep(log, step)),
    onToolsRun: (steps) => parts.edit((log) => steps.reduce(withStep, log)),
    onDone: (reply) => parts.edit((log) => withReply(log, reply)),
    onError: (message) => parts.edit((log) => withSaid(log, 'error', message)),
    onNote: (text) => parts.edit((log) => withSaid(log, 'note', text)),
  }
}

function reason(error: unknown): string {
  if (error instanceof Error) return error.message
  return '知识库没能答上来'
}
