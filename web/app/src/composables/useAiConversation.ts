/**
 * @fileoverview 一次对话的运行态：会话、消息、步骤，以及正在跑的那个回合。
 *
 * ⚠ 卸载时必须 abort：不 abort 的话组件没了而回合还在跑，一路写进已经销毁的
 * 状态；服务端那边也会一直跑到自己结束。
 *
 * ⚠ 用户连着发两句时，**先把上一个回合掐掉**再起新的。不掐的话两条流的步骤
 * 会交替写进同一个列表，界面上看着像助手在做两件互相矛盾的事。
 */
import { onScopeDispose, ref, type Ref } from 'vue'
import type { AssistantSurfaceKind } from '@dt/contracts'

import { runTurn, type RunnerStep } from '@/features/ai/turnRunner'
import { aiPorts, type AdvanceStream } from '@/features/ai/ports'

/** 界面上的一条：用户说的、助手说的，或者助手做的一步。 */
export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'step' | 'error'
  text: string
  step?: RunnerStep
}

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

let seed = 0

function nextId(): string {
  seed += 1
  return `e${seed}`
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
  const entries = ref<ChatEntry[]>([])
  const isRunning = ref(false)
  const state: RunState = { running: null }

  function push(entry: Omit<ChatEntry, 'id'>): void {
    entries.value = [...entries.value, { id: nextId(), ...entry }]
  }

  function stop(): void {
    state.running?.abort()
    state.running = null
    isRunning.value = false
  }

  const send = createSender({ sessionId, surface, state, isRunning, push, stop })

  onScopeDispose(stop)

  return {
    entries,
    isRunning,
    send,
    stop,
    clear: () => {
      stop()
      entries.value = []
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
  push: (entry: Omit<ChatEntry, 'id'>) => void
  stop: () => void
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
      parts.push({ role: 'error', text: '助手在这套部署里不可用' })
      return
    }
    // 连着发两句时先掐掉上一个，否则两条流的步骤会交替写进同一个列表
    parts.stop()
    const controller = new AbortController()
    parts.state.running = controller
    parts.isRunning.value = true
    parts.push({ role: 'user', text })
    try {
      await runTurn(inputOf(parts, id, advance, text, controller), sinkOf(parts))
    } catch (error) {
      if (!controller.signal.aborted) {
        parts.push({ role: 'error', text: reason(error) })
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
    onStep: (step) => parts.push({ role: 'step', text: step.title, step }),
    onToolsRun: () => undefined,
    onDone: (reply) => parts.push({ role: 'assistant', text: reply }),
    onError: (message) => parts.push({ role: 'error', text: message }),
  }
}

function reason(error: unknown): string {
  if (error instanceof Error) return error.message
  return '助手没能答上来'
}

/** 只给测试用：让条目 id 回到起点。 */
export function __resetEntryIds(): void {
  seed = 0
}
