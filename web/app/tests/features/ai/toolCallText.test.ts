/**
 * @fileoverview 写进正文的工具调用块不许显示出来。
 *
 * 服务端会把认得的那些捡回成真调用并从消息里摘掉（`llmcore/textcalls.py`），
 * 走到这一层的是它没捡的那些——名字不在这一轮发下去的工具里、或者写在思考
 * 那一路。显示成一坨尖括号对用户毫无意义。
 */
import { describe, expect, it } from 'vitest'

import { withoutToolCallBlocks } from '@/features/ai/toolCallText'

const REAL = [
  '根据检索结果，内容太简略，需要看更多原文。',
  '',
  '<tool_call>',
  '<function=kb.read_chunk>',
  '<parameter=chunk_id>',
  '01a069c3-c4e7-7795-b862-a5cf4785e10c',
  '</parameter>',
  '</function>',
  '</tool_call>',
].join('\n')

describe('工具调用块不进显示', () => {
  it('成对的那种整块摘掉，人话留着', () => {
    expect(withoutToolCallBlocks(REAL)).toBe(
      '根据检索结果，内容太简略，需要看更多原文。',
    )
  })

  // ⚠ 逐字流出来的那几秒里块一直是半截的：不摘的话，用户眼睁睁看着一串尖
  // 括号一个字一个字长出来，而那正是最难看的一段
  it('还没闭合的那半截也摘掉', () => {
    const half = '先看看原文。\n\n<tool_call>\n<function=kb.re'

    expect(withoutToolCallBlocks(half)).toBe('先看看原文。')
  })

  it('一条里有好几块时逐块摘，中间的话留着', () => {
    const many = '甲<tool_call>a</tool_call>乙<tool_call>b</tool_call>丙'

    expect(withoutToolCallBlocks(many)).toBe('甲乙丙')
  })

  // ⚠ 没有块时原样返回同一个字符串：每来一个字都重算一遍，多造一份只是让
  // 流式那一条每帧都换引用
  it('没有块时原样返回，连引用都不换', () => {
    const plain = '上限是 65 ℃。①'

    expect(withoutToolCallBlocks(plain)).toBe(plain)
  })

  it('整条都是块时剩下空串——那一条不该占一个气泡', () => {
    expect(withoutToolCallBlocks('<tool_call>x</tool_call>')).toBe('')
  })
})
