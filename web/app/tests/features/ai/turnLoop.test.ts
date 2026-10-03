/** @fileoverview 回合取消停止新工具与续推，已执行工具的实际回执仍保留。 */
import { describe, expect, it, vi } from 'vitest'

import { runLoop, type LoopBody, type LoopSink } from '@/features/ai/turnLoop'
import { ToolReceiptUnavailableError } from '@/features/ai/toolReceipts'

function frame(name: string, body: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`
}

const REQUEST = frame('client_tool.request', {
  calls: [
    { call_id: 'w1', name: 'dashboard.write_binding', arguments: {} },
    { call_id: 'w2', name: 'dashboard.write_binding', arguments: {} },
  ],
})

function sinkOf() {
  return {
    onDelta: vi.fn<LoopSink['onDelta']>(),
    onStep: vi.fn<LoopSink['onStep']>(),
    onToolsRun: vi.fn<LoopSink['onToolsRun']>(),
    onDone: vi.fn<LoopSink['onDone']>(),
    onError: vi.fn<LoopSink['onError']>(),
    onNote: vi.fn<LoopSink['onNote']>(),
  }
}

function inputOf(controller: AbortController) {
  return {
    sessionId: 'test-session',
    userText: '配置测试画布',
    envelope: vi.fn((): LoopBody => ({})),
    signal: controller.signal,
    dispatch: vi.fn<() => Promise<unknown>>(() =>
      Promise.resolve({ saved: true }),
    ),
    nudge: vi.fn(() => ({ note: '继续', text: '自动继续' })),
    maxRounds: 3,
  }
}

describe('回合取消', () => {
  it('预取消不收流、读工作面或派发工具', async () => {
    const controller = new AbortController()
    controller.abort()
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield REQUEST
    })
    const input = inputOf(controller)
    const sink = sinkOf()
    await runLoop({ ...input, advance }, sink)
    expect(advance).not.toHaveBeenCalled()
    expect(input.envelope).not.toHaveBeenCalled()
    expect(input.dispatch).not.toHaveBeenCalled()
    expect(input.nudge).not.toHaveBeenCalled()
    expect(sink.onError).not.toHaveBeenCalled()
  })

  it('收流期间取消不处理取消后收到的工具帧', async () => {
    const controller = new AbortController()
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield frame('message.delta', { channel: 'text', text: '开始配置' })
      controller.abort()
      yield REQUEST
    })
    const input = inputOf(controller)
    const sink = sinkOf()
    await runLoop({ ...input, advance }, sink)
    expect(sink.onDelta).toHaveBeenCalledWith('text', '开始配置')
    expect(input.dispatch).not.toHaveBeenCalled()
    expect(advance).toHaveBeenCalledOnce()
    expect(input.nudge).not.toHaveBeenCalled()
  })

  it('第一工具执行期间取消保留其成功回执，停止第二工具与续推', async () => {
    const controller = new AbortController()
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield REQUEST
    })
    const input = inputOf(controller)
    input.dispatch.mockImplementation(async () => {
      await Promise.resolve()
      controller.abort()
      return { saved: true }
    })
    const sink = sinkOf()
    await runLoop({ ...input, advance }, sink)
    expect(input.dispatch).toHaveBeenCalledOnce()
    expect(sink.onToolsRun).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'dashboard.write_binding',
        state: 'succeeded',
        output: '{"saved":true}',
      }),
    ])
    expect(advance).toHaveBeenCalledOnce()
    expect(input.envelope).toHaveBeenCalledOnce()
    expect(input.nudge).not.toHaveBeenCalled()
    expect(sink.onError).not.toHaveBeenCalled()
  })

  it('同一流块内步骤回调触发取消时不处理后续工具帧', async () => {
    const controller = new AbortController()
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield frame('step', { name: 'read', state: 'succeeded' }) + REQUEST
    })
    const input = inputOf(controller)
    const sink = sinkOf()
    sink.onStep.mockImplementation(() => controller.abort())
    await runLoop({ ...input, advance }, sink)
    expect(sink.onStep).toHaveBeenCalledOnce()
    expect(input.dispatch).not.toHaveBeenCalled()
    expect(advance).toHaveBeenCalledOnce()
  })

  it('工具失败期间取消保留失败回执，停止其余工具与续推', async () => {
    const controller = new AbortController()
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield REQUEST
    })
    const input = inputOf(controller)
    input.dispatch.mockImplementation(async () => {
      await Promise.resolve()
      controller.abort()
      throw new Error('配置冲突')
    })
    const sink = sinkOf()
    await runLoop({ ...input, advance }, sink)
    expect(input.dispatch).toHaveBeenCalledOnce()
    expect(sink.onToolsRun).toHaveBeenCalledWith([
      expect.objectContaining({ state: 'failed', error: '配置冲突' }),
    ])
    expect(advance).toHaveBeenCalledOnce()
    expect(input.nudge).not.toHaveBeenCalled()
  })

  it('已收到完成帧时取消保留答复且不自动催计划', async () => {
    const controller = new AbortController()
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield frame('turn.done', { reply: '当前步骤已完成' })
    })
    const input = inputOf(controller)
    const sink = sinkOf()
    sink.onDone.mockImplementation(() => controller.abort())
    await runLoop({ ...input, advance }, sink)
    expect(sink.onDone).toHaveBeenCalledWith('当前步骤已完成')
    expect(input.nudge).not.toHaveBeenCalled()
    expect(sink.onNote).not.toHaveBeenCalled()
    expect(advance).toHaveBeenCalledOnce()
  })

  it('流因取消抛出异常时正常停止', async () => {
    const controller = new AbortController()
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield frame('message.delta', { text: '开始配置' })
      controller.abort()
      throw new DOMException('已取消', 'AbortError')
    })
    const input = inputOf(controller)
    const sink = sinkOf()
    await expect(runLoop({ ...input, advance }, sink)).resolves.toBeUndefined()
    expect(input.dispatch).not.toHaveBeenCalled()
    expect(sink.onError).not.toHaveBeenCalled()
  })

  it('未取消的网络异常仍交给调用方处理', async () => {
    const controller = new AbortController()
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield frame('message.delta', { text: '开始配置' })
      throw new Error('offline')
    })
    await expect(
      runLoop({ ...inputOf(controller), advance }, sinkOf()),
    ).rejects.toThrow('offline')
  })
})

describe('实际回执单独保存', () => {
  it('取消后仅保存实际执行的第一项，不再advance', async () => {
    const controller = new AbortController()
    const input = inputOf(controller)
    input.dispatch.mockImplementation(async () => {
      await Promise.resolve()
      controller.abort()
      return { is_saved: false }
    })
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield REQUEST
    })
    const saveReceipts = vi.fn(async () => {
      await Promise.resolve()
    })
    const sink = sinkOf()
    await runLoop({ ...input, advance, saveReceipts }, sink)
    expect(saveReceipts).toHaveBeenCalledWith('test-session', [
      { call_id: 'w1', output: { is_saved: false } },
    ])
    expect(input.dispatch).toHaveBeenCalledOnce()
    expect(advance).toHaveBeenCalledOnce()
  })

  it('回执保存失败如实报告，取消也不能掩盖未持久化', async () => {
    const controller = new AbortController()
    const input = inputOf(controller)
    input.dispatch.mockImplementation(async () => {
      await Promise.resolve()
      controller.abort()
      throw new Error('保存失败')
    })
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield REQUEST
    })
    const saveReceipts = vi.fn(async () => {
      await Promise.resolve()
      throw new Error('离线')
    })
    const sink = sinkOf()
    await runLoop({ ...input, advance, saveReceipts }, sink)
    expect(saveReceipts).toHaveBeenCalledWith('test-session', [
      { call_id: 'w1', error: '保存失败' },
    ])
    expect(sink.onError).toHaveBeenCalledWith(
      expect.stringContaining('执行结果未保存到历史'),
    )
    expect(advance).toHaveBeenCalledOnce()
  })
})

describe('正常回合回执先于续推', () => {
  it('真实回执持久化后才推进', async () => {
    const controller = new AbortController()
    const input = inputOf(controller)
    const order: string[] = []
    let rounds = 0
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      order.push('advance')
      rounds += 1
      yield rounds === 1 ? REQUEST : frame('turn.done', { reply: '已修改草稿' })
    })
    const saveReceipts = vi.fn(async () => {
      await Promise.resolve()
      order.push('receipts')
    })
    await runLoop(
      { ...input, advance, saveReceipts, nudge: () => null },
      sinkOf(),
    )
    expect(order).toEqual(['advance', 'receipts', 'advance'])
    expect(saveReceipts).toHaveBeenCalledOnce()
    expect(input.dispatch).toHaveBeenCalledTimes(2)
  })
  it('一批中回执状态未知时先保存已执行结果，停止后续工具和续推', async () => {
    const input = inputOf(new AbortController())
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield frame('client_tool.request', {
        calls: [
          { call_id: 'w1', name: 'dashboard.write_binding', arguments: {} },
          { call_id: 'w2', name: 'mcp.test.write', arguments: {} },
          { call_id: 'w3', name: 'dashboard.write_binding', arguments: {} },
        ],
      })
    })
    input.dispatch
      .mockResolvedValueOnce({ saved: true })
      .mockRejectedValueOnce(new ToolReceiptUnavailableError('执行状态未确认'))
    const saveReceipts = vi.fn().mockResolvedValue(undefined)
    const sink = sinkOf()
    await runLoop({ ...input, advance, saveReceipts }, sink)
    expect(input.dispatch).toHaveBeenCalledTimes(2)
    expect(saveReceipts).toHaveBeenCalledExactlyOnceWith('test-session', [
      { call_id: 'w1', output: { saved: true } },
    ])
    expect(advance).toHaveBeenCalledOnce()
    expect(input.nudge).not.toHaveBeenCalled()
    expect(sink.onError).toHaveBeenCalledWith('执行状态未确认')
  })
})
