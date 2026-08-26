/**
 * @fileoverview 对话时间线的长法。
 *
 * **守的是流式与分段那几条规矩**：新来的一小块该接在上一条后面还是另起一条、
 * 步骤插进来要不要断句、回合结束时补不补整段答复。错一次的表现是助手的话被
 * 切成几十个气泡、或者同一段话出现两遍——而这两种都只在真模型逐字吐字时才
 * 复现，本地用假件一次都碰不到。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  MAX_KEPT_IMAGES,
  __resetEntryIds,
  emptyLog,
  withDelta,
  withReply,
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

  it('一个字都没流出来时才补上整段', () => {
    // 端点不支持流式、或者部署把流式关了，都会走到这一条
    const log = withReply(emptyLog(), '绑好了')

    expect(roles(log)).toEqual(['assistant'])
    expect(texts(log)).toEqual(['绑好了'])
  })

  it('答复是空串时什么都不添', () => {
    expect(withReply(emptyLog(), '').entries).toEqual([])
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
