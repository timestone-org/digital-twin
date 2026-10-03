/** @fileoverview 全局 MCP 确认宿主状态：关闭、中止或卸载均拒绝尚未提交的票据。 */
import { onBeforeUnmount, shallowRef, type ShallowRef } from 'vue'
import type { AssistantMcpWritePrepare } from '@dt/contracts'

import {
  clearMcpWriteConfirmHandler,
  setMcpWriteConfirmHandler,
  type McpWriteConfirmHandler,
} from './mcpWriteBridge'

interface PendingWrite {
  request: AssistantMcpWritePrepare
  isSubmitting: boolean
  error: string | null
  choose: (confirmed: boolean) => void
}

export function useMcpWriteConfirmHost() {
  const pending = shallowRef<PendingWrite | null>(null)
  let attached = true
  const present: McpWriteConfirmHandler = (request, signal) => {
    if (pending.value !== null) {
      return { decision: Promise.resolve(false), complete: () => undefined }
    }
    let chosen = false
    let resolve: ((confirmed: boolean) => void) | null = null
    const decision = new Promise<boolean>((done) => {
      resolve = done
    })
    const abort = () => choose(false)
    function choose(confirmed: boolean): void {
      if (chosen) return
      chosen = true
      signal?.removeEventListener('abort', abort)
      if (attached && pending.value !== null) {
        pending.value = { ...pending.value, isSubmitting: true }
      }
      resolve?.(confirmed)
    }
    pending.value = { request, isSubmitting: false, error: null, choose }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) choose(false)
    return {
      decision,
      complete: (error) => {
        if (!attached || pending.value?.request !== request) return
        pending.value =
          error === null
            ? null
            : { ...pending.value, error, isSubmitting: false }
      },
    }
  }
  setMcpWriteConfirmHandler(present)
  onBeforeUnmount(() => {
    attached = false
    pending.value?.choose(false)
    clearMcpWriteConfirmHandler(present)
  })

  return {
    pending,
    choose: (confirmed: boolean) => choosePending(pending, confirmed),
  }
}

function choosePending(
  pending: ShallowRef<PendingWrite | null>,
  confirmed: boolean,
): void {
  const current = pending.value
  if (current === null || current.isSubmitting) return
  if (current.error !== null) {
    pending.value = null
    return
  }
  current.choose(confirmed)
}
