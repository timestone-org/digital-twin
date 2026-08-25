/**
 * @fileoverview 浏览器这一侧的回合循环。
 *
 * **守的是 ADR-0023 的落地**：服务端跑到客户端工具就把流结束，待办交给我们，
 * 我们在当前工作面上执行、再带着结果发下一次推进。少了回填那一步，助手会在
 * 第一次动手之后就「卡住」，而两侧的日志都显示一切正常。
 *
 * 另守一条容易写漏的：工具失败也要把结果送回去。不送的话服务端那次调用永远
 * 没有答复，下一轮请求会被端点判成不合法。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdvanceBody } from '@/api/assistant'
import {
  MAX_ROUNDS,
  runTurn,
  type RunnerSink,
  type RunnerStep,
} from '@/features/ai/turnRunner'
import { __resetSurfaces, setSurface } from '@/features/ai/surfaces'

function frame(name: string, body: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`
}

const STEP = frame('step', {
  kind: 'model',
  name: 'model',
  state: 'succeeded',
  title: '想了想',
  error: null,
})

interface Recorded {
  steps: RunnerStep[]
  replies: string[]
  errors: string[]
  ran: RunnerStep[]
  said: string[]
  thought: string[]
}

function sinkOf(): { sink: RunnerSink; seen: Recorded } {
  const seen: Recorded = {
    steps: [],
    replies: [],
    errors: [],
    ran: [],
    said: [],
    thought: [],
  }
  return {
    seen,
    sink: {
      onDelta: (channel, text) =>
        (channel === 'reasoning' ? seen.thought : seen.said).push(text),
      onStep: (step) => seen.steps.push(step),
      onToolsRun: (steps) => seen.ran.push(...steps),
      onDone: (reply) => seen.replies.push(reply),
      onError: (message) => seen.errors.push(message),
    },
  }
}

/** 一个按脚本作答的推进面，并记下每一次收到的请求体。 */
function advanceOf(script: string[][]): {
  advance: (sessionId: string, body: AdvanceBody) => AsyncGenerator<string>
  bodies: AdvanceBody[]
} {
  const bodies: AdvanceBody[] = []
  let round = 0
  async function* advance(
    _sessionId: string,
    body: AdvanceBody,
  ): AsyncGenerator<string> {
    bodies.push(body)
    for (const chunk of script[round] ?? []) {
      // 让出一次事件循环：真实的流是一块一块到的，同步吐完会让「边收边处理」
      // 这件事在用例里根本没发生过
      await Promise.resolve()
      yield chunk
    }
    round += 1
  }
  return { advance, bodies }
}

function inputOf(advance: ReturnType<typeof advanceOf>['advance']) {
  return {
    advance,
    sessionId: 's1',
    surfaceKind: 'dashboard-editor' as const,
    surfaceLabel: '大屏编辑器',
    userText: '帮我绑点',
  }
}

afterEach(() => {
  __resetSurfaces()
})

