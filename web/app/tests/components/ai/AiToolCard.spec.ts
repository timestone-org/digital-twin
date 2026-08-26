/**
 * @fileoverview 契约：一步做了什么要看得见——失败要与成功一眼分得开，
 * 入参与产出要展得开，截图要画出来。
 *
 * 只有一句标题的话，用户看到的是「助手做了几件事然后给了个奇怪的答复」，
 * 而看不出中间哪一步没成、也看不出它到底把什么写进去了。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AiToolCard from '@/components/ai/AiToolCard.vue'
import type { RunnerStep } from '@/features/ai/turnRunner'

const SHOT = 'data:image/png;base64,iVBORw0KGgo='

function step(overrides: Partial<RunnerStep> = {}): RunnerStep {
  return {
    kind: 'model',
    name: 'model',
    state: 'succeeded',
    title: '想了想',
    error: null,
    ...overrides,
  }
}

describe('步骤卡', () => {
  it('摆出这一步的说明', () => {
    const wrapper = mount(AiToolCard, { props: { step: step() } })
    expect(wrapper.text()).toContain('想了想')
  })

  it('失败的一步带上失败标记', () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ state: 'failed' }) },
    })
    expect(wrapper.find('.ai-step--failed').exists()).toBe(true)
  })

  it('失败原因摆在下面一行，不藏起来', () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ state: 'failed', error: '这个槽不存在' }) },
    })
    expect(wrapper.text()).toContain('这个槽不存在')
  })

  it('等页面执行的那一步不是失败', () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ kind: 'client_tool', state: 'awaiting_client' }) },
    })
    expect(wrapper.find('.ai-step--failed').exists()).toBe(false)
    expect(wrapper.text()).toContain('等页面执行')
  })

  it('认不出的种类也照样渲染，不留空行', () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ kind: 'something-new', title: '新花样' }) },
    })
    expect(wrapper.text()).toContain('新花样')
  })

  it('没东西可展开时那一行是禁用的', () => {
    // 不禁用的话，点上去什么都不发生——而用户会以为自己点错了地方
    const wrapper = mount(AiToolCard, { props: { step: step() } })
    expect(wrapper.get('.ai-step__head').attributes('disabled')).toBeDefined()
  })

  it('展开之后看得见入参与产出', async () => {
    const wrapper = mount(AiToolCard, {
      props: {
        step: step({
          kind: 'server_tool',
          input: { q: '温度' },
          output: '命中 3 条',
        }),
      },
    })
    expect(wrapper.text()).not.toContain('命中 3 条')
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.text()).toContain('温度')
    expect(wrapper.text()).toContain('命中 3 条')
  })

  it('截图画成缩略图，不是一坨 base64', async () => {
    const wrapper = mount(AiToolCard, {
      props: {
        step: step({
          kind: 'client_tool',
          name: 'dashboard.capture',
          image: SHOT,
        }),
      },
    })
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.get('.ai-step__shot-btn img').attributes('src')).toBe(SHOT)
    // 原样打印的话，几十万字符会把整条时间线冲垮
    expect(wrapper.text()).not.toContain('base64')
  })

  it('图被释放掉的那一步说一句人话', async () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ kind: 'client_tool', isImageDropped: true }) },
    })
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.text()).toContain('截图已释放')
    expect(wrapper.find('.ai-step__shot-btn').exists()).toBe(false)
  })
})
