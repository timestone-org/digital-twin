/** @fileoverview 对话左栏：加载中不闪「还没有对话」；行内改名没改或改成空白时不提交。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { KnowledgeChatSession } from '@dt/contracts'

import ChatSessionItem from '@/pages/KnowledgeChat/components/ChatSessionItem.vue'
import ChatSessionList from '@/pages/KnowledgeChat/components/ChatSessionList.vue'

function sessionOf(id: string, title = ''): KnowledgeChatSession {
  return {
    id,
    user_id: 'u1',
    title,
    base_scope: null,
    is_archived: false,
    row_version: 1,
    last_error: null,
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
  }
}

describe('ChatSessionList', () => {
  it('还在取清单时给骨架，不说「还没有对话」', () => {
    const wrapper = mount(ChatSessionList, {
      props: { sessions: [], selectedId: null, loading: true },
    })
    expect(wrapper.text()).not.toContain('还没有对话')
    expect(wrapper.find('.dt-skeleton').exists()).toBe(true)
  })

  it('取完确实没有才说「还没有对话」', () => {
    const wrapper = mount(ChatSessionList, {
      props: { sessions: [], selectedId: null, loading: false },
    })
    expect(wrapper.text()).toContain('还没有对话')
  })
})

describe('ChatSessionItem 的行内改名', () => {
  async function editTo(text: string | null) {
    const wrapper = mount(ChatSessionItem, {
      props: { session: sessionOf('s1', '锅炉'), active: false },
    })
    await wrapper.find('button[title="锅炉"]').trigger('dblclick')
    const input = wrapper.find('input')
    if (text !== null) await input.setValue(text)
    await input.trigger('blur')
    return wrapper
  }

  it('没改就失焦，不发改名', async () => {
    expect((await editTo(null)).emitted('rename')).toBeUndefined()
  })

  it('改成空白，不发改名', async () => {
    expect((await editTo('   ')).emitted('rename')).toBeUndefined()
  })

  it('真改了才发，且去掉首尾空白', async () => {
    expect((await editTo('  新标题 ')).emitted('rename')).toEqual([['新标题']])
  })
})
