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

  it('自动起名那一帧摊开交给页面', async () => {
    // ⚠ 只有首轮会来这一帧：起过名的会话后端不再起
    const titled = frame('session_titled', {
      title: '冷却水运行参数',
      row_version: 2,
    })
    const { advance } = advanceOf([[titled, DONE]])
    const { sink } = sinkOf()
    const seen: Array<[string, number]> = []
    await runKnowledgeTurn(
      {
        advance,
        sessionId: 's1',
        userText: '冷凝器上限',
        onTitled: (title, version) => seen.push([title, version]),
      },
      sink,
    )
    expect(seen).toEqual([['冷却水运行参数', 2]])
  })

  it('标题为空的那一帧一律不改清单', async () => {
    // ⚠ 拿空标题去改清单，那一行会变成一片空白——比「未命名」更难认
    const { advance } = advanceOf([
      [frame('session_titled', { title: '', row_version: 3 }), DONE],
    ])
    const { sink } = sinkOf()
    const seen: string[] = []
    await runKnowledgeTurn(
      {
        advance,
        sessionId: 's1',
        userText: '问一句',
        onTitled: (title) => seen.push(title),
      },
      sink,
    )
    expect(seen).toEqual([])
  })

  it('行版本不是数字时退成 0，不写断言', async () => {
    // ⚠ 这一帧来自后端，而给后端数据写 `as` 断言是被闸门拦的：逐格判类型
    const { advance } = advanceOf([
      [frame('session_titled', { title: '有标题', row_version: '2' }), DONE],
    ])
    const { sink } = sinkOf()
    const seen: number[] = []
    await runKnowledgeTurn(
      {
        advance,
        sessionId: 's1',
        userText: '问一句',
        onTitled: (_title, version) => seen.push(version),
      },
      sink,
    )
    expect(seen).toEqual([0])
  })
})

describe('引用那一帧', () => {
  const CITED = {
    marker: '①',
    chunk_id: 'c1',
    document_id: 'd1',
    document_title: '冷却水操作规程.pdf',
    base_name: '手册库',
    heading_path: '二、运行参数',
    where: '第 3 页',
    page: 3,
    page_end: null,
    text: '出口温度不得高于 65 ℃',
    figures: [],
  }

  it('摊开交给页面', async () => {
    const { advance } = advanceOf([
      [frame('citations', { items: [CITED] }), DONE],
    ])
    const { sink, replies } = sinkOf()
    const cited: unknown[][] = []

    await runKnowledgeTurn(
      {
        advance,
        sessionId: 's1',
        userText: '上限多少',
        onCited: (items) => cited.push([...items]),
      },
      sink,
    )

    expect(replies).toEqual(['上限 65 ℃ [1]'])
    expect(cited).toEqual([[CITED]])
  })

  it('少一格必需字段的那条不要', async () => {
    // ⚠ 只认必需的那几格：少一格就画不出那一行，而画一半比不画更难查
    const { advance } = advanceOf([
      [
        frame('citations', {
          items: [CITED, { marker: '②', chunk_id: 'c2' }],
        }),
        DONE,
      ],
    ])
    const { sink } = sinkOf()
    const cited: unknown[][] = []

    await runKnowledgeTurn(
      {
        advance,
        sessionId: 's1',
        userText: '上限多少',
        onCited: (items) => cited.push([...items]),
      },
      sink,
    )

    expect(cited).toEqual([[CITED]])
  })

  it('items 不是数组就当没有这一帧', async () => {
    const { advance } = advanceOf([
      [frame('citations', { items: '一堆' }), DONE],
    ])
    const { sink } = sinkOf()
    const cited: unknown[][] = []

    await runKnowledgeTurn(
      {
        advance,
        sessionId: 's1',
        userText: '上限多少',
        onCited: (items) => cited.push([...items]),
      },
      sink,
    )

    expect(cited).toEqual([])
  })

  it('一条都不合格时不叫回调', async () => {
    // ⚠ 不叫：空数组会让时间线上多一张空引用卡片，而那看着像出了问题
    const { advance } = advanceOf([
      [frame('citations', { items: [{ marker: '②' }] }), DONE],
    ])
    const { sink } = sinkOf()
    const cited: unknown[][] = []

    await runKnowledgeTurn(
      {
        advance,
        sessionId: 's1',
        userText: '上限多少',
        onCited: (items) => cited.push([...items]),
      },
      sink,
    )

    expect(cited).toEqual([])
  })
})
