/**
 * @fileoverview 助手这一侧的回合循环：内核在 `turnLoop.ts`，这里只是助手的门面。
 *
 * 门面决定三件事：每一轮的信封里带什么（工作面、这一屏的快照、自报的工具）；
 * 认不出的帧归谁（`plan`）；模型收嘴之后要不要代用户催一句（ADR-0024）。
 *
 * ⚠ 每一轮都重新读一次工作面快照。攒一份在第一轮用的话，助手自己动过两下
 * 之后，它读到的还是动手之前那一屏。
 *
 * ⚠ 计划没走完而模型停了嘴时，这里代用户催一句「按计划继续」。有上限：模型
 * 反复停下说明它自己也拿不准，那时该交还给人，不是继续催。
 *
 * ⚠ 派发先看内建表再落到工作面：`user.ask` 不归任何一页（`builtinTools.ts`）。
 */
import type {
  AssistantPlan,
  AssistantPlanItem,
  AssistantPlanStatus,
  AssistantSurfaceKind,
  AssistantToolCall,
} from '@dt/contracts'
import { ASSISTANT_PLAN_STATUSES } from '@dt/contracts'

import type { AdvanceBody } from '@/api/assistant'
import {
  BUILTIN_CLIENT_TOOLS,
  isBuiltinTool,
  runBuiltinTool,
} from './builtinTools'
import type { AdvanceStream } from './ports'
import { activeSurface, runClientTool } from './surfaces'
import { readObject, readText, runLoop, type LoopSink } from './turnLoop'

export { ASK_MUST_BE_ALONE, type RunnerStep } from './turnLoop'

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

/** 循环把发生的事交给谁。比内核多一格：计划变了。 */
export interface RunnerSink extends LoopSink {
  /** 计划变了：整份快照，直接盖掉手上那份。 */
  onPlan: (plan: AssistantPlan) => void
}

export interface RunnerInput {
  advance: AdvanceStream
  sessionId: string
  surfaceKind: AssistantSurfaceKind
  surfaceLabel: string
  userText: string
  /** 用户随这句话贴的图；只在**第一帧**带，后续回填帧不带。 */
  userImages?: string[]
  signal?: AbortSignal
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
  await runLoop<AdvanceBody>(
    {
      advance: input.advance,
      sessionId: input.sessionId,
      envelope: () => envelope(input),
      userText: input.userText,
      userImages: input.userImages,
      signal: input.signal,
      dispatch,
      onFrame: (name, data) => {
        if (name !== 'plan') return
        const plan = readPlan(data.plan)
        if (plan === null) return
        watch.plan = plan
        sink.onPlan(plan)
      },
      // 模型收了嘴而计划没走完：代用户催一句，让它接着干（ADR-0024）
      nudge: () => {
        if (!planUnfinished(watch.plan) || nudges >= MAX_PLAN_NUDGES) {
          return null
        }
        nudges += 1
        return { note: '计划还没走完，自动继续。', text: PLAN_CONTINUE_TEXT }
      },
      maxRounds: MAX_ROUNDS,
    },
    sink,
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
    // 页面自报实现了哪些客户端工具：内建那几个每一页都有，工作面的按登记来。
    // ⚠ 没有工作面时也**不是空**——提问不归任何一页，一个工作面都没登记的
    // 页面（纯看板、纯列表页）照样要能问
    client_tools: [...BUILTIN_CLIENT_TOOLS, ...(surface?.tools ?? [])],
  }
}

/** 先看内建表，再落到工作面。 */
async function dispatch(call: AssistantToolCall): Promise<unknown> {
  if (isBuiltinTool(call.name)) return runBuiltinTool(call)
  return runClientTool(call)
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
