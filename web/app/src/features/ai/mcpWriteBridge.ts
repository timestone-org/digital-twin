/**
 * @fileoverview MCP 写确认桥：只认服务端保存的调用和票据，用户决定后领取实际回执。
 * 取消不使用回合中止信号；确认后停止仍等待实际结果，见 ADR-0031。
 */
import type { AssistantMcpWritePrepare, AssistantToolCall } from '@dt/contracts'

import { decideMcpWrite, prepareMcpWrite } from '@/api/assistant'
import {
  ActualToolReceiptError,
  CancelledToolReceipt,
  ToolReceiptUnavailableError,
} from './toolReceipts'

export interface McpWritePresentation {
  decision: Promise<boolean>
  complete: (error: string | null) => void
}

export type McpWriteConfirmHandler = (
  request: AssistantMcpWritePrepare,
  signal?: AbortSignal,
) => McpWritePresentation

let handler: McpWriteConfirmHandler | null = null

export function setMcpWriteConfirmHandler(next: McpWriteConfirmHandler): void {
  handler = next
}

export function clearMcpWriteConfirmHandler(
  given: McpWriteConfirmHandler,
): void {
  if (handler === given) handler = null
}

/** 通过可信界面确认已保存的调用；SSE 中的参数不进入决定请求。 */
export async function runMcpWrite(
  sessionId: string,
  call: AssistantToolCall,
  signal?: AbortSignal,
): Promise<unknown> {
  const prepared = await prepareWrite(sessionId, call.call_id)
  if (prepared.call_id !== call.call_id || prepared.tool_name !== call.name) {
    await finishWrite(
      sessionId,
      { ...prepared, call_id: call.call_id },
      false,
      null,
    )
    throw new ToolReceiptUnavailableError(
      '服务端确认内容与待执行调用不匹配，操作未获确认；请核查历史',
    )
  }
  const presentation =
    signal?.aborted === true ? null : (handler?.(prepared, signal) ?? null)
  const confirmed = (await presentation?.decision) === true && !signal?.aborted
  return await finishWrite(sessionId, prepared, confirmed, presentation)
}

async function finishWrite(
  sessionId: string,
  prepared: AssistantMcpWritePrepare,
  confirmed: boolean,
  presentation: McpWritePresentation | null,
): Promise<unknown> {
  try {
    const result = await decideMcpWrite(sessionId, prepared.call_id, {
      ticket: prepared.ticket,
      confirm: confirmed,
    })
    if (result.call_id !== prepared.call_id) {
      throw new ToolReceiptUnavailableError(
        '执行回执与调用不匹配；请查看历史，不要重复执行',
      )
    }
    if (result.error !== null) throw new ActualToolReceiptError(result)
    presentation?.complete(null)
    return receiptOutput(result.output, confirmed)
  } catch (error) {
    const failure =
      error instanceof ActualToolReceiptError ||
      error instanceof ToolReceiptUnavailableError
        ? error
        : unavailable(error)
    presentation?.complete(
      failure instanceof ActualToolReceiptError && !confirmed
        ? null
        : failure.message,
    )
    throw failure
  }
}

function receiptOutput(output: unknown, confirmed: boolean): unknown {
  return confirmed ? output : new CancelledToolReceipt(output)
}

async function prepareWrite(
  sessionId: string,
  callId: string,
): Promise<AssistantMcpWritePrepare> {
  try {
    return await prepareMcpWrite(sessionId, callId)
  } catch (error) {
    throw unavailable(error)
  }
}

function unavailable(error: unknown): ToolReceiptUnavailableError {
  const reason = error instanceof Error ? error.message : '连接异常'
  return new ToolReceiptUnavailableError(
    `执行状态未确认（${reason}）；请查看历史，不会自动重试`,
  )
}
