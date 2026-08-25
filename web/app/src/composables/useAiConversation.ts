/**
 * @fileoverview 一次对话的运行态：会话、时间线，以及正在跑的那个回合。
 *
 * ⚠ 卸载时必须 abort：不 abort 的话组件没了而回合还在跑，一路写进已经销毁的
 * 状态；服务端那边也会一直跑到自己结束。
 *
 * ⚠ 用户连着发两句时，**先把上一个回合掐掉**再起新的。不掐的话两条流的步骤
 * 会交替写进同一个列表，界面上看着像助手在做两件互相矛盾的事。
 *
 * ⚠ 时间线怎么长（哪一小块接在哪一条后面、什么时候另起一条）不在这里，
 * 在 `features/ai/conversationLog.ts`——那些规矩要能被单独测，而它们错了
 * 只在真模型逐字吐字时才看得出来。
 */
import { computed, onScopeDispose, ref, type Ref } from 'vue'
import type { AssistantSurfaceKind } from '@dt/contracts'

import {
  emptyLog,
  withDelta,
  withReply,
  withSaid,
  withStep,
  type ChatEntry,
  type ConversationLog,
} from '@/features/ai/conversationLog'
import { runTurn } from '@/features/ai/turnRunner'
import { aiPorts, type AdvanceStream } from '@/features/ai/ports'

export type { ChatEntry }

export interface AiConversation {
  entries: Ref<readonly ChatEntry[]>
  isRunning: Ref<boolean>
  /** 发一句话，跑一个回合。 */
  send: (text: string) => Promise<void>
  /** 掐掉正在跑的那个回合。 */
  stop: () => void
  /** 清空这一屏的对话（不动库里的历史）。 */
  clear: () => void
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
  const state: RunState = { running: null }

  function edit(next: (given: ConversationLog) => ConversationLog): void {
    log.value = next(log.value)
  }

  // ⚠ 停下要在时间线上留一条。不留的话，界面只是安静下来，而用户分不清
  // 「它做完了」与「我把它掐了」——下一轮他会以为上一轮的改动都落下去了
  function stop(): void {
    const wasRunning = state.running !== null
    state.running?.abort()
    state.running = null
    isRunning.value = false
    // 不是红的：这是用户自己按的，不是出了错
    if (wasRunning) edit((given) => withSaid(given, 'note', '已停下'))
  }

  const send = createSender({
    sessionId,
    surface,
    state,
    isRunning,
    edit,
    abort: () => {
      state.running?.abort()
      state.running = null
    },
  })

  onScopeDispose(() => {
    state.running?.abort()
    state.running = null
  })

  return {
    entries: computed(() => log.value.entries),
    isRunning,
    send,
    stop,
    clear: () => {
      state.running?.abort()
      state.running = null
      isRunning.value = false
      log.value = emptyLog()
    },
  }
}

/** 正在跑的那个回合。放在闭包外，`send` 与 `stop` 共用同一格。 */
interface RunState {
  running: AbortController | null
}

interface SenderParts {
  sessionId: () => string | null
  surface: () => { kind: AssistantSurfaceKind; label: string }
  state: RunState
  isRunning: Ref<boolean>
  edit: (next: (given: ConversationLog) => ConversationLog) => void
  /** 掐掉上一个回合，但**不往时间线上写字**。 */
  abort: () => void
}

/**
 * 造出「发一句话」这个动作。
 * ⚠ 抽出来不只是为了行数：`send` 里那几步（掐上一个、开新的、跑、收摊）
 * 顺序错一步就是「两个回合的步骤交替写进同一个列表」。
 */
function createSender(parts: SenderParts): (text: string) => Promise<void> {
  return async function send(text: string): Promise<void> {
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
        inputOf(parts, id, advance, text, controller),
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
  userText: string,
  controller: AbortController,
): Parameters<typeof runTurn>[0] {
  const where = parts.surface()
  return {
    advance,
    sessionId,
    surfaceKind: where.kind,
    surfaceLabel: where.label,
    userText,
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
  }
}

function reason(error: unknown): string {
  if (error instanceof Error) return error.message
  return '助手没能答上来'
}