describe('回合循环', () => {
  it('一问一答就结束', async () => {
    const { advance } = advanceOf([
      [STEP, frame('turn.done', { reply: '好了' })],
    ])
    const { sink, seen } = sinkOf()
    await runTurn(inputOf(advance), sink)

    expect(seen.steps.map((one) => one.title)).toEqual(['想了想'])
    expect(seen.replies).toEqual(['好了'])
  })

  it('被切碎的帧也一步不少', async () => {
    const whole = STEP + frame('turn.done', { reply: '好了' })
    const { advance } = advanceOf([[...whole]])
    const { sink, seen } = sinkOf()
    await runTurn(inputOf(advance), sink)

    expect(seen.steps).toHaveLength(1)
    expect(seen.replies).toEqual(['好了'])
  })

  it('客户端工具在当前工作面上跑，结果回填给下一轮', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    setSurface({
      kind: 'dashboard-editor',
      label: '大屏编辑器',
      snapshot: () => ({}),
      tools: ['dashboard.write_binding'],
      run,
    })
    const { advance, bodies } = advanceOf([
      [
        frame('client_tool.request', {
          calls: [
            {
              call_id: 'w1',
              name: 'dashboard.write_binding',
              arguments: { node_id: 'n1' },
            },
          ],
        }),
      ],
      [frame('turn.done', { reply: '绑好了' })],
    ])
    const { sink, seen } = sinkOf()
    await runTurn(inputOf(advance), sink)

    expect(run).toHaveBeenCalledOnce()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]?.tool_results).toEqual([
      { call_id: 'w1', output: { ok: true } },
    ])
    expect(seen.replies).toEqual(['绑好了'])
  })

  it('第一次带发话，回填那次不带', async () => {
    setSurface({
      kind: 'dashboard-editor',
      label: '大屏编辑器',
      snapshot: () => ({}),
      tools: ['dashboard.read_canvas'],
      run: vi.fn().mockResolvedValue(null),
    })
    const { advance, bodies } = advanceOf([
      [
        frame('client_tool.request', {
          calls: [
            { call_id: 'r1', name: 'dashboard.read_canvas', arguments: {} },
          ],
        }),
      ],
      [frame('turn.done', { reply: '看完了' })],
    ])
    const { sink } = sinkOf()
    await runTurn(inputOf(advance), sink)

    // 两样同时给的话，模型会把「一句新要求」与「上一轮的结果」揉成一件事做
    expect(bodies[0]?.user_text).toBe('帮我绑点')
    expect(bodies[1]?.user_text).toBeUndefined()
  })

  it('工具失败也把结果送回去，并说清失败了', async () => {
    setSurface({
      kind: 'dashboard-editor',
      label: '大屏编辑器',
      snapshot: () => ({}),
      tools: ['dashboard.write_binding'],
      run: vi.fn().mockRejectedValue(new Error('这个槽不存在')),
    })
    const { advance, bodies } = advanceOf([
      [
        frame('client_tool.request', {
          calls: [
            { call_id: 'w1', name: 'dashboard.write_binding', arguments: {} },
          ],
        }),
      ],
      [frame('turn.done', { reply: '换一个' })],
    ])
    const { sink } = sinkOf()
    await runTurn(inputOf(advance), sink)

    // 不送的话服务端那次调用永远没有答复，下一轮会被端点判成不合法
    expect(bodies[1]?.tool_results).toEqual([
      { call_id: 'w1', error: '这个槽不存在' },
    ])
  })

  it('这一页没实现的工具也回一条失败，不是把异常抛给调用方', async () => {
    setSurface({
      kind: 'dashboard-editor',
      label: '大屏编辑器',
      snapshot: () => ({}),
      tools: [],
      run: vi.fn(),
    })
    const { advance, bodies } = advanceOf([
      [
        frame('client_tool.request', {
          calls: [
            { call_id: 'w1', name: 'dashboard.write_binding', arguments: {} },
          ],
        }),
      ],
      [frame('turn.done', { reply: '那我换一个' })],
    ])
    const { sink, seen } = sinkOf()
    await runTurn(inputOf(advance), sink)

    expect(bodies[1]?.tool_results?.[0]?.error).toContain(
      'dashboard.write_binding',
    )
    expect(seen.errors).toEqual([])
  })

  it('回合内失败落成一条错，并且就此停住', async () => {
    const { advance, bodies } = advanceOf([
      [frame('error', { code: 52202, message: '模型暂时不可用' })],
      [frame('turn.done', { reply: '不该走到这' })],
    ])
    const { sink, seen } = sinkOf()
    await runTurn(inputOf(advance), sink)

    expect(seen.errors).toEqual(['模型暂时不可用'])
    expect(bodies).toHaveLength(1)
  })

  it('来回不完就停下并说出来', async () => {
    setSurface({
      kind: 'dashboard-editor',
      label: '大屏编辑器',
      snapshot: () => ({}),
      tools: ['dashboard.read_canvas'],
      run: vi.fn().mockResolvedValue(null),
    })
    const forever = [
      frame('client_tool.request', {
        calls: [
          { call_id: 'r1', name: 'dashboard.read_canvas', arguments: {} },
        ],
      }),
    ]
    const { advance } = advanceOf(
      Array.from({ length: MAX_ROUNDS + 2 }, () => forever),
    )
    const { sink, seen } = sinkOf()
    await runTurn(inputOf(advance), sink)

    // 模型绕进死循环时每一步都合理，只有总轮数拦得住它
    expect(seen.errors).toHaveLength(1)
    expect(seen.errors[0]).toContain(String(MAX_ROUNDS))
  })

  it('形状不对的待办直接跳过，不当成一次调用', async () => {
    const { advance } = advanceOf([
      [
        frame('client_tool.request', {
          calls: [{ name: '' }, 'not-an-object'],
        }),
        frame('turn.done', { reply: '没事了' }),
      ],
    ])
    const { sink, seen } = sinkOf()
    await runTurn(inputOf(advance), sink)

    expect(seen.ran).toEqual([])
    expect(seen.replies).toEqual(['没事了'])
  })

  it('模型的话与它想的过程分两路交出去', async () => {
    const { advance } = advanceOf([
      [
        frame('message.delta', { channel: 'reasoning', text: '先查点位' }),
        frame('message.delta', { channel: 'text', text: '好的' }),
        frame('message.delta', { channel: 'text', text: '，我来绑' }),
        frame('turn.done', { reply: '好的，我来绑' }),
      ],
    ])
    const { sink, seen } = sinkOf()
    await runTurn(inputOf(advance), sink)

    // 混成一路的话，界面只能把自言自语和结论一起铺出来
    expect(seen.thought).toEqual(['先查点位'])
    expect(seen.said.join('')).toBe('好的，我来绑')
  })

  it('每一轮都带上这一屏此刻的样子', async () => {
    let selected = 'n1'
    setSurface({
      kind: 'dashboard-editor',
      label: '大屏编辑器',
      snapshot: () => ({ selected_id: selected }),
      tools: ['dashboard.read_canvas'],
      run: vi.fn().mockImplementation(() => {
        selected = 'n2'
        return Promise.resolve(null)
      }),
    })
    const { advance, bodies } = advanceOf([
      [
        frame('client_tool.request', {
          calls: [
            { call_id: 'r1', name: 'dashboard.read_canvas', arguments: {} },
          ],
        }),
      ],
      [frame('turn.done', { reply: '看完了' })],
    ])
    const { sink } = sinkOf()
    await runTurn(inputOf(advance), sink)

    // 只在第一轮带的话，助手动过两下之后读到的是一屏过期的画布
    expect(bodies[0]?.surface_context).toEqual({ selected_id: 'n1' })
    expect(bodies[1]?.surface_context).toEqual({ selected_id: 'n2' })
  })

  it('客户端工具跑完记成步骤，成败分得开', async () => {
    setSurface({
      kind: 'dashboard-editor',
      label: '大屏编辑器',
      snapshot: () => ({}),
      tools: ['dashboard.write_binding'],
      run: vi.fn().mockRejectedValue(new Error('这个槽不存在')),
    })
    const { advance } = advanceOf([
      [
        frame('client_tool.request', {
          calls: [
            { call_id: 'w1', name: 'dashboard.write_binding', arguments: {} },
          ],
        }),
      ],
      [frame('turn.done', { reply: '换一个' })],
    ])
    const { sink, seen } = sinkOf()
    await runTurn(inputOf(advance), sink)

    // 服务端看不见客户端工具——不记的话，一次绑二十个点在界面上是一片空白
    expect(seen.ran).toHaveLength(1)
    expect(seen.ran[0]?.state).toBe('failed')
    expect(seen.ran[0]?.error).toBe('这个槽不存在')
  })
})
