/** @fileoverview 同一回合不重复执行已失败的同参数调用，拒绝仍生成实际回执。 */
import type { AssistantToolCall } from '@dt/contracts'
import { ActualToolReceiptError } from './toolReceipts'

export function clientFailureGuard(
  dispatch: (call: AssistantToolCall) => Promise<unknown>,
  canSaveReceipts: boolean,
) {
  const failed = new Set<string>()
  let repeated = false
  return {
    hasRepeated: () => repeated,
    dispatch: async (call: AssistantToolCall): Promise<unknown> => {
      // ⚠ 旧协议要靠下一次推进回填；MCP 回执只能由服务端确认桥生成。
      if (!canSaveReceipts || call.name.startsWith('mcp.'))
        return dispatch(call)
      const signature = `${call.name}:${stableJson(call.arguments)}`
      if (repeated || failed.has(signature)) {
        repeated = true
        throw new ActualToolReceiptError({
          call_id: call.call_id,
          error: '相同参数的工具调用已失败，停止重复执行。',
          output: {
            ok: false,
            code: 'repeated_failed_call',
            execution: 'not_started',
            retryable: false,
            next_action:
              '先核对失败原因并修正参数或工作面；未知结果的写操作先读回核验。',
          },
        })
      }
      try {
        return await dispatch(call)
      } catch (error) {
        failed.add(signature)
        throw error
      }
    },
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    const items: unknown[] = value
    return `[${items.map(stableJson).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries: [string, unknown][] = Object.entries(value)
    return `{${entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}
