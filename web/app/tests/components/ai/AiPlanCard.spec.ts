/**
 * @fileoverview 契约：计划清单逐项打勾、当前项一眼可辨、完结后仍能回看。
 *
 * 清单是用户判断「助手做到哪了」的唯一依据——少画一项或状态画错，
 * 用户会在助手还没做完时就去保存。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AssistantPlan } from '@dt/contracts'

import AiPlanCard from '@/components/ai/AiPlanCard.vue'

function plan(overrides: Partial<AssistantPlan> = {}): AssistantPlan {
  return {
    title: '绑完整屏',
    state: 'active',
    items: [
      { title: '读画布', status: 'done', note: '' },
      { title: '绑温度槽', status: 'in_progress', note: '' },
      { title: '截图自检', status: 'pending', note: '' },
    ],
    ...overrides,
  }
}

describe('计划清单', () => {
  it('每一项都摆出来，带各自的状态', () => {
    const wrapper = mount(AiPlanCard, { props: { plan: plan() } })
    const items = wrapper.findAll('.ai-plan__item')
    expect(items).toHaveLength(3)
    expect(items[0]?.classes()).toContain('ai-plan__item--done')
    expect(items[1]?.classes()).toContain('ai-plan__item--in_progress')
    expect(items[2]?.classes()).toContain('ai-plan__item--pending')
  })

  it('头部数着完成进度', () => {
    const wrapper = mount(AiPlanCard, { props: { plan: plan() } })
    expect(wrapper.find('.ai-plan__count').text()).toBe('1/3')
  })

  it('失败与跳过也算走完，计入进度', () => {
    const wrapper = mount(AiPlanCard, {
      props: {
        plan: plan({
          items: [
            { title: 'a', status: 'failed', note: '点位不存在' },
            { title: 'b', status: 'skipped', note: '' },
            { title: 'c', status: 'pending', note: '' },
          ],
        }),
      },
    })
    expect(wrapper.find('.ai-plan__count').text()).toBe('2/3')
    expect(wrapper.find('.ai-plan__item--failed').exists()).toBe(true)
  })

  it('没有标题时用缺省名，不留空头', () => {
    const wrapper = mount(AiPlanCard, { props: { plan: plan({ title: '' }) } })
    expect(wrapper.find('.ai-plan__title').text()).toBe('执行计划')
  })

  it('点头部折起清单，再点展开', async () => {
    const wrapper = mount(AiPlanCard, { props: { plan: plan() } })
    await wrapper.find('.ai-plan__head').trigger('click')
    expect(wrapper.findAll('.ai-plan__item')).toHaveLength(0)
    await wrapper.find('.ai-plan__head').trigger('click')
    expect(wrapper.findAll('.ai-plan__item')).toHaveLength(3)
  })

  it('进行中的那一项画的是转圈，不是勾', () => {
    const wrapper = mount(AiPlanCard, { props: { plan: plan() } })
    const running = wrapper.find('.ai-plan__item--in_progress')
    expect(running.findComponent({ name: 'DtSpinner' }).exists()).toBe(true)
  })
})
