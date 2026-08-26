/**
 * @fileoverview 库里的历史回放成时间线的规矩。
 *
 * 守的是几条容易静默漂掉的映射：循环代发的「（自动继续）」催促要回放成 note
 * 而不是用户的话（否则历史里像用户自己在念咒）；工具消息不回放（那是模型的
 * 输入）；步骤标题库里不存，回放时要用名字与状态凑出来。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  AssistantMessage,
  AssistantSessionDetail,
  AssistantStep,
} from '@dt/contracts'

import { __resetEntryIds } from '@/features/ai/conversationLog'
import { AUTO_CONTINUE_PREFIX, replayedLog } from '@/features/ai/replayLog'
import { PLAN_CONTINUE_TEXT } from '@/features/ai/turnRunner'

function stepOf(partial: Partial<AssistantStep> = {}): AssistantStep {
  return {
    id: 'st1',
    message_id: 'm1',
    seq: 1,
    kind: 'server_tool',
    name: 'points.search',
    state: 'succeeded',
    input_json: null,
    output_json: null,
    error: null,
    started_at: null,
    ended_at: null,
    created_at: '',
    ...partial,
  }
}

function messageOf(partial: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: 'm1',
    session_id: 's1',
    seq: 1,
    role: 'user',
    content_json: { text: '帮我绑点' },
    usage_json: null,
    steps: [],
    created_at: '',
    ...partial,
  }
}

function detailOf(messages: AssistantMessage[]): AssistantSessionDetail {
  return {
    id: 's1',
    user_id: 'u1',
    title: '',
    surface_kind: 'dashboard-editor',
    surface_ref: null,
    is_archived: false,
    row_version: 1,
    last_error: null,
    created_at: '',
    updated_at: '',
    messages,
    plan_json: null,
  }
}

beforeEach(() => {
  __resetEntryIds()
})

describe('各 role 的映射', () => {
  it('用户说的回放成 user，助手说的回放成 assistant', () => {
    const log = replayedLog(
      detailOf([
        messageOf({ seq: 1 }),
        messageOf({
          id: 'm2',
          seq: 2,
          role: 'assistant',
          content_json: { text: '好的' },
        }),
      ]),
    )
    expect(log.entries.map((one) => [one.role, one.text])).toEqual([
      ['user', '帮我绑点'],
      ['assistant', '好的'],
    ])
  })

  it('助手消息先摆步骤再摆正文', () => {
    const log = replayedLog(
      detailOf([
        messageOf({
          role: 'assistant',
          content_json: { text: '绑好了' },
          steps: [stepOf(), stepOf({ id: 'st2', seq: 2, name: 'points.bind' })],
        }),
      ]),
    )
    expect(log.entries.map((one) => one.role)).toEqual([
      'step',
      'step',
      'assistant',
    ])
  })

  it('助手正文为空时只回放步骤，不生出空气泡', () => {
    const log = replayedLog(
      detailOf([
        messageOf({ role: 'assistant', content_json: {}, steps: [stepOf()] }),
      ]),
    )
    expect(log.entries.map((one) => one.role)).toEqual(['step'])
  })

  it('工具消息不回放：工具结果是模型的输入，不是给人看的', () => {
    const log = replayedLog(
      detailOf([
        messageOf({ role: 'tool', content_json: { text: '{"ok":true}' } }),
      ]),
    )
    expect(log.entries).toEqual([])
  })
})

describe('自动继续的催促', () => {
  it('「（自动继续）」开头的用户消息回放成 note，不是用户的话', () => {
    const log = replayedLog(
      detailOf([messageOf({ content_json: { text: PLAN_CONTINUE_TEXT } })]),
    )
    expect(log.entries.map((one) => one.role)).toEqual(['note'])
  })

  it('识别的前缀确实是 turnRunner 催促用语的开头（漂开这条映射就失灵）', () => {
    expect(PLAN_CONTINUE_TEXT.startsWith(AUTO_CONTINUE_PREFIX)).toBe(true)
  })
})

describe('步骤标题', () => {
  it('库里不存标题，用名字与状态凑一句', () => {
    const log = replayedLog(
      detailOf([
        messageOf({
          role: 'assistant',
          content_json: {},
          steps: [
            stepOf(),
            stepOf({ id: 'st2', seq: 2, state: 'failed', error: '点位不存在' }),
            stepOf({ id: 'st3', seq: 3, state: 'awaiting_client' }),
          ],
        }),
      ]),
    )
    expect(log.entries.map((one) => one.text)).toEqual([
      'points.search 跑完了',
      'points.search 没跑成',
      'points.search 没跑完',
    ])
    expect(log.entries[1]?.step?.error).toBe('点位不存在')
  })

  it('名字缺失时退回种类，不出现空标题', () => {
    const log = replayedLog(
      detailOf([
        messageOf({
          role: 'assistant',
          content_json: {},
          steps: [stepOf({ name: '', kind: 'model' })],
        }),
      ]),
    )
    expect(log.entries[0]?.text).toBe('model 跑完了')
  })
})

describe('坏形状防御', () => {
  it('content_json 里没有文本或不是字符串时整条跳过，不渲染 undefined', () => {
    const log = replayedLog(
      detailOf([
        messageOf({ content_json: {} }),
        messageOf({ id: 'm2', seq: 2, content_json: { text: 42 } }),
      ]),
    )
    expect(log.entries).toEqual([])
  })

  it('认不出的 role 一律不回放', () => {
    const log = replayedLog(
      detailOf([
        messageOf({ role: 'system', content_json: { text: '提示词' } }),
      ]),
    )
    expect(log.entries).toEqual([])
  })
})

describe('回放里的入参与产出', () => {
  it('库里存的那两格照样展得开', () => {
    // 不带回来的话，历史里的每一步都只剩一句标题，出错当场最该看的东西没了
    const log = replayedLog(
      detailOf([
        messageOf({
          role: 'assistant',
          content_json: { text: '好了' },
          steps: [
            stepOf({
              input_json: { q: '温度' },
              output_json: { body: '命中 3 条' },
            }),
          ],
        }),
      ]),
    )
    const step = log.entries.find((one) => one.role === 'step')?.step
    expect(step?.input).toEqual({ q: '温度' })
    expect(step?.output).toBe('命中 3 条')
  })

  it('回放里没有截图——它本来就不落库', () => {
    const log = replayedLog(
      detailOf([
        messageOf({
          role: 'assistant',
          content_json: { text: '看完了' },
          steps: [stepOf({ kind: 'client_tool', name: 'dashboard.capture' })],
        }),
      ]),
    )
    const step = log.entries.find((one) => one.role === 'step')?.step
    expect(step?.image).toBeUndefined()
  })
})
