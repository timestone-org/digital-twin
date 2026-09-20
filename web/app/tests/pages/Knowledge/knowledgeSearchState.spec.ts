/** @fileoverview 检索场景优先显示真实等待状态，完成后显示结果或空态。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import KnowledgeSearchPanel from '@/pages/Knowledge/components/KnowledgeSearchPanel.vue'

const PROPS = {
  query: '设备',
  searched: '',
  result: null,
  isSearching: false,
  rerank: null,
}

describe('知识检索场景', () => {
  it('初始状态引导提问，不显示未命中', () => {
    const wrapper = mount(KnowledgeSearchPanel, { props: PROPS })
    expect(wrapper.text()).toContain('好问题，是发现知识的开始')
    expect(wrapper.text()).not.toContain('这个库里没查到')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('检索期间不将上次空结果当成此次结果', async () => {
    const wrapper = mount(KnowledgeSearchPanel, {
      props: {
        ...PROPS,
        isSearching: true,
        result: {
          hits: [],
          note: '',
          strategy: 'hybrid',
          rounds: 1,
          is_complete: true,
        },
      },
    })
    expect(wrapper.get('[role="status"]').text()).toContain('正在查找相关资料')
    expect(wrapper.text()).not.toContain('这个库里没查到')
    await wrapper.setProps({ isSearching: false })
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('这个库里没查到')
  })

  it('输入新问题后可用回车触发检索', async () => {
    const wrapper = mount(KnowledgeSearchPanel, { props: PROPS })
    await wrapper.get('input').setValue('二月能耗')
    expect(wrapper.emitted('update:query')).toEqual([['二月能耗']])
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('search')).toEqual([[]])
  })

  it('检索按钮继续发出原有事件', async () => {
    const wrapper = mount(KnowledgeSearchPanel, { props: PROPS })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('search')).toEqual([[]])
  })
})
