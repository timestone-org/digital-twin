/**
 * @fileoverview 契约：提问卡片上点一下就是答案，取消也是答案，答完就地收起。
 *
 * ⚠ 模板里的 prop 名与事件名写错时 typecheck 与 lint 双双放行——卡片不发
 * `answer` 的表现是「点了没反应」，而回合正停在那次 await 上，界面既不动
 * 也不报错。这几条挂载着点的用例是唯一兜得住的地方。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AssistantAskAnswer, AssistantAskRequest } from '@dt/contracts'
import { DtInput } from '@dt/ui'

import AiAskCard from '@/components/ai/AiAskCard.vue'
import type { AskEntry } from '@/features/ai/conversationLog'

function request(
  overrides: Partial<AssistantAskRequest> = {},
): AssistantAskRequest {
  return {
    question: '这一格的值从哪来？',
    options: [
      { value: 'opcua', label: '实时点位', hint: '直接读采集' },
      { value: 'dataset', label: '台账列' },
    ],
    allow_multiple: false,
    allow_free_text: false,
    free_text_label: null,
    ...overrides,
  }
}

function entry(
  overrides: Partial<AskEntry> = {},
  requestOverrides: Partial<AssistantAskRequest> = {},
): AskEntry {
  return { request: request(requestOverrides), answer: null, ...overrides }
}

function mountCard(ask: AskEntry) {
  return mount(AiAskCard, { props: { ask } })
}

/** 卡片发出来的那几条回答。 */
function answers(wrapper: ReturnType<typeof mountCard>): AssistantAskAnswer[] {
  const emitted = wrapper.emitted('answer') ?? []
  return emitted.map((one) => (one as [AssistantAskAnswer])[0])
}

describe('提问卡片', () => {
  it('问题与每个选项都摆出来，带各自的补充说明', () => {
    const wrapper = mountCard(entry())
    expect(wrapper.text()).toContain('这一格的值从哪来？')
    expect(wrapper.findAll('.ai-ask__option')).toHaveLength(2)
    expect(wrapper.text()).toContain('直接读采集')
  })

  it('单选点一下就是答案，不用再按确定', async () => {
    const wrapper = mountCard(entry())
    await wrapper.findAll('.ai-ask__option')[0]?.trigger('click')

    expect(answers(wrapper)).toEqual([
      { picked: ['opcua'], free_text: null, is_cancelled: false },
    ])
  })

  it('单选时不摆确定键：多一步点击就把主路变长了', () => {
    const wrapper = mountCard(entry())
    expect(wrapper.text()).not.toContain('确定')
  })

  it('多选点亮之后由确定一次交上去', async () => {
    const wrapper = mountCard(entry({}, { allow_multiple: true }))
    const options = wrapper.findAll('.ai-ask__option')
    await options[0]?.trigger('click')
    await options[1]?.trigger('click')
    expect(answers(wrapper)).toEqual([])

    await wrapper.find('.ai-ask__acts button').trigger('click')
    expect(answers(wrapper)).toEqual([
      { picked: ['opcua', 'dataset'], free_text: null, is_cancelled: false },
    ])
  })

  it('多选再点一下取消点亮', async () => {
    const wrapper = mountCard(entry({}, { allow_multiple: true }))
    const first = wrapper.findAll('.ai-ask__option')[0]
    await first?.trigger('click')
    expect(first?.attributes('aria-pressed')).toBe('true')
    await first?.trigger('click')
    expect(first?.attributes('aria-pressed')).toBe('false')
  })

  it('一个都没选时确定是禁着的', () => {
    const wrapper = mountCard(entry({}, { allow_multiple: true }))
    expect(
      wrapper.find('.ai-ask__acts button').attributes('disabled'),
    ).toBeDefined()
  })

  it('自由输入的那句话交在 free_text 里，两头空白削掉', async () => {
    const wrapper = mountCard(
      entry({}, { allow_free_text: true, free_text_label: '写个名字' }),
    )
    await wrapper.findComponent(DtInput).setValue('  一号机组  ')
    await wrapper.find('.ai-ask__acts button').trigger('click')

    expect(answers(wrapper)).toEqual([
      { picked: [], free_text: '一号机组', is_cancelled: false },
    ])
  })

  it('给了输入框也仍然能一键点选项', async () => {
    const wrapper = mountCard(entry({}, { allow_free_text: true }))
    await wrapper.findAll('.ai-ask__option')[0]?.trigger('click')

    expect(answers(wrapper)).toEqual([
      { picked: ['opcua'], free_text: null, is_cancelled: false },
    ])
  })

  it('没开自由输入时不渲染输入框', () => {
    expect(mountCard(entry()).findComponent(DtInput).exists()).toBe(false)
  })

  it('「我自己说」回的是取消，那是正常回执', async () => {
    const wrapper = mountCard(entry())
    await wrapper.find('.ai-ask__mine').trigger('click')

    expect(answers(wrapper)).toEqual([
      { picked: [], free_text: null, is_cancelled: true },
    ])
  })
})

describe('答完之后', () => {
  it('按钮收起，只留一行「你选了：…」，且用的是选项的字面', () => {
    const wrapper = mountCard(
      entry({
        answer: {
          picked: ['dataset'],
          free_text: null,
          is_cancelled: false,
        },
      }),
    )
    expect(wrapper.findAll('.ai-ask__option')).toHaveLength(0)
    expect(wrapper.find('.ai-ask__answer').text()).toBe('你选了：台账列')
  })

  it('自己写的那句也留在这一行上', () => {
    const wrapper = mountCard(
      entry({
        answer: {
          picked: ['opcua'],
          free_text: '一号机组',
          is_cancelled: false,
        },
      }),
    )
    expect(wrapper.find('.ai-ask__answer').text()).toBe(
      '你选了：实时点位、一号机组',
    )
  })

  it('取消之后写的是「自己讲」，不是一片空白', () => {
    const wrapper = mountCard(
      entry({
        answer: { picked: [], free_text: null, is_cancelled: true },
      }),
    )
    expect(wrapper.find('.ai-ask__answer').text()).toContain('自己讲')
    expect(wrapper.find('.ai-ask__mine').exists()).toBe(false)
  })

  it('认不出的取值退回原样，不留空字符串', () => {
    const wrapper = mountCard(
      entry({
        answer: { picked: ['gone'], free_text: null, is_cancelled: false },
      }),
    )
    expect(wrapper.find('.ai-ask__answer').text()).toBe('你选了：gone')
  })
})
