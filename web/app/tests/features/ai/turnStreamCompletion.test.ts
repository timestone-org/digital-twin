/** @fileoverview 回合流必须明确完成或交出客户端工具，中断与错误不能静默结束或续推。 */
import { describe, expect, it, vi } from 'vitest'

import { runLoop, type LoopBody, type LoopSink } from '@/features/ai/turnLoop'

function frame(name: string, body: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`
}

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

function inputOf(chunks: readonly string[]) {
  const advance = vi.fn(async function* () {
    for (const chunk of chunks) {
      await Promise.resolve()
      yield chunk
    }
  })
  return {
    advance,
    sessionId: 'binding-session',
    userText: '帮我将信息板点位的绑定补充完整',
    envelope: (): LoopBody => ({}),
    dispatch: vi.fn(async () => {
      await Promise.resolve()
      return { ok: true }
    }),
    maxRounds: 2,
  }
}

describe('回合流终态', () => {
  it('流在绑定途中结束且未给终态时明确报告中断', async () => {
    const input = inputOf([
      frame('message.delta', { channel: 'text', text: '继续绑定下一块信息板' }),
    ])
    const nudge = vi.fn(() => ({ note: '继续', text: '按计划继续绑定' }))
    const sink = sinkOf()
    await runLoop({ ...input, nudge }, sink)
    expect(sink.onDelta).toHaveBeenCalledWith('text', '继续绑定下一块信息板')
    expect(sink.onDone).not.toHaveBeenCalled()
    expect(sink.onError).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('中断'),
    )
    expect(nudge).not.toHaveBeenCalled()
    expect(input.advance).toHaveBeenCalledOnce()
  })

  it('流末尾错误帧没有空行时停止续推', async () => {
    const input = inputOf([
      frame('error', { message: '模型暂时不可用' }).trimEnd(),
    ])
    const nudge = vi.fn(() => ({ note: '继续', text: '按计划继续绑定' }))
    const sink = sinkOf()
    await runLoop({ ...input, nudge }, sink)
    expect(sink.onError).toHaveBeenCalledExactlyOnceWith('模型暂时不可用')
    expect(nudge).not.toHaveBeenCalled()
    expect(input.advance).toHaveBeenCalledOnce()
  })

  it('空答复完成帧结束回合并交出空答复', async () => {
    const input = inputOf([frame('turn.done', { reply: '' })])
    const sink = sinkOf()
    await runLoop(input, sink)
    expect(sink.onDone).toHaveBeenCalledExactlyOnceWith('')
    expect(sink.onError).not.toHaveBeenCalled()
  })

  it('流末尾完成帧没有空行时仍结束回合', async () => {
    const input = inputOf([frame('turn.done', { reply: '已绑完整' }).trimEnd()])
    const sink = sinkOf()
    await runLoop(input, sink)
    expect(sink.onDone).toHaveBeenCalledExactlyOnceWith('已绑完整')
    expect(sink.onError).not.toHaveBeenCalled()
  })

  it('流结束前用户取消时不报告流中断', async () => {
    const controller = new AbortController()
    const input = inputOf([])
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      yield frame('message.delta', { text: '正在绑定' })
      controller.abort()
    })
    const sink = sinkOf()
    await runLoop({ ...input, advance, signal: controller.signal }, sink)
    expect(sink.onError).not.toHaveBeenCalled()
    expect(sink.onDone).not.toHaveBeenCalled()
  })

  it('流末尾客户端工具帧仍执行工具并回填一次', async () => {
    const input = inputOf([])
    let rounds = 0
    const advance = vi.fn(async function* () {
      await Promise.resolve()
      rounds += 1
      yield rounds === 1
        ? frame('client_tool.request', {
            calls: [
              {
                call_id: 'bind-1',
                name: 'dashboard.write_binding',
                arguments: {},
              },
            ],
          }).trimEnd()
        : frame('turn.done', { reply: '已绑完整' })
    })
    const sink = sinkOf()
    await runLoop({ ...input, advance }, sink)
    expect(input.dispatch).toHaveBeenCalledOnce()
    expect(advance).toHaveBeenCalledTimes(2)
    expect(sink.onDone).toHaveBeenCalledExactlyOnceWith('已绑完整')
    expect(sink.onError).not.toHaveBeenCalled()
  })
})
