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
 *
 * ⚠ 计划没走完而模型停了嘴时，这里代用户催一句「按计划继续」（ADR-0024）。
 * 有上限：模型反复停下说明它自己也拿不准，那时该交还给人，不是继续催。
 */
import type {
  AssistantDeltaChannel,
  AssistantPlan,
  AssistantPlanItem,
  AssistantPlanStatus,
  AssistantSurfaceKind,
  AssistantToolCall,
} from '@dt/contracts'
import { ASSISTANT_PLAN_STATUSES } from '@dt/contracts'

import type { AdvanceBody } from '@/api/assistant'
import type { AdvanceStream } from './ports'
import { createFrameReader } from './sseFrames'
import { inputPreview, isImageOutput, outputPreview } from './stepPreview'
import { activeSurface, runClientTool } from './surfaces'

/**
 * 一次往返的上限。到顶就停下并如实告诉用户，而不是继续烧钱。
 * ⚠ 量的是**往返次数**（一批客户端工具跑完再推进一次算一轮），不是服务端那边
 * 一个回合里的步数（`MAX_STEPS_PER_TURN`）。一句「设计一个光伏看板」实测要
 * 三十多轮：加模块、逐个改配置、绑点、截图自查各占几轮，24 轮会在半路上把人
 * 撂下。到顶不是死路——历史里那批没等到回执的调用由服务端补上失败回执
 * （`history.fillers`），所以用户说一句「继续」就能接着做。
 */
export const MAX_ROUNDS = 60

/** 计划未完时最多代用户催几次。 */
export const MAX_PLAN_NUDGES = 3

/** 催那一句。⚠ 会作为用户消息落库，措辞要经得起在历史里被读到。 */
export const PLAN_CONTINUE_TEXT =
  '（自动继续）按计划把剩下的项做完；做不下去就把那一项标成 failed 并说明原因。'

/** 界面要渲染的一步。 */
export interface RunnerStep {
  kind: string
  name: string
  state: string
  title: string
  error: string | null
  /** 入参，已摊成键值表。 */
  input?: Record<string, string>
  /** 产出摘要。 */
  output?: string
  /**
   * 这一步截到的图（`data:image/…`）。
   * ⚠ 只有最近几步留着原图，更早的会被丢掉换成 `isImageDropped` —— 一张截图
   * 几百 KB，一个截了几十次的会话会把这个标签页拖垮。
   */
  image?: string
  /** 这一步有过图，但为省内存没留下。 */
  isImageDropped?: true
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
  /** 计划变了：整份快照，直接盖掉手上那份。 */
  onPlan: (plan: AssistantPlan) => void
  /** 循环自己说的一句话（「计划未完，自动继续」这类），不是模型说的。 */
  onNote: (text: string) => void
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
  const watch: PlanWatch = { plan: null }
  let nudges = 0
  let body: AdvanceBody = { ...envelope(input), user_text: input.userText }
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const outcome = await pump(input, body, sink, watch)
    if (outcome.kind === 'error') return
    if (outcome.kind === 'pending') {
      const results = await runAll(outcome.calls, sink)
      body = { ...envelope(input), tool_results: results }
      continue
    }
    // 模型收了嘴而计划没走完：代用户催一句，让它接着干（ADR-0024）
    if (!planUnfinished(watch.plan) || nudges >= MAX_PLAN_NUDGES) return
    nudges += 1
    sink.onNote('计划还没走完，自动继续。')
    body = { ...envelope(input), user_text: PLAN_CONTINUE_TEXT }
  }
  sink.onError(
    `助手来回了 ${MAX_ROUNDS} 轮还没做完，先停下了。说一句「继续」就接着做。`,
  )
}

/** 循环手上那份最新计划。 */
interface PlanWatch {
  plan: AssistantPlan | null
}

/** 计划还挂着没走完。 */
function planUnfinished(plan: AssistantPlan | null): boolean {
  return plan !== null && plan.state === 'active'
}

/** 每一轮都要带的那几格：在哪一页、这一页此刻长什么样、实现了哪些工具。 */
function envelope(input: RunnerInput): AdvanceBody {
  const surface = activeSurface()
  const snapshot = surface?.snapshot()
  return {
    surface_kind: input.surfaceKind,
    surface_label: input.surfaceLabel,
    ...(snapshot === undefined ? {} : { surface_context: snapshot }),
    // 页面自报实现了哪些客户端工具；没有工作面时如实报空，模型就不会调
    client_tools: surface === null ? [] : [...surface.tools],
  }
}

