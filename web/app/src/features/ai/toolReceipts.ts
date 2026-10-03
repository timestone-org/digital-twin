/** @fileoverview 可信服务端回执与尚未取得回执的错误必须分开，避免改写执行历史。 */
import type { AssistantToolResult } from '@dt/contracts'

/** 服务端已保存的实际失败；output 与 error 原样回填，不能只保存错误文案。 */
export class ActualToolReceiptError extends Error {
  constructor(readonly result: AssistantToolResult) {
    super(result.error ?? '工具执行失败')
    this.name = 'ActualToolReceiptError'
  }
}

/** 尚未取得实际回执，不得把连接问题当成工具执行失败回填。 */
export class ToolReceiptUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolReceiptUnavailableError'
  }
}
