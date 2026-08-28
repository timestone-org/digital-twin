/**
 * @fileoverview 提问队列：摆到时间线上、等用户点、掐掉时收口。
 *
 * 守的是那条只在真会话里才现形的规矩——**挂着的提问必须能被结掉**。
 * 不结的话回合永远停在那次 await 上：界面既不动也不报错，输入框一直禁着，
 * 用户只能刷新页面。而这一条在假件里跑不出来：假件都是当场就回的。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { AssistantAskRequest } from '@dt/contracts'

import { __resetAskHandler, askUser } from '@/features/ai/askBridge'
import { __resetAskIds, createAskQueue } from '@/features/ai/askQueue'
import {
  emptyLog,
  __resetEntryIds,
  type ConversationLog,
} from '@/features/ai/conversationLog'

const REQUEST: AssistantAskRequest = {
  question: '这一格的值从哪来？',
  options: [
    { value: 'opcua', label: '实时点位' },
    { value: 'dataset', label: '台账列' },
  ],
  allow_multiple: false,
  allow_free_text: false,
  free_text_label: null,
}

function bench() {
  const log = ref<ConversationLog>(emptyLog())
  const isAsking = ref(false)
  const queue = createAskQueue({
    edit: (next) => {
      log.value = next(log.value)
    },
    isAsking,
  })
  return { log, isAsking, queue }
}

afterEach(() => {
  __resetAskHandler()
  __resetAskIds()
  __resetEntryIds()
})

describe('提问队列', () => {
  it('问一句就在时间线上摆一条，并把输入框锁上', async () => {
    const { log, isAsking } = bench()
    void askUser(REQUEST)
    await Promise.resolve()

    const entry = log.value.entries.at(-1)
    expect(entry?.role).toBe('ask')
    expect(entry?.text).toBe('这一格的值从哪来？')
    expect(entry?.ask?.answer).toBeNull()
    expect(isAsking.value).toBe(true)
  })

  it('用户点了才 resolve，答案落回那一条上', async () => {
    const { log, isAsking, queue } = bench()
    const pending = askUser(REQUEST)
    await Promise.resolve()

    const id = log.value.entries.at(-1)?.id ?? ''
    queue.answer(id, {
      picked: ['opcua'],
      free_text: null,
      is_cancelled: false,
    })

    await expect(pending).resolves.toEqual({
      picked: ['opcua'],
      free_text: null,
      is_cancelled: false,
    })
    expect(log.value.entries.at(-1)?.ask?.answer?.picked).toEqual(['opcua'])
    expect(isAsking.value).toBe(false)
  })

  it('掐掉时挂着的提问被结成取消，回合接着往下走', async () => {
    const { log, isAsking, queue } = bench()
    const pending = askUser(REQUEST)
    await Promise.resolve()

    queue.cancelAll()

    // 取消是正常回执不是失败：抛出去模型会去排查「工具坏了」
    await expect(pending).resolves.toEqual({
      picked: [],
      free_text: null,
      is_cancelled: true,
    })
    expect(log.value.entries.at(-1)?.ask?.answer?.is_cancelled).toBe(true)
    expect(isAsking.value).toBe(false)
  })

  it('两条一起挂着时一并结掉', async () => {
    const { isAsking, queue } = bench()
    const first = askUser(REQUEST)
    const second = askUser(REQUEST)
    await Promise.resolve()

    queue.cancelAll()

    await expect(first).resolves.toMatchObject({ is_cancelled: true })
    await expect(second).resolves.toMatchObject({ is_cancelled: true })
    expect(isAsking.value).toBe(false)
  })

  it('答过的再答一次不算数：结掉与点击同时到时只收得下第一条', async () => {
    const { log, queue } = bench()
    const pending = askUser(REQUEST)
    await Promise.resolve()
    const id = log.value.entries.at(-1)?.id ?? ''

    queue.answer(id, {
      picked: ['opcua'],
      free_text: null,
      is_cancelled: false,
    })
    queue.cancelAll()

    await expect(pending).resolves.toMatchObject({ is_cancelled: false })
    expect(log.value.entries.at(-1)?.ask?.answer?.is_cancelled).toBe(false)
  })

  it('认不出的 id 一律忽略：回放出来的卡片没有人在等', async () => {
    const { log, queue } = bench()
    void askUser(REQUEST)
    await Promise.resolve()

    expect(() =>
      queue.answer('a-nope', {
        picked: [],
        free_text: null,
        is_cancelled: true,
      }),
    ).not.toThrow()
    expect(log.value.entries.at(-1)?.ask?.answer).toBeNull()
  })

  it('撤掉处理器之后没人接，问一句直接回取消', async () => {
    const { queue } = bench()
    queue.detach()
    await expect(askUser(REQUEST)).resolves.toMatchObject({
      is_cancelled: true,
    })
  })

  it('提问的 id 与时间线自己的 id 撞不到一起', async () => {
    const { log } = bench()
    void askUser(REQUEST)
    await Promise.resolve()
    expect(log.value.entries.at(-1)?.id).toMatch(/^a\d+$/)
  })
})
