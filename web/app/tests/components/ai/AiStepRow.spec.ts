/**
 * @fileoverview 契约：失败的一步要摆出来，而且与成功的一眼分得开。
 *
 * 藏起来的话，用户看到的是「助手做了几件事然后给了个奇怪的答复」，
 * 而看不出中间哪一步没成。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AiStepRow from '@/components/ai/AiStepRow.vue'
import type { RunnerStep } from '@/features/ai/turnRunner'

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

describe('步骤行', () => {
  it('摆出这一步的说明', () => {
    const wrapper = mount(AiStepRow, { props: { step: step() } })
    expect(wrapper.text()).toContain('想了想')
  })

  it('失败的一步带上失败标记', () => {
    const wrapper = mount(AiStepRow, {
      props: { step: step({ state: 'failed' }) },
    })
    expect(wrapper.find('.ai-step--failed').exists()).toBe(true)
  })

  it('失败原因摆在下面一行，不藏起来', () => {
    const wrapper = mount(AiStepRow, {
      props: { step: step({ state: 'failed', error: '这个槽不存在' }) },
    })
    expect(wrapper.text()).toContain('这个槽不存在')
  })

  it('等页面执行的那一步不是失败', () => {
    const wrapper = mount(AiStepRow, {
      props: { step: step({ kind: 'client_tool', state: 'awaiting_client' }) },
    })
    expect(wrapper.find('.ai-step--failed').exists()).toBe(false)
    expect(wrapper.text()).toContain('等页面执行')
  })

  it('认不出的种类也照样渲染，不留空行', () => {
    const wrapper = mount(AiStepRow, {
      props: { step: step({ kind: 'something-new', title: '新花样' }) },
    })
    expect(wrapper.text()).toContain('新花样')
  })
})
