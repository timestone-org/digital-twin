/**
 * @fileoverview 对话时间线的长法。
 *
 * **守的是流式与分段那几条规矩**：新来的一小块该接在上一条后面还是另起一条、
 * 步骤插进来要不要断句、回合结束时补不补整段答复。错一次的表现是助手的话被
 * 切成几十个气泡、或者同一段话出现两遍——而这两种都只在真模型逐字吐字时才
 * 复现，本地用假件一次都碰不到。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { AssistantAskRequest } from '@dt/contracts'

import {
  MAX_KEPT_IMAGES,
  __resetEntryIds,
  emptyLog,
  withAnswered,
  withAsk,
  withCitations,
  withDelta,
  withReply,
  SAID_NOTHING,
  withSaid,
  withStep,
  type ConversationLog,
} from '@/features/ai/conversationLog'
import type { RunnerStep } from '@/features/ai/turnRunner'

const STEP: RunnerStep = {
  kind: 'server_tool',
  name: 'points.search',
  state: 'succeeded',
  title: '查了点位',
  error: null,
}

function roles(log: ConversationLog): string[] {
  return log.entries.map((one) => one.role)
}

function texts(log: ConversationLog): string[] {
  return log.entries.map((one) => one.text)
}

beforeEach(() => {
  __resetEntryIds()
})

describe('流式', () => {
  it('同一路的小块接成一条', () => {
    let log = emptyLog()
    log = withDelta(log, 'text', '好的')
    log = withDelta(log, 'text', '，我来绑')

    expect(log.entries).toHaveLength(1)
    expect(texts(log)).toEqual(['好的，我来绑'])
  })

  it('说的话与想的过程各成一条', () => {
    let log = emptyLog()
    log = withDelta(log, 'reasoning', '先查点位')
    log = withDelta(log, 'text', '好的')

    expect(roles(log)).toEqual(['reasoning', 'assistant'])
  })

  it('正在长的那一条带着标记', () => {
    const log = withDelta(emptyLog(), 'text', '好')

    expect(log.entries[0]?.isStreaming).toBe(true)
  })

  it('插进来一步就断句，之后的话另起一条', () => {
    let log = emptyLog()
    log = withDelta(log, 'text', '我先查一下')
    log = withStep(log, STEP)
    log = withDelta(log, 'text', '查到了')

    // 接在旧气泡后面读起来像它在自言自语中途插了个动作
    expect(roles(log)).toEqual(['assistant', 'step', 'assistant'])
  })

  it('空的小块不生出一条空气泡', () => {
    const log = withDelta(emptyLog(), 'text', '')

    expect(log.entries).toEqual([])
  })
})

describe('回合收尾', () => {
  it('流出来过就不再补一遍整段', () => {
    let log = emptyLog()
    log = withDelta(log, 'text', '绑好了')
    log = withReply(log, '绑好了')

    // 补了会让同一段话在界面上出现两遍
    expect(texts(log)).toEqual(['绑好了'])
    expect(log.entries[0]?.isStreaming).toBe(false)
  })

  // ⚠ 这是**真实帧序**：服务端在最后一次作答之后必定发一步「给出答复」，
  // 排在正文之后、`turn.done` 之前。上面那条用例少了这一步，于是漏掉了这个
  // 缺陷——现场表现是同一段答复在界面上出现两遍，而刷新之后反而正常
  // （回放读的是库里那一条）
  it('正文与整段之间夹着「给出答复」那一步，照样不补第二遍', () => {
    let log = emptyLog()
    log = withDelta(log, 'text', '是的，那是一张表格截图。')
    log = withStep(log, {
      kind: 'model',
      name: 'model',
      state: 'succeeded',
      title: '给出答复',
      error: null,
    })
    log = withReply(log, '是的，那是一张表格截图。')

    expect(roles(log)).toEqual(['assistant', 'step'])
    expect(texts(log)).toEqual(['是的，那是一张表格截图。', '给出答复'])
  })

  it('一个字都没流出来时才补上整段', () => {
    // 端点不支持流式、或者部署把流式关了，都会走到这一条
    const log = withReply(emptyLog(), '绑好了')

    expect(roles(log)).toEqual(['assistant'])
    expect(texts(log)).toEqual(['绑好了'])
  })

  // ⚠ 实测小模型会把话全说进思考那一路然后收嘴：回合确实结束了，而界面上
  // 什么都不添的表现是「问完之后什么也没发生」——用户分不清是它在想、是坏了、
  // 还是自己没点上
  it('一个字都没说时留一句话，而不是一片空白', () => {
    const log = withReply(emptyLog(), '')

    expect(roles(log)).toEqual(['note'])
    expect(texts(log)).toEqual([SAID_NOTHING])
  })

  it('流出来过就不会再补那句话——那一轮明明说了', () => {
    let log = emptyLog()
    log = withDelta(log, 'text', '上限 65 ℃')
    log = withReply(log, '')

    expect(roles(log)).toEqual(['assistant'])
  })

  it('收尾会把想的过程那一条也停住', () => {
    let log = emptyLog()
    log = withDelta(log, 'reasoning', '想想')
    log = withReply(log, '好了')

    expect(log.entries[0]?.isStreaming).toBe(false)
  })
})

describe('整条', () => {
  it('「已停下」是一句提示而不是一条错', () => {
    // 用户自己按的停，画成红色会让他以为出了问题
    const log = withSaid(emptyLog(), 'note', '已停下')

    expect(roles(log)).toEqual(['note'])
  })

  it('用户说的话先把正在长的收口', () => {
    let log = emptyLog()
    log = withDelta(log, 'text', '正在说')
    log = withSaid(log, 'user', '停，改一下')

    expect(log.openText).toBeNull()
    expect(roles(log)).toEqual(['assistant', 'user'])
  })
})

describe('截图封顶', () => {
  const SHOT = 'data:image/png;base64,iVBORw0KGgo='

  function withShots(count: number): ConversationLog {
    let log = emptyLog()
    for (let at = 0; at < count; at += 1) {
      log = withStep(log, { ...STEP, name: `capture-${at}`, image: SHOT })
    }
    return log
  }

  it('没到上限时一张都不丢', () => {
    const log = withShots(MAX_KEPT_IMAGES)
    const kept = log.entries.filter((one) => one.step?.image !== undefined)
    expect(kept).toHaveLength(MAX_KEPT_IMAGES)
  })

  it('超出上限时丢的是最早的那几张', () => {
    // ⚠ 一张截图几百 KB。不封顶的话，聊半小时的标签页会吃掉几百兆
    const log = withShots(MAX_KEPT_IMAGES + 2)
    const withImage = log.entries.filter((one) => one.step?.image !== undefined)
    expect(withImage).toHaveLength(MAX_KEPT_IMAGES)
    expect(withImage[0]?.step?.name).toBe('capture-2')
  })

  it('丢掉的那几张留一个记号，不是当作从来没有过', () => {
    const log = withShots(MAX_KEPT_IMAGES + 1)
    const first = log.entries[0]
    expect(first?.step?.image).toBeUndefined()
    expect(first?.step?.isImageDropped).toBe(true)
  })
})

const ASK: AssistantAskRequest = {
  question: '这一格的值从哪来？',
  options: [{ value: 'opcua', label: '实时点位' }],
  allow_multiple: false,
  allow_free_text: false,
  free_text_label: null,
}

describe('提问条目', () => {
  it('摆出来时还没有答案，问题就是这一条的正文', () => {
    const log = withAsk(emptyLog(), 'a1', ASK)
    const entry = log.entries[0]
    expect(entry?.role).toBe('ask')
    expect(entry?.id).toBe('a1')
    expect(entry?.text).toBe('这一格的值从哪来？')
    expect(entry?.ask?.answer).toBeNull()
  })

  it('提问也断句：它之后模型说的话是新的一段', () => {
    // 接在旧气泡后面读起来像它在自言自语中途插了个问题
    const streaming = withDelta(emptyLog(), 'text', '我看了看')
    const log = withAsk(streaming, 'a1', ASK)
    expect(log.openText).toBeNull()
    expect(log.entries[0]?.isStreaming).toBe(false)
  })

  it('答案落回那一条上', () => {
    const log = withAnswered(withAsk(emptyLog(), 'a1', ASK), 'a1', {
      picked: ['opcua'],
      free_text: null,
      is_cancelled: false,
    })
    expect(log.entries[0]?.ask?.answer?.picked).toEqual(['opcua'])
  })

  it('答过的不许再改：结掉与点击同时到时只收得下第一条', () => {
    const once = withAnswered(withAsk(emptyLog(), 'a1', ASK), 'a1', {
      picked: ['opcua'],
      free_text: null,
      is_cancelled: false,
    })
    const twice = withAnswered(once, 'a1', {
      picked: [],
      free_text: null,
      is_cancelled: true,
    })
    expect(twice.entries[0]?.ask?.answer?.is_cancelled).toBe(false)
  })

  it('认不出的 id 原样返回，不误伤别的条目', () => {
    const log = withAnswered(withAsk(emptyLog(), 'a1', ASK), 'a9', {
      picked: [],
      free_text: null,
      is_cancelled: true,
    })
    expect(log.entries[0]?.ask?.answer).toBeNull()
  })
})

describe('引用那一条', () => {
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

  it('添在时间线末尾，自成一条', () => {
    const log = withCitations(withReply(emptyLog(), '上限 65 ℃ ①'), [CITED])
    expect(log.entries).toHaveLength(2)
    const last = log.entries[1]
    expect(last?.role).toBe('citations')
    expect(last?.citations).toEqual([CITED])
    // ⚠ 正文留空：这一条画的是卡片，有正文会在气泡里多出一行空白
    expect(last?.text).toBe('')
  })

  it('一条引用都没有时原样返回', () => {
    // ⚠ 「这次没有引用」与「引用是空的」在界面上是同一件事，而多一张空卡片
    // 会让人以为出了什么问题
    const before = withReply(emptyLog(), '上限 65 ℃')
    expect(withCitations(before, [])).toBe(before)
  })
})
