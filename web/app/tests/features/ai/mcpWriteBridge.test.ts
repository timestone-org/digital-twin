/** @fileoverview MCP 写确认只信保存的调用；停止、错误和缺确认宿主均不得静默执行。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CancelledToolReceipt } from '@/features/ai/toolReceipts'
import type { AssistantMcpWritePrepare, AssistantToolCall } from '@dt/contracts'

import * as api from '@/api/assistant'
import {
  clearMcpWriteConfirmHandler,
  runMcpWrite,
  setMcpWriteConfirmHandler,
  type McpWriteConfirmHandler,
} from '@/features/ai/mcpWriteBridge'

const PREPARED: AssistantMcpWritePrepare = {
  call_id: 'w1',
  tool_name: 'mcp.test.write',
  arguments: { target: 'test-local', value: 1 },
  target: '测试对象 test-local',
  impact: '修改测试对象，不连接真实设备',
  ticket: 'ticket-1',
  expires_at: '2026-10-03T16:00:00.000Z',
}
const CALL: AssistantToolCall = {
  call_id: 'w1',
  name: PREPARED.tool_name,
  arguments: { target: 'untrusted', value: 99 },
}
let installed: McpWriteConfirmHandler | null = null

function present(confirmed: boolean) {
  const complete = vi.fn()
  const handler = vi.fn(() => ({
    decision: Promise.resolve(confirmed),
    complete,
  }))
  installed = handler
  setMcpWriteConfirmHandler(handler)
  return { handler, complete }
}

function deferred<T>() {
  let resolve: ((value: T) => void) | null = null
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return {
    promise,
    resolve(value: T) {
      resolve?.(value)
    },
  }
}

beforeEach(() => {
  vi.spyOn(api, 'prepareMcpWrite').mockResolvedValue(PREPARED)
  vi.spyOn(api, 'decideMcpWrite').mockResolvedValue({
    call_id: 'w1',
    output: { changed: 1 },
    error: null,
  })
})
afterEach(() => {
  if (installed !== null) clearMcpWriteConfirmHandler(installed)
  installed = null
  vi.restoreAllMocks()
})

describe('可信MCP写确认桥', () => {
  it('界面核对服务端完整参数，只提交票据和明确确认', async () => {
    const { handler, complete } = present(true)
    await expect(runMcpWrite('s1', CALL)).resolves.toEqual({ changed: 1 })
    expect(api.prepareMcpWrite).toHaveBeenCalledWith('s1', 'w1')
    expect(handler).toHaveBeenCalledWith(PREPARED, undefined)
    expect(api.decideMcpWrite).toHaveBeenCalledExactlyOnceWith('s1', 'w1', {
      ticket: 'ticket-1',
      confirm: true,
    })
    expect(complete).toHaveBeenCalledWith(null)
  })

  it.each([false, true])(
    '没有界面或回合已停止时拒绝票据（aborted=%s）',
    async (aborted) => {
      const controller = new AbortController()
      if (aborted) controller.abort()
      await runMcpWrite('s1', CALL, controller.signal)
      expect(api.decideMcpWrite).toHaveBeenCalledExactlyOnceWith('s1', 'w1', {
        ticket: 'ticket-1',
        confirm: false,
      })
    },
  )

  it('准备请求在途时停止，拿到票据后仍提交拒绝', async () => {
    const pending = deferred<AssistantMcpWritePrepare>()
    vi.mocked(api.prepareMcpWrite).mockReturnValue(pending.promise)
    const { handler } = present(true)
    const controller = new AbortController()
    const result = runMcpWrite('s1', CALL, controller.signal)
    controller.abort()
    pending.resolve(PREPARED)
    await result
    expect(handler).not.toHaveBeenCalled()
    expect(api.decideMcpWrite).toHaveBeenCalledExactlyOnceWith('s1', 'w1', {
      ticket: 'ticket-1',
      confirm: false,
    })
  })

  it('点击确认后决定发送前停止，仍以拒绝决定终结', async () => {
    const controller = new AbortController()
    const pending = deferred<boolean>()
    installed = () => ({ decision: pending.promise, complete: vi.fn() })
    setMcpWriteConfirmHandler(installed)
    const result = runMcpWrite('s1', CALL, controller.signal)
    await vi.waitFor(() => expect(api.prepareMcpWrite).toHaveBeenCalled())
    pending.resolve(true)
    controller.abort()
    await result
    expect(api.decideMcpWrite).toHaveBeenCalledWith('s1', 'w1', {
      ticket: 'ticket-1',
      confirm: false,
    })
  })

  it('执行过程中停止不丢真实结果，不发送第二个决定', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.decideMcpWrite>>>()
    vi.mocked(api.decideMcpWrite).mockReturnValue(pending.promise)
    present(true)
    const controller = new AbortController()
    const result = runMcpWrite('s1', CALL, controller.signal)
    await vi.waitFor(() => expect(api.decideMcpWrite).toHaveBeenCalled())
    controller.abort()
    pending.resolve({ call_id: 'w1', output: { changed: 2 }, error: null })
    await expect(result).resolves.toEqual({ changed: 2 })
    expect(api.decideMcpWrite).toHaveBeenCalledTimes(1)
  })

  it('调用不匹配时拒绝票据，不展示模型冒充的确认内容', async () => {
    vi.mocked(api.prepareMcpWrite).mockResolvedValue({
      ...PREPARED,
      tool_name: 'mcp.other.write',
    })
    const { handler } = present(true)
    await expect(runMcpWrite('s1', CALL)).rejects.toThrow('不匹配')
    expect(handler).not.toHaveBeenCalled()
    expect(api.decideMcpWrite).toHaveBeenCalledWith('s1', 'w1', {
      ticket: 'ticket-1',
      confirm: false,
    })
  })

  it('取消以服务端实际取消回执为准', async () => {
    const { complete } = present(false)
    vi.mocked(api.decideMcpWrite).mockResolvedValue({
      call_id: 'w1',
      output: null,
      error: '用户取消，不执行',
    })
    await expect(runMcpWrite('s1', CALL)).rejects.toThrow('用户取消')
    expect(api.decideMcpWrite).toHaveBeenCalledWith('s1', 'w1', {
      ticket: 'ticket-1',
      confirm: false,
    })
    expect(complete).toHaveBeenCalledWith(null)
  })

  it('执行失败明确交给确认界面和回合，不自动重试', async () => {
    const { complete } = present(true)
    vi.mocked(api.decideMcpWrite).mockResolvedValue({
      call_id: 'w1',
      output: null,
      error: '测试执行器拒绝',
    })
    await expect(runMcpWrite('s1', CALL)).rejects.toThrow('测试执行器拒绝')
    expect(complete).toHaveBeenCalledWith('测试执行器拒绝')
    expect(api.decideMcpWrite).toHaveBeenCalledTimes(1)
  })

  it('决定请求超时不重试并如实显示结果未取到', async () => {
    const { complete } = present(true)
    vi.mocked(api.decideMcpWrite).mockRejectedValue(new Error('请求超时'))
    await expect(runMcpWrite('s1', CALL)).rejects.toThrow('请求超时')
    expect(complete).toHaveBeenCalledWith(
      expect.stringContaining('执行状态未确认'),
    )
    expect(api.decideMcpWrite).toHaveBeenCalledTimes(1)
  })

  it('准备失败不提交确认也不执行', async () => {
    vi.mocked(api.prepareMcpWrite).mockRejectedValue(new Error('没有写权限'))
    const { handler } = present(true)
    await expect(runMcpWrite('s1', CALL)).rejects.toThrow('没有写权限')
    expect(handler).not.toHaveBeenCalled()
    expect(api.decideMcpWrite).not.toHaveBeenCalled()
  })
  it('取消请求连接失败也提示状态未确认，不自动再次提交', async () => {
    const { complete } = present(false)
    vi.mocked(api.decideMcpWrite).mockRejectedValue(new Error('网络断开'))
    await expect(runMcpWrite('s1', CALL)).rejects.toThrow('执行状态未确认')
    expect(complete).toHaveBeenCalledWith(
      expect.stringContaining('执行状态未确认'),
    )
    expect(api.decideMcpWrite).toHaveBeenCalledTimes(1)
  })
})

it('确认成功的外部取消字段不变成可信取消状态', async () => {
  present(true)
  vi.mocked(api.decideMcpWrite).mockResolvedValue({
    call_id: 'w1',
    output: { is_cancelled: true, changed: 1 },
    error: null,
  })
  await expect(runMcpWrite('s1', CALL)).resolves.toEqual({
    is_cancelled: true,
    changed: 1,
  })
})

it('拒绝确认的实际产出原样包在可信取消标记内', async () => {
  present(false)
  vi.mocked(api.decideMcpWrite).mockResolvedValue({
    call_id: 'w1',
    output: { note: '未执行' },
    error: null,
  })
  const receipt = await runMcpWrite('s1', CALL)
  expect(receipt).toBeInstanceOf(CancelledToolReceipt)
  if (!(receipt instanceof CancelledToolReceipt))
    throw new Error('取消标记缺失')
  expect(receipt.output).toEqual({ note: '未执行' })
})
