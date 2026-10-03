/** @fileoverview MCP 确认的实际结果进入回执历史；停止不丢执行结果且不续推模型。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMcpWritePrepare } from '@dt/contracts'

import * as api from '@/api/assistant'
import type { AdvanceBody } from '@/api/assistant'
import {
  clearMcpWriteConfirmHandler,
  setMcpWriteConfirmHandler,
  type McpWriteConfirmHandler,
} from '@/features/ai/mcpWriteBridge'
import { runTurn, type RunnerSink } from '@/features/ai/turnRunner'

const PREPARED: AssistantMcpWritePrepare = {
  call_id: 'w1',
  tool_name: 'mcp.test.write',
  arguments: { value: 1 },
  target: '测试执行器',
  impact: '测试数据改变',
  ticket: 'ticket-1',
  expires_at: '2026-10-03T16:00:00.000Z',
}
let installed: McpWriteConfirmHandler

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

function scene() {
  let rounds = 0
  const advance = vi.fn(async function* (
    _sessionId: string,
    _body: AdvanceBody,
  ) {
    void _sessionId
    void _body
    await Promise.resolve()
    rounds += 1
    const name = rounds === 1 ? 'client_tool.request' : 'turn.done'
    const body =
      rounds === 1
        ? {
            calls: [
              {
                call_id: 'w1',
                name: 'mcp.test.write',
                arguments: { untrusted: true },
              },
            ],
          }
        : { reply: '收到实际结果' }
    yield `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`
  })
  const saveReceipts = vi.fn().mockResolvedValue(undefined)
  const onToolsRun = vi.fn()
  const sink: RunnerSink = {
    onDelta: vi.fn(),
    onStep: vi.fn(),
    onToolsRun,
    onDone: vi.fn(),
    onError: vi.fn(),
    onPlan: vi.fn(),
    onNote: vi.fn(),
  }
  const input = {
    advance,
    saveReceipts,
    sessionId: 's1',
    surfaceKind: 'dashboard-editor' as const,
    surfaceLabel: '测试工作面',
    userText: '测试写入',
  }
  return { input, sink, saveReceipts, advance, onToolsRun }
}

beforeEach(() => {
  installed = () => ({ decision: Promise.resolve(true), complete: vi.fn() })
  setMcpWriteConfirmHandler(installed)
  vi.spyOn(api, 'prepareMcpWrite').mockResolvedValue(PREPARED)
  vi.spyOn(api, 'decideMcpWrite').mockResolvedValue({
    call_id: 'w1',
    output: { changed: 1, trace_id: 'test-trace' },
    error: null,
  })
})
afterEach(() => {
  clearMcpWriteConfirmHandler(installed)
  vi.restoreAllMocks()
})

describe('MCP实际回执与回合停止', () => {
  it('保存真实返回值并在每个推进信封声明确认能力', async () => {
    const { input, sink, advance, saveReceipts } = scene()
    await runTurn(input, sink)
    expect(saveReceipts).toHaveBeenCalledExactlyOnceWith('s1', [
      { call_id: 'w1', output: { changed: 1, trace_id: 'test-trace' } },
    ])
    expect(advance).toHaveBeenCalledTimes(2)
    for (const call of advance.mock.calls) {
      expect(call[1]).toMatchObject({
        client_tools: expect.arrayContaining(['mcp.confirm_write']),
      })
    }
  })

  it('prepare在途停止后提交拒绝且把实际取消保存到历史', async () => {
    const pending = deferred<AssistantMcpWritePrepare>()
    vi.mocked(api.prepareMcpWrite).mockReturnValue(pending.promise)
    vi.mocked(api.decideMcpWrite).mockResolvedValue({
      call_id: 'w1',
      output: { is_cancelled: true },
      error: null,
    })
    const controller = new AbortController()
    const { input, sink, advance, saveReceipts } = scene()
    const running = runTurn({ ...input, signal: controller.signal }, sink)
    await vi.waitFor(() => expect(api.prepareMcpWrite).toHaveBeenCalled())
    controller.abort()
    pending.resolve(PREPARED)
    await running
    expect(api.decideMcpWrite).toHaveBeenCalledExactlyOnceWith('s1', 'w1', {
      ticket: 'ticket-1',
      confirm: false,
    })
    expect(saveReceipts).toHaveBeenCalledExactlyOnceWith('s1', [
      { call_id: 'w1', output: { is_cancelled: true } },
    ])
    expect(advance).toHaveBeenCalledTimes(1)
  })

  it('执行未完成时停止仍保存真实成功回执且不续推模型', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.decideMcpWrite>>>()
    vi.mocked(api.decideMcpWrite).mockReturnValue(pending.promise)
    const controller = new AbortController()
    const { input, sink, advance, saveReceipts } = scene()
    const running = runTurn({ ...input, signal: controller.signal }, sink)
    await vi.waitFor(() => expect(api.decideMcpWrite).toHaveBeenCalled())
    controller.abort()
    pending.resolve({
      call_id: 'w1',
      output: { actuallyExecuted: true },
      error: null,
    })
    await running
    expect(saveReceipts).toHaveBeenCalledExactlyOnceWith('s1', [
      { call_id: 'w1', output: { actuallyExecuted: true } },
    ])
    expect(advance).toHaveBeenCalledTimes(1)
    expect(api.decideMcpWrite).toHaveBeenCalledTimes(1)
  })

  it('失败回执如实写历史和时间线，不重试写操作', async () => {
    vi.mocked(api.decideMcpWrite).mockResolvedValue({
      call_id: 'w1',
      output: null,
      error: '测试执行器拒绝',
    })
    const { input, sink, saveReceipts, onToolsRun } = scene()
    await runTurn(input, sink)
    expect(saveReceipts).toHaveBeenCalledExactlyOnceWith('s1', [
      { call_id: 'w1', output: null, error: '测试执行器拒绝' },
    ])
    expect(onToolsRun).toHaveBeenCalledWith([
      expect.objectContaining({ state: 'failed', error: '测试执行器拒绝' }),
    ])
    expect(api.decideMcpWrite).toHaveBeenCalledTimes(1)
  })
  it('停止时原样保存非空MCP失败output和error，与服务端已有回执一致', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.decideMcpWrite>>>()
    vi.mocked(api.decideMcpWrite).mockReturnValue(pending.promise)
    const raw = {
      isError: true,
      content: [{ type: 'text', text: '设备未连接（测试）' }],
    }
    const actual = { call_id: 'w1', output: raw, error: 'MCP工具报告执行失败' }
    const controller = new AbortController()
    const { input, sink, advance, saveReceipts } = scene()
    saveReceipts.mockImplementation((_session, receipts) => {
      expect(receipts).toEqual([actual])
      return Promise.resolve()
    })
    const running = runTurn({ ...input, signal: controller.signal }, sink)
    await vi.waitFor(() => expect(api.decideMcpWrite).toHaveBeenCalled())
    controller.abort()
    pending.resolve(actual)
    await running
    expect(saveReceipts).toHaveBeenCalledExactlyOnceWith('s1', [actual])
    expect(advance).toHaveBeenCalledTimes(1)
    expect(api.decideMcpWrite).toHaveBeenCalledTimes(1)
  })

  it.each(['prepare', 'decide'])(
    'HTTP %s失败没有实际回执，不伪造失败或续推',
    async (phase) => {
      if (phase === 'prepare')
        vi.mocked(api.prepareMcpWrite).mockRejectedValue(new Error('403'))
      else
        vi.mocked(api.decideMcpWrite).mockRejectedValue(new Error('连接中断'))
      const { input, sink, advance, saveReceipts, onToolsRun } = scene()
      await runTurn(input, sink)
      expect(saveReceipts).not.toHaveBeenCalled()
      expect(advance).toHaveBeenCalledTimes(1)
      expect(onToolsRun).toHaveBeenCalledWith([
        expect.objectContaining({ state: 'unknown' }),
      ])
      expect(sink.onError).toHaveBeenCalledWith(
        expect.stringContaining('执行状态未确认'),
      )
    },
  )
})
