/**
 * @fileoverview 时间线上「工具调用被写成正文」那一段不许显示出来。
 *
 * ⚠ 这一条必须**真挂载**：过滤是在模板里接上去的，而模板里 prop 名写错、
 * 或者干脆忘了接，typecheck 与 lint 双双放行（见 [[vue-props-slots-unchecked]]）。
 * 纯函数那一层已经在 `features/ai/toolCallText.test.ts` 里守着了，这里守的是
 * 「它真的被接上了」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AiTimeline from '@/components/ai/AiTimeline.vue'
import type { ChatEntry } from '@/features/ai/conversationLog'

const WRITTEN = [
  '先看看原文。',
  '<tool_call>',
  '<function=kb.read_chunk>',
  '<parameter=chunk_id>01a069c3</parameter>',
  '</function>',
  '</tool_call>',
].join('\n')

function timelineOf(entries: ChatEntry[]) {
  return mount(AiTimeline, { props: { entries } })
}

describe('工具调用块不上屏', () => {
  it('助手那一条只留人话', () => {
    const wrapper = timelineOf([{ id: 'e1', role: 'assistant', text: WRITTEN }])

    expect(wrapper.text()).toContain('先看看原文。')
    expect(wrapper.text()).not.toContain('<tool_call>')
    expect(wrapper.text()).not.toContain('kb.read_chunk')
  })

  it('思考那一路也一样——服务端从不捡它，只能在这里挡', () => {
    const wrapper = timelineOf([{ id: 'e1', role: 'reasoning', text: WRITTEN }])

    expect(wrapper.text()).not.toContain('<tool_call>')
  })

  it('整条都是块时不占一个空气泡', () => {
    const wrapper = timelineOf([
      { id: 'e1', role: 'assistant', text: '<tool_call>x</tool_call>' },
    ])

    expect(wrapper.find('.ai-said').exists()).toBe(false)
  })

  it('正常那一条一个字都不动', () => {
    const wrapper = timelineOf([
      { id: 'e1', role: 'assistant', text: '上限是 65 ℃。' },
    ])

    expect(wrapper.text()).toContain('上限是 65 ℃。')
  })
})
