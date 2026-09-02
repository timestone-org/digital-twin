/**
 * @fileoverview 知识库对话的回合门面：信封里没有工作面、只自报 `user.ask`、
 * 反问停下来等人、回填之后接着跑。内核的规矩由助手那份用例守，这里只验门面。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { ASSISTANT_ASK_TOOL, type KnowledgeChatAdvanceIn } from '@dt/contracts'

import { __resetAskHandler, setAskHandler } from '@/features/ai/askBridge'
import type { RunnerStep } from '@/features/ai/turnLoop'
import {
  MAX_ROUNDS,
  runKnowledgeTurn,
  type KnowledgeRunnerSink,
} from '@/features/knowledgeChat/turnRunner'

function frame(name: string, body: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`
}

const DONE = frame('turn.done', { reply: '上限 65 ℃ [1]' })

function askFrame(callId = 'q1'): string {
  return frame('client_tool.request', {
    calls: [
      {
        call_id: callId,
        name: ASSISTANT_ASK_TOOL,
        arguments: {
          question: '哪台锅炉？',
          options: [
            { value: 'k1', label: '1 号' },
            { value: 'k2', label: '2 号' },
          ],
        },
      },
    ],
  })
}

function advanceOf(script: string[][]): {
  advance: (
    sessionId: string,
    body: KnowledgeChatAdvanceIn,
  ) => AsyncGenerator<string>
  bodies: KnowledgeChatAdvanceIn[]
} {
  const bodies: KnowledgeChatAdvanceIn[] = []
  async function* advance(
    _sessionId: string,
    body: KnowledgeChatAdvanceIn,
  ): AsyncGenerator<string> {
    const round = bodies.length
    bodies.push(body)
    for (const chunk of script[round] ?? []) {
      await Promise.resolve()
      yield chunk
    }
  }
  return { advance, bodies }
}

function sinkOf(): {
  sink: KnowledgeRunnerSink
  replies: string[]
  errors: string[]
  steps: RunnerStep[]
} {
  const replies: string[] = []
  const errors: string[] = []
  const steps: RunnerStep[] = []
  return {
    replies,
    errors,
    steps,
    sink: {
      onDelta: () => undefined,
      onStep: (step) => steps.push(step),
      onToolsRun: (ran) => steps.push(...ran),
      onDone: (reply) => replies.push(reply),
      onError: (message) => errors.push(message),
      onNote: () => undefined,
    },
  }
}

afterEach(() => {
  __resetAskHandler()
})

describe('知识库对话的回合门面', () => {
  it('信封里只有自报的工具，没有工作面', async () => {
    // ⚠ 知识库那边的入参是 extra="forbid"：多一格 surface_kind 整个回合就是 400
    const { advance, bodies } = advanceOf([[DONE]])
    const { sink, replies } = sinkOf()

    await runKnowledgeTurn(
      { advance, sessionId: 's1', userText: '上限多少' },
      sink,
    )

    expect(replies).toEqual(['上限 65 ℃ [1]'])
    expect(bodies[0]).toEqual({
      client_tools: [ASSISTANT_ASK_TOOL],
      user_text: '上限多少',
    })
    expect(bodies[0]).not.toHaveProperty('surface_kind')
    expect(bodies[0]).not.toHaveProperty('user_images')
  })

  it('反问：停下来等人，用户选了就带着回执再推进一次', async () => {
    const { advance, bodies } = advanceOf([[askFrame()], [DONE]])
    const { sink, replies } = sinkOf()
    setAskHandler(() =>
      Promise.resolve({ picked: ['k1'], free_text: null, is_cancelled: false }),
    )

    await runKnowledgeTurn(
      { advance, sessionId: 's1', userText: '上限多少' },
      sink,
    )

    expect(replies).toEqual(['上限 65 ℃ [1]'])
    expect(bodies).toHaveLength(2)
    expect(bodies[1]?.tool_results).toEqual([
      {
        call_id: 'q1',
        output: { picked: ['k1'], free_text: null, is_cancelled: false },
      },
    ])
    expect(bodies[1]).not.toHaveProperty('user_text')
  })

  it('这一页没有工作面：模型要一个别的客户端工具时如实回失败', async () => {
    // ⚠ 失败也要送回去，不送的话那次调用永远没有答复
    const { advance, bodies } = advanceOf([
      [
        frame('client_tool.request', {
          calls: [{ call_id: 'c1', name: 'dashboard.save', arguments: {} }],
        }),
      ],
      [DONE],
    ])
    const { sink } = sinkOf()

    await runKnowledgeTurn(
      { advance, sessionId: 's1', userText: '存一下' },
      sink,
    )

    const result = bodies[1]?.tool_results?.[0]
    expect(result?.call_id).toBe('c1')
    expect(result?.error).toContain('dashboard.save')
  })

  it('模型收了嘴就结束，不代用户催', async () => {
    // 知识库对话没有计划子系统：说完就是说完
    const { advance, bodies } = advanceOf([[DONE]])
    const { sink } = sinkOf()

    await runKnowledgeTurn({ advance, sessionId: 's1', userText: '嗯' }, sink)

    expect(bodies).toHaveLength(1)
  })

  it('往返到顶就停下并如实说', async () => {
    setAskHandler(() =>
      Promise.resolve({ picked: [], free_text: null, is_cancelled: true }),
    )
    const script = Array.from({ length: MAX_ROUNDS + 1 }, (_, i) => [
      askFrame(`q${i}`),
    ])
    const { advance } = advanceOf(script)
    const { sink, errors } = sinkOf()

    await runKnowledgeTurn(
      { advance, sessionId: 's1', userText: '一直问' },
      sink,
    )

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(String(MAX_ROUNDS))
  })
})
