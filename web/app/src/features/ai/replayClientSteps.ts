/** @fileoverview 兼容旧客户端批次步骤：只用相邻实际工具回执恢复结果，不推断未执行项。 */
import type { AssistantStep } from '@dt/contracts'

interface HistoryMessage {
  role: string
  content_json: Record<string, unknown>
}

/** 当前助手消息之后、下一条发话之前的真实回执。 */
export function followingReceipts(
  messages: readonly HistoryMessage[],
  index: number,
): Map<string, string> {
  const receipts = new Map<string, string>()
  for (const message of messages.slice(index + 1)) {
    if (message.role !== 'tool') break
    const id = message.content_json.tool_call_id
    const text = message.content_json.text
    if (
      typeof id === 'string' &&
      typeof text === 'string' &&
      !receipts.has(id)
    ) {
      receipts.set(id, text)
    }
  }
  return receipts
}

/** 将旧 calls 批次拆为每次调用；新步骤仍以持久化状态为准。 */
export function replayClientSteps(
  steps: readonly AssistantStep[],
  receipts: ReadonlyMap<string, string>,
): AssistantStep[] {
  return steps.flatMap((step) => {
    if (step.kind !== 'client_tool' || step.state !== 'awaiting_client')
      return [step]
    const calls: unknown = step.input_json?.calls
    if (!Array.isArray(calls)) return [withReceipt(step, receipts)]
    const items: unknown[] = calls
    const expanded = items.flatMap((item) => legacyStep(step, item, receipts))
    return expanded.length === items.length && expanded.length > 0
      ? expanded
      : [step]
  })
}

function legacyStep(
  step: AssistantStep,
  given: unknown,
  receipts: ReadonlyMap<string, string>,
): AssistantStep[] {
  const call = objectOf(given)
  if (typeof call.call_id !== 'string' || typeof call.name !== 'string')
    return []
  return [
    withReceipt(
      {
        ...step,
        id: `${step.id}:${call.call_id}`,
        name: call.name,
        input_json: {
          call_id: call.call_id,
          arguments: objectOf(call.arguments),
        },
      },
      receipts,
    ),
  ]
}

function withReceipt(
  step: AssistantStep,
  receipts: ReadonlyMap<string, string>,
): AssistantStep {
  const id = step.input_json?.call_id
  const text = typeof id === 'string' ? receipts.get(id) : undefined
  if (text === undefined) return step
  const error = text.startsWith('失败：') ? text.slice('失败：'.length) : null
  const isCancelled = step.name === 'user.ask' && cancelledAnswer(text)
  return {
    ...step,
    state: error !== null ? 'failed' : isCancelled ? 'aborted' : 'succeeded',
    error,
    output_json: { body: text },
  }
}

function cancelledAnswer(text: string): boolean {
  try {
    const given: unknown = JSON.parse(text)
    return objectOf(given).is_cancelled === true
  } catch {
    return false
  }
}

function objectOf(given: unknown): Record<string, unknown> {
  return typeof given === 'object' && given !== null && !Array.isArray(given)
    ? { ...given }
    : {}
}
