/**
 * @fileoverview 契约：对话运行态里回放那一扇门。
 *
 * 两条：restore 是**整份替换**（时间线与计划一起换，不是往后拼）；
 * 回合正跑着时 restore 必须纹丝不动——正跑着的流比库里的旧账新，
 * 灌历史会把直播中的步骤整屏抹掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import type { AssistantSessionDetail } from '@dt/contracts'

import {
  useAiConversation,
  type AiConversation,
} from '@/composables/useAiConversation'
import { __resetAiPorts, setAiPorts } from '@/features/ai/ports'

function detailOf(text: string): AssistantSessionDetail {
  return {
    id: 's1',
    user_id: 'u1',
    title: '',
    surface_kind: 'dashboard-editor',
    surface_ref: null,
    is_archived: false,
    row_version: 1,
    last_error: null,
    model_profile: null,
    reasoning_effort: null,
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
    plan_json: {
      title: '计划',
      state: 'active',
      items: [{ title: '第一步', status: 'pending', note: '' }],
    },
  }
}

let scope: EffectScope | null = null

function conversation(): AiConversation {
  scope = effectScope()
  const chat = scope.run(() =>
    useAiConversation(
      () => 's1',
      () => ({ kind: 'dashboard-editor', label: '大屏编辑器' }),
    ),
  )
  if (chat === undefined) throw new Error('对话没造出来')
  return chat
}

afterEach(() => {
  scope?.stop()
  scope = null
  __resetAiPorts()
})

describe('restore', () => {
  it('整份替换时间线并恢复计划', () => {
    const chat = conversation()
    chat.note('先前的一句')
    chat.restore(detailOf('帮我绑点'))
    expect(chat.entries.value.map((one) => [one.role, one.text])).toEqual([
      ['user', '帮我绑点'],
    ])
    expect(chat.plan.value?.title).toBe('计划')
  })

  it('回合正跑着时纹丝不动', async () => {
    setAiPorts({
      // 一条只有掐掉才结束的流：让回合一直停在「正在跑」上
      advance: async function* (_id, _body, signal) {
        yield ''
        await new Promise<void>((resolve) => {
          if (signal?.aborted !== false) {
            resolve()
            return
          }
          signal.addEventListener('abort', () => resolve())
        })
      },
    })
    const chat = conversation()
    const running = chat.send('绑一下')
    await vi.waitFor(() => expect(chat.isRunning.value).toBe(true))
    chat.restore(detailOf('旧账'))
    // 灌历史会把直播中的步骤整屏抹掉
    expect(chat.entries.value.map((one) => one.text)).toEqual(['绑一下'])
    expect(chat.plan.value).toBeNull()
    chat.stop()
    await running
  })
})

describe('流开不起来', () => {
  it('如实说一句并且从「正在跑」上下来', async () => {
    // ⚠ 服务不在、边缘 502、令牌换不动，都从这一条口子出来。不收住的话
    // 界面停在「正在思考」上，而且再也发不出下一句——看着就是卡死
    setAiPorts({
      // eslint-disable-next-line require-yield
      advance: async function* () {
        await Promise.resolve()
        throw new Error('事件流打不开')
      },
    })
    const chat = conversation()

    await chat.send('绑一下')

    expect(chat.entries.value.map((one) => [one.role, one.text])).toEqual([
      ['user', '绑一下'],
      ['error', '事件流打不开'],
    ])
    expect(chat.isRunning.value).toBe(false)
  })
})

describe('流开不起来之后', () => {
  it('下一句照样发得出去', async () => {
    // ⚠ 用户报的就是这一条：看到红字之后再也发不出下一句
    let attempt = 0
    setAiPorts({
      advance: async function* () {
        attempt += 1
        await Promise.resolve()
        if (attempt === 1) throw new Error('事件流打不开')
        yield 'event: turn.done\ndata: {"reply": "好"}\n\n'
      },
    })
    const chat = conversation()

    await chat.send('第一句')
    await chat.send('第二句')

    expect(chat.isRunning.value).toBe(false)
    expect(chat.entries.value.map((one) => [one.role, one.text])).toEqual([
      ['user', '第一句'],
      ['error', '事件流打不开'],
      ['user', '第二句'],
      ['assistant', '好'],
    ])
  })
})

describe('note', () => {
  it('添在时间线末尾，角色是 note', () => {
    const chat = conversation()
    chat.note('没能读回历史')
    expect(chat.entries.value.map((one) => [one.role, one.text])).toEqual([
      ['note', '没能读回历史'],
    ])
  })
})
