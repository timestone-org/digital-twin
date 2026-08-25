/**
 * @fileoverview 浏览器这一侧的回合循环：收流 → 派发客户端工具 → 把结果送回去。
 *
 * 服务端跑到客户端工具那一步就把流结束了，待办交给我们；我们在**当前工作面**
 * 上执行它们，再带着结果发下一次推进。一个回合因此可能是好几次 HTTP 往返，
 * 而用户看到的是连续的一串步骤（ADR-0023）。
 *
 * ⚠ 往返有上限。模型绕进「调一个工具 → 看结果 → 再调同一个」的循环时，
 * 每一步看起来都合理，只有总轮数拦得住它。
 *
 * ⚠ 工具失败**照样要把结果送回去**，而且要说清失败了。不送的话服务端那次
 * 调用永远没有答复，模型下一轮会被端点判成请求不合法——报出来的是一条与
 * 真实原因毫无关系的错。
 *
 * ⚠ 每一轮都重新读一次工作面快照。攒一份在第一轮用的话，助手自己动过两下
 * 之后，它读到的还是动手之前那一屏。
 */
import type {
  AssistantDeltaChannel,
  AssistantSurfaceKind,
  AssistantToolCall,
} from '@dt/contracts'

import type { AdvanceBody } from '@/api/assistant'
import type { AdvanceStream } from './ports'
import { createFrameReader } from './sseFrames'
import { activeSurface, runClientTool } from './surfaces'

/** 一次往返的上限。到顶就停下并如实告诉用户，而不是继续烧钱。 */
export const MAX_ROUNDS = 12

/** 界面要渲染的一步。 */
export interface RunnerStep {
  kind: string
  name: string
  state: string
  title: string
  error: string | null
}

/** 循环把发生的事交给谁。 */
export interface RunnerSink {
  /** 模型又吐了一小块：`text` 是它说的话，`reasoning` 是它想的过程。 */
  onDelta: (channel: AssistantDeltaChannel, text: string) => void
  onStep: (step: RunnerStep) => void
  /** 一批客户端工具跑完了，附带它们各自成没成。 */
  onToolsRun: (steps: readonly RunnerStep[]) => void
  onDone: (reply: string) => void
  onError: (message: string) => void
}

export interface RunnerInput {
  advance: AdvanceStream
  sessionId: string
  surfaceKind: AssistantSurfaceKind
  surfaceLabel: string
  userText: string
  signal?: AbortSignal
}

interface ToolResult {
  call_id: string
  output?: unknown
  error?: string | null
}

/**
 * 跑完一个回合，中途把每一步交给 `sink`。
 * ⚠ 调用方要在卸载时 abort `signal`：不 abort 的话组件没了而循环还在，
 * 一路写进已经销毁的状态。
 * @param input 从哪推进、在哪个工作面上
 * @param sink 事件交给谁
 */
export async function runTurn(
  input: RunnerInput,
  sink: RunnerSink,
): Promise<void> {
  let body: AdvanceBody = { ...envelope(input), user_text: input.userText }
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const pending = await pump(input, body, sink)
    if (pending === null) return
    const results = await runAll(pending, sink)
    body = { ...envelope(input), tool_results: results }
  }
  sink.onError(`助手来回了 ${MAX_ROUNDS} 轮还没结束，已经停下`)
}

/** 每一轮都要带的那几格：在哪一页、这一页此刻长什么样。 */
function envelope(input: RunnerInput): AdvanceBody {
  const snapshot = activeSurface()?.snapshot()
  return {
    surface_kind: input.surfaceKind,
    surface_label: input.surfaceLabel,
    ...(snapshot === undefined ? {} : { surface_context: snapshot }),
  }
}

/**
 * 收一次流。回合结束时给 `null`，停在客户端工具上时给那批待办。
 */
async function pump(
  input: RunnerInput,
  body: AdvanceBody,
  sink: RunnerSink,
): Promise<readonly AssistantToolCall[] | null> {
  const reader = createFrameReader()
  let pending: readonly AssistantToolCall[] | null = null
  const stream = input.advance(input.sessionId, body, input.signal)
  for await (const chunk of stream) {
    for (const frame of reader.push(chunk)) {
      pending = handle(frame.name, frame.data, sink) ?? pending
      if (frame.name === 'turn.done' || frame.name === 'error') return null
    }
  }
  for (const frame of reader.flush()) {
    pending = handle(frame.name, frame.data, sink) ?? pending
  }
  return pending
}

function handle(
  name: string,
  data: Record<string, unknown>,
  sink: RunnerSink,
): readonly AssistantToolCall[] | null {
  if (name === 'message.delta') {
    sink.onDelta(readChannel(data.channel), readText(data.text))
    return null
  }
  if (name === 'step') {
    sink.onStep(readStep(data))
    return null
  }
  if (name === 'client_tool.request') return readCalls(data)
  if (name === 'turn.done') {
    sink.onDone(readText(data.reply))
    return null
  }
  if (name === 'error') sink.onError(readText(data.message))
  return null
}

/**
 * 把一批待办在当前工作面上跑完，成败都收成结果。
 * ⚠ 每一个都顺手记成一步交给界面：这几步是助手唯一真正改动画布的地方，
 * 而服务端看不见它们——不记的话，一次绑二十个点在界面上是二十秒的空白。
 */
async function runAll(
  calls: readonly AssistantToolCall[],
  sink: RunnerSink,
): Promise<ToolResult[]> {
  const results: ToolResult[] = []
  const steps: RunnerStep[] = []
  for (const call of calls) {
    try {
      const output = await runClientTool(call)
      results.push({ call_id: call.call_id, output })
      steps.push(stepOf(call, null))
    } catch (error) {
      // 失败也要送回去，而且要说清——不送的话那次调用永远没有答复
      const reason = describe(error)
      results.push({ call_id: call.call_id, error: reason })
      steps.push(stepOf(call, reason))
    }
  }
  sink.onToolsRun(steps)
  return results
}

/** 一次客户端工具执行记成一步。标题是给人看的一句话，不是工具名。 */
function stepOf(call: AssistantToolCall, error: string | null): RunnerStep {
  return {
    kind: 'client_tool',
    name: call.name,
    state: error === null ? 'succeeded' : 'failed',
    title: error === null ? `${call.name} 做完了` : `${call.name} 没做成`,
    error,
  }
}

function readStep(data: Record<string, unknown>): RunnerStep {
  return {
    kind: readText(data.kind),
    name: readText(data.name),
    state: readText(data.state),
    title: readText(data.title),
    error: typeof data.error === 'string' ? data.error : null,
  }
}

/** 认不出的路一律当正文：宁可多显示一段，也不要把模型说的话丢掉。 */
function readChannel(given: unknown): AssistantDeltaChannel {
  return given === 'reasoning' ? 'reasoning' : 'text'
}

function readCalls(data: Record<string, unknown>): AssistantToolCall[] {
  const given: unknown = data.calls
  if (!Array.isArray(given)) return []
  // ⚠ 收成 `unknown[]` 再逐项判：`Array.isArray` 把 `unknown` narrow 成
  // `any[]`，直接展开每一项就把 any 放进了业务层
  const items: unknown[] = given
  return items.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const shape: Record<string, unknown> = { ...item }
    const callId = readText(shape.call_id)
    const name = readText(shape.name)
    if (callId === '' || name === '') return []
    return [{ call_id: callId, name, arguments: readObject(shape.arguments) }]
  })
}

function readObject(given: unknown): Record<string, unknown> {
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    return {}
  }
  return { ...given }
}

function readText(given: unknown): string {
  return typeof given === 'string' ? given : ''
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : '执行失败'
}
