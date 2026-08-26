/**
 * @fileoverview 把库里的会话详情回放成时间线：重开面板时屏上要还原历史。
 * 纯函数。工具消息不回放（工具结果是模型的输入，不是给人看的内容）；
 * 思考过程本来就不落库，回放里自然没有。
 */
import type {
  AssistantMessage,
  AssistantSessionDetail,
  AssistantStep,
} from '@dt/contracts'

import {
  emptyLog,
  withSaid,
  withStep,
  type ConversationLog,
} from './conversationLog'
import { inputPreview, outputPreview } from './stepPreview'
import type { RunnerStep } from './turnRunner'

/** 循环代发的催促消息的开头（turnRunner 的 PLAN_CONTINUE_TEXT 以它起头）。 */
export const AUTO_CONTINUE_PREFIX = '（自动继续）'

/**
 * 把一份会话详情回放成一条时间线。
 * @param detail 库里的会话详情，消息与步骤已按 seq 升序
 */
export function replayedLog(detail: AssistantSessionDetail): ConversationLog {
  return detail.messages.reduce(replayed, emptyLog())
}

function replayed(
  log: ConversationLog,
  message: AssistantMessage,
): ConversationLog {
  if (message.role === 'user') return withUserSaid(log, message)
  if (message.role === 'assistant') return withAssistantSaid(log, message)
  // 工具消息不回放：客户端工具的执行已经记在 assistant 消息的步骤里
  return log
}

/** 用户的一条。⚠ 「（自动继续）」开头的是循环代发的催促，回放成 note。 */
function withUserSaid(
  log: ConversationLog,
  message: AssistantMessage,
): ConversationLog {
  const text = readText(message.content_json.text)
  if (text === '') return log
  const role = text.startsWith(AUTO_CONTINUE_PREFIX) ? 'note' : 'user'
  return withSaid(log, role, text)
}

/** 助手的一条：先摆它做的每一步，再摆正文（空正文跳过）。 */
function withAssistantSaid(
  log: ConversationLog,
  message: AssistantMessage,
): ConversationLog {
  const stepped = message.steps.reduce(
    (grown, step) => withStep(grown, runnerStepOf(step)),
    log,
  )
  const text = readText(message.content_json.text)
  return text === '' ? stepped : withSaid(stepped, 'assistant', text)
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