/** 一次收流的结果。 */
type PumpOutcome =
  | { kind: 'pending'; calls: readonly AssistantToolCall[] }
  | { kind: 'done' }
  | { kind: 'error' }

/**
 * 收一次流：跑完 / 出错 / 停在一批客户端工具上。
 */
async function pump(
  input: RunnerInput,
  body: AdvanceBody,
  sink: RunnerSink,
  watch: PlanWatch,
): Promise<PumpOutcome> {
  const reader = createFrameReader()
  let pending: readonly AssistantToolCall[] | null = null
  const stream = input.advance(input.sessionId, body, input.signal)
  for await (const chunk of stream) {
    for (const frame of reader.push(chunk)) {
      pending = handle(frame.name, frame.data, sink, watch) ?? pending
      if (frame.name === 'turn.done') return { kind: 'done' }
      if (frame.name === 'error') return { kind: 'error' }
    }
  }
  for (const frame of reader.flush()) {
    pending = handle(frame.name, frame.data, sink, watch) ?? pending
  }
  return pending === null
    ? { kind: 'done' }
    : { kind: 'pending', calls: pending }
}

function handle(
  name: string,
  data: Record<string, unknown>,
  sink: RunnerSink,
  watch: PlanWatch,
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
  if (name === 'plan') {
    const plan = readPlan(data.plan)
    if (plan !== null) {
      watch.plan = plan
      sink.onPlan(plan)
    }
    return null
  }
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
      steps.push(stepOf(call, output, null))
    } catch (error) {
      // 失败也要送回去，而且要说清——不送的话那次调用永远没有答复
      const reason = describe(error)
      results.push({ call_id: call.call_id, error: reason })
      steps.push(stepOf(call, undefined, reason))
    }
  }
  sink.onToolsRun(steps)
  return results
}

/**
 * 一次客户端工具执行记成一步。标题是给人看的一句话，不是工具名。
 * ⚠ 入参与产出就地留下：这几步**服务端看不见**（它们跑在浏览器里），
 * 不在这里留，界面上就永远只有一句「做完了」。
 * ⚠ 截图单拎一格：混进产出的话，展开看到的是几十万字符的 base64。
 */
function stepOf(
  call: AssistantToolCall,
  output: unknown,
  error: string | null,
): RunnerStep {
  const input = inputPreview(call.arguments)
  const text = outputPreview(output)
  return {
    kind: 'client_tool',
    name: call.name,
    state: error === null ? 'succeeded' : 'failed',
    title: error === null ? `${call.name} 做完了` : `${call.name} 没做成`,
    error,
    ...(input === null ? {} : { input }),
    ...(text === null ? {} : { output: text }),
    ...(isImageOutput(output) ? { image: output } : {}),
  }
}

function readStep(data: Record<string, unknown>): RunnerStep {
  const input = inputPreview(data.input)
  const output = readText(data.output)
  return {
    kind: readText(data.kind),
    name: readText(data.name),
    state: readText(data.state),
    title: readText(data.title),
    error: typeof data.error === 'string' ? data.error : null,
    ...(input === null ? {} : { input }),
    ...(output === '' ? {} : { output }),
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

/**
 * 把一帧计划快照读成结构；读不出给 null。
 * ⚠ 认不出的项状态按 `pending` 画，不静默丢整项——丢一项的表现是
 * 「清单少了一行」，而那与「模型改了计划」看着一模一样。
 */
export function readPlan(given: unknown): AssistantPlan | null {
  const body = readObject(given)
  const rawItems: unknown = body.items
  if (!Array.isArray(rawItems)) return null
  const list: unknown[] = rawItems
  const items = list.flatMap((one): AssistantPlanItem[] => {
    const item = readObject(one)
    const title = readText(item.title)
    if (title === '') return []
    return [
      {
        title,
        status: readStatus(item.status),
        note: readText(item.note),
      },
    ]
  })
  if (items.length === 0) return null
  return {
    title: readText(body.title),
    state: body.state === 'done' ? 'done' : 'active',
    items,
  }
}

function readStatus(given: unknown): AssistantPlanStatus {
  for (const status of ASSISTANT_PLAN_STATUSES) {
    if (given === status) return status
  }
  return 'pending'
}

function readText(given: unknown): string {
  return typeof given === 'string' ? given : ''
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : '执行失败'
}
