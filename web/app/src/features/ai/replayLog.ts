/**
 * @fileoverview 把库里的会话详情回放成时间线：重开面板时屏上要还原历史。
 * 纯函数。工具消息不回放（工具结果是模型的输入，不是给人看的内容）；
 * 思考过程本来就不落库，回放里自然没有。
 *
 * ⚠ **依据要回放**：它是知识库那一路答案的出处，而那几张文档插图只挂在它
 * 上面。不回放的表现是「问的时候看得见图，重开这条对话图就没了」。
 *
 * ⚠ **提问回放不出可点的卡片**：那一轮早就结束了，点了也没有人在等这个答案。
 * `user.ask` 在历史里就是一条普通的工具步骤，走 `withStep` 而不是 `withAsk`
 * ——这里只造 said 与 step 两种条目，所以是结构上做不到，不是靠自觉。
 */
import type {
  AssistantMessage,
  AssistantStep,
  KnowledgeCitation,
} from '@dt/contracts'

import {
  emptyLog,
  withCitations,
  withSaid,
  withStep,
  type ConversationLog,
} from './conversationLog'
import { inputPreview, outputPreview } from './stepPreview'
import type { RunnerStep } from './turnRunner'

/** 循环代发的催促消息的开头（turnRunner 的 PLAN_CONTINUE_TEXT 以它起头）。 */
export const AUTO_CONTINUE_PREFIX = '（自动继续）'

/**
 * 回放只读消息的这几格；助手与知识库对话的会话详情都长这个样子。
 * ⚠ 写成结构类型而不是收 `AssistantSessionDetail`：知识库那份没有工作面
 * 与计划，而回放本来就一格都不读它们。
 */
export type ReplayableMessage = Pick<
  AssistantMessage,
  'role' | 'content_json' | 'steps'
> & {
  /**
   * 这一条答案用到的依据。⚠ 可选：助手那份会话里没有这一格，而这个类型两边
   * 共用。
   */
  citations?: readonly KnowledgeCitation[]
}

export interface Replayable {
  messages: readonly ReplayableMessage[]
}

/**
 * 把一份会话详情回放成一条时间线。
 * @param detail 库里的会话详情，消息与步骤已按 seq 升序
 */
export function replayedLog(detail: Replayable): ConversationLog {
  return detail.messages.reduce(replayed, emptyLog())
}

function replayed(
  log: ConversationLog,
  message: ReplayableMessage,
): ConversationLog {
  if (message.role === 'user') return withUserSaid(log, message)
  if (message.role === 'assistant') return withAssistantSaid(log, message)
  // 工具消息不回放：客户端工具的执行已经记在 assistant 消息的步骤里
  return log
}

/** 用户的一条。⚠ 「（自动继续）」开头的是循环代发的催促，回放成 note。 */
function withUserSaid(
  log: ConversationLog,
  message: ReplayableMessage,
): ConversationLog {
  const text = readText(message.content_json.text)
  if (text === '') return log
  const role = text.startsWith(AUTO_CONTINUE_PREFIX) ? 'note' : 'user'
  return withSaid(log, role, text)
}

/**
 * 助手的一条：先摆它做的每一步，再摆正文（空正文跳过），最后摆依据。
 * ⚠ 依据排在正文**后面**，与直播时那一帧的位置一致：换个位置的话，同一段
 * 对话直播看一遍、回放再看一遍，两次的样子不一样。
 */
function withAssistantSaid(
  log: ConversationLog,
  message: ReplayableMessage,
): ConversationLog {
  const stepped = message.steps.reduce(
    (grown, step) => withStep(grown, runnerStepOf(step)),
    log,
  )
  const text = readText(message.content_json.text)
  const said = text === '' ? stepped : withSaid(stepped, 'assistant', text)
  return withCitations(said, message.citations ?? [])
}

/**
 * 库里的一步摊成界面上的一步。
 * ⚠ 图不在里面：截图**从来不落库**（存的是一句「[截图]」），所以回放出来的
 * 那几步永远没有缩略图。卡片上就此说一句人话，不留一个点不开的空框。
 */
function runnerStepOf(step: AssistantStep): RunnerStep {
  const input = inputPreview(step.input_json)
  const output = outputPreview(step.output_json)
  return {
    kind: step.kind,
    name: step.name,
    state: step.state,
    title: titleOf(step),
    error: step.error,
    ...(input === null ? {} : { input }),
    ...(output === null ? {} : { output }),
  }
}

/** 库里的步骤不存标题，用名字与状态凑一句，措辞与直播时同一口径。 */
function titleOf(step: AssistantStep): string {
  const name = step.name === '' ? step.kind : step.name
  if (step.state === 'failed') return `${name} 没跑成`
  if (step.state === 'succeeded') return `${name} 跑完了`
  if (step.state === 'aborted') return `${name} 停下了`
  // running / awaiting_client：回放出来的步骤不会再动了，如实说没跑完
  return `${name} 没跑完`
}

function readText(given: unknown): string {
  return typeof given === 'string' ? given : ''
}
