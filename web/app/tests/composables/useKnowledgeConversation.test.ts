/**
 * @fileoverview 知识库对话的运行态：发话进时间线、反问锁输入、停下留一条、
 * 回放整份替换且正跑着时不动。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import {
  ASSISTANT_ASK_TOOL,
  type KnowledgeChatSessionDetail,
} from '@dt/contracts'

import {
  useKnowledgeConversation,
  type KnowledgeConversation,
} from '@/composables/useKnowledgeConversation'
import { __resetAskHandler } from '@/features/ai/askBridge'

function frame(name: string, body: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`
}

function detailOf(text: string): KnowledgeChatSessionDetail {
  return {
    id: 's1',
    user_id: 'u1',
    title: '',
    is_archived: false,
    row_version: 1,
    last_error: null,
    created_at: '',
    updated_at: '',
    messages: [
      {
        id: 'm1',
        session_id: 's1',
        seq: 1,
        role: 'user',
        content_json: { text },
        usage_json: null,
        steps: [],
        created_at: '',
      },
    ],
  }
}

/**
 * 一个按剧本吐帧的推进面：`script[n]` 是第 n 次推进吐的帧。
 * ⚠ 每一轮的流都要**结束**：内核读到流结束才派发那一批客户端工具，卡着不结束
 * 的话反问永远摆不上时间线。`gate` 给了就让最后一轮停在那儿等人放行。
 */
function advanceOf(script: string[][], gate?: Promise<void>) {
  let round = 0
  async function* advance(): AsyncGenerator<string> {
    const frames = script[round] ?? []
    round += 1
    for (const one of frames) {
      await Promise.resolve()
      yield one
    }
    if (gate !== undefined && round >= script.length) await gate
  }
  return advance
}

let scope: EffectScope | null = null

function conversation(
  advance: () => AsyncGenerator<string>,
): KnowledgeConversation {
  scope = effectScope()
  const chat = scope.run(() => useKnowledgeConversation(() => 's1', advance))
  if (chat === undefined) throw new Error('对话没造出来')
  return chat
}

afterEach(() => {
  scope?.stop()
  scope = null
  __resetAskHandler()
})

describe('知识库对话的运行态', () => {
  it('发一句：自己说的立刻上时间线，答复流完落成助手的一条', async () => {
    const chat = conversation(
      advanceOf([
        [
          frame('message.delta', { channel: 'text', text: '上限 ' }),
          frame('message.delta', { channel: 'text', text: '65 ℃' }),
          frame('turn.done', { reply: '上限 65 ℃' }),
        ],
      ]),
    )

    await chat.send('上限多少')

    const roles = chat.entries.value.map((one) => one.role)
    expect(roles).toEqual(['user', 'assistant'])
    expect(chat.entries.value[1]?.text).toBe('上限 65 ℃')
    expect(chat.isRunning.value).toBe(false)
  })

  it('反问：卡片摆上时间线、输入上锁；用户点了就解锁并继续', async () => {
    const chat = conversation(
      advanceOf([
        [
          frame('client_tool.request', {
            calls: [
              {
                call_id: 'q1',
                name: ASSISTANT_ASK_TOOL,
                arguments: {
                  question: '哪台？',
                  options: [
                    { value: 'k1', label: '1 号' },
                    { value: 'k2', label: '2 号' },
                  ],
                },
              },
            ],
          }),
        ],
        [frame('turn.done', { reply: '1 号上限 65 ℃' })],
      ]),
    )

    const sending = chat.send('上限多少')
    await vi.waitFor(() => expect(chat.isAsking.value).toBe(true))

    const ask = chat.entries.value.find((one) => one.role === 'ask')
    expect(ask?.ask?.answer).toBeNull()
    expect(chat.isAsking.value).toBe(true)

    chat.answerAsk(ask?.id ?? '', {
      picked: ['k1'],
      free_text: null,
      is_cancelled: false,
    })
    await sending

    expect(chat.isAsking.value).toBe(false)
    expect(chat.entries.value.at(-1)?.text).toBe('1 号上限 65 ℃')
  })

  it('停下：挂着的提问结成取消，时间线上留一句「已停下」', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const chat = conversation(advanceOf([[]], gate))

    const sending = chat.send('问')
    await Promise.resolve()
    chat.stop()
    release()
    await sending

    expect(chat.isRunning.value).toBe(false)
    expect(chat.entries.value.at(-1)?.text).toBe('已停下')
  })

  it('回放整份替换时间线', () => {
    const chat = conversation(advanceOf([[]]))
    chat.note('先前的一句')

    chat.restore(detailOf('库里那句'))

    expect(chat.entries.value.map((one) => one.text)).toEqual(['库里那句'])
  })

  it('正跑着回合时回放纹丝不动', async () => {
    // ⚠ 正跑着的流比库里的旧账新，灌历史会把直播中的步骤整屏抹掉
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const chat = conversation(advanceOf([[]], gate))

    const sending = chat.send('直播中')
    await Promise.resolve()
    chat.restore(detailOf('库里那句'))

    expect(chat.entries.value.map((one) => one.text)).toEqual(['直播中'])
    release()
    await sending
  })
})
