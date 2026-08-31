/**
 * @fileoverview 「发一句话」这个动作：掐上一个回合、开新的、跑循环、收摊。
 *
 * ⚠ 这几步的顺序错一步，就是「两个回合的步骤交替写进同一个列表」——
 * 界面上看着像助手在做两件互相矛盾的事。
 */
import type { Ref } from 'vue'
import type { AssistantPlan, AssistantSurfaceKind } from '@dt/contracts'

import {
  withDelta,
  withReply,
  withSaid,
  withStep,
  type ConversationLog,
} from './conversationLog'
import { runTurn } from './turnRunner'
import { aiPorts, type AdvanceStream } from './ports'

/** 正在跑的那个回合。放在闭包外，`send` 与 `stop` 共用同一格。 */
export interface RunState {
  running: AbortController | null
}

export interface SenderParts {
  sessionId: () => string | null
  surface: () => { kind: AssistantSurfaceKind; label: string }
  state: RunState
  isRunning: Ref<boolean>
  edit: (next: (given: ConversationLog) => ConversationLog) => void
  plan: Ref<AssistantPlan | null>
  /** 掐掉上一个回合，但**不往时间线上写字**。 */
  abort: () => void
}

/** 造出「发一句话」这个动作。 */
export function createSender(
  parts: SenderParts,
): (text: string, images?: string[]) => Promise<void> {
  return async function send(text: string, images?: string[]): Promise<void> {
    const id = parts.sessionId()
    const advance = aiPorts()?.advance
    if (id === null || advance === undefined) {
      parts.edit((log) => withSaid(log, 'error', '助手在这套部署里不可用'))
      return
    }
    // 连着发两句时先掐掉上一个，否则两条流的步骤会交替写进同一个列表
    parts.abort()
    const controller = new AbortController()
    parts.state.running = controller
    parts.isRunning.value = true
    parts.edit((log) => withSaid(log, 'user', text))
    try {
      await runTurn(
        inputOf(parts, id, advance, { text, images: images ?? [] }, controller),
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

function inputOf(
  parts: SenderParts,
  sessionId: string,
  advance: AdvanceStream,
  // ⚠ 话与图打成一包而不是两个形参：这个函数的形参上限是 5，而这两样本来
  // 就是同一句话的两半——拆开传的下一步就是有人只更新其中一半
  said: { text: string; images: string[] },
  controller: AbortController,
): Parameters<typeof runTurn>[0] {
  const where = parts.surface()
  return {
    advance,
    sessionId,
    surfaceKind: where.kind,
    surfaceLabel: where.label,
    userText: said.text,
    userImages: said.images,
    signal: controller.signal,
  }
}

function sinkOf(parts: SenderParts): Parameters<typeof runTurn>[1] {
  return {
    onDelta: (channel, text) =>
      parts.edit((log) => withDelta(log, channel, text)),
    onStep: (step) => parts.edit((log) => withStep(log, step)),
    // 客户端工具是助手真正改动画布的地方，服务端看不见它们——不记的话，
    // 一次绑二十个点在界面上是二十秒的空白
    onToolsRun: (steps) => parts.edit((log) => steps.reduce(withStep, log)),
    onDone: (reply) => parts.edit((log) => withReply(log, reply)),
    onError: (message) => parts.edit((log) => withSaid(log, 'error', message)),
    onPlan: (plan) => {
      parts.plan.value = plan
    },
    onNote: (text) => parts.edit((log) => withSaid(log, 'note', text)),
  }
}

function reason(error: unknown): string {
  if (error instanceof Error) return error.message
  return '助手没能答上来'
}
