/** @fileoverview 依据已落库工具调用和对应回执恢复实时卡片。 */
import {
  emptyLog,
  withStep,
  type ConversationLog,
} from '@/features/ai/conversationLog'
import { replayedLog, type Replayable } from '@/features/ai/replayLog'
import { WATCH_POINT, parseLivePoint } from './liveTools'

/** 回放卡片描述，实时值重新订阅，不读取历史快照。 */
export function replayKnowledgeLog(detail: Replayable): ConversationLog {
  const calls = new Map<string, string>()
  const received = new Set(
    detail.messages
      .filter((one) => one.role === 'tool')
      .map((one) => one.content_json.tool_call_id),
  )
  let log = emptyLog()
  for (const message of detail.messages) {
    const currentCalls = new Map<string, string>()
    if (message.role === 'assistant') {
      rememberCalls(message.content_json.tool_calls, currentCalls)
      for (const [id, key] of currentCalls) calls.set(id, key)
    }
    if (message.role === 'tool') {
      const key = calls.get(String(message.content_json.tool_call_id))
      const point = parseLivePoint(message.content_json.text)
      if (point !== null && point.node_key === key) {
        log = withStep(log, {
          kind: 'client_tool',
          name: WATCH_POINT,
          state: 'succeeded',
          title: '查看实时数据',
          error: null,
          output: JSON.stringify(point),
        })
        calls.delete(String(message.content_json.tool_call_id))
      }
    }
    const hasReceipt = [...currentCalls.keys()].some((id) => received.has(id))
    const shown = hasReceipt
      ? {
          ...message,
          steps: message.steps.filter(
            (step) =>
              step.name !== WATCH_POINT || step.state !== 'awaiting_client',
          ),
        }
      : message
    const part = replayedLog({ messages: [shown] })
    log = { ...log, entries: [...log.entries, ...part.entries] }
  }
  return log
}

function rememberCalls(raw: unknown, calls: Map<string, string>): void {
  if (!Array.isArray(raw)) return
  const items: unknown[] = raw
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const call: Record<string, unknown> = { ...item }
    if (call.name !== WATCH_POINT || typeof call.id !== 'string') continue
    if (typeof call.args !== 'object' || call.args === null) continue
    const args: Record<string, unknown> = { ...call.args }
    if (typeof args.node_key === 'string') calls.set(call.id, args.node_key)
  }
}
