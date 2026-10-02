/** @fileoverview 欢迎区的问题入口和时间线空态插槽契约。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import KnowledgeWelcome from '@/pages/KnowledgeChat/components/KnowledgeWelcome.vue'
import AiTimeline from '@/components/ai/AiTimeline.vue'

it('快捷问题保持完整文本并发出一次事件', async () => {
  const wrapper = mount(KnowledgeWelcome, {
    props: { starters: ['查看设备温度'] },
  })
  await wrapper.get('button').trigger('click')
  expect(wrapper.emitted('starter')).toEqual([['查看设备温度']])
  expect(wrapper.get('img').attributes('alt')).toBe('')
})

describe('时间线欢迎插槽', () => {
  it('定制空态只在没有消息时出现', async () => {
    const wrapper = mount(AiTimeline, {
      props: { entries: [] },
      slots: { empty: '<p>定制欢迎</p>' },
    })
    expect(wrapper.text()).toContain('定制欢迎')
    expect(wrapper.text()).not.toContain('说说你想做什么')
    await wrapper.setProps({
      entries: [{ id: 'user-1', role: 'user', text: '你好' }],
    })
    expect(wrapper.text()).not.toContain('定制欢迎')
    expect(wrapper.text()).toContain('你好')
  })

  it('其他助手保留默认空态', () => {
    const wrapper = mount(AiTimeline, { props: { entries: [] } })
    expect(wrapper.text()).toContain('说说你想做什么')
  })
})
