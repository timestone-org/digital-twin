/** @fileoverview 上下文使用率明确展示未知、估算及压缩前后状态。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AssistantContextUsage } from '@dt/contracts'

import AiContextUsage from '@/components/ai/AiContextUsage.vue'

const usage: AssistantContextUsage = {
  used_tokens: 28000,
  max_tokens: 32768,
  percent: 85,
  is_estimated: true,
  state: 'compressing',
  compression_count: 0,
}

describe('上下文进度', () => {
  it('未收到数据时不显示虚假的 0%', () => {
    const wrapper = mount(AiContextUsage, { props: { usage: null } })
    expect(wrapper.text()).toContain('上下文 —')
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
  })

  it('显示百分比与估算标记，压缩后进度下降且标注次数', async () => {
    const wrapper = mount(AiContextUsage, { props: { usage } })
    expect(wrapper.text()).toContain('上下文约 85%')
    expect(wrapper.text()).toContain('正在自动压缩')
    expect(wrapper.get('[role="progressbar"]').attributes()).toMatchObject({
      'aria-label': '上下文使用率',
      'aria-valuenow': '85',
    })
    await wrapper.setProps({
      usage: {
        ...usage,
        used_tokens: 8192,
        percent: 25,
        is_estimated: false,
        state: 'compressed',
        compression_count: 2,
      },
    })
    expect(wrapper.text()).toContain('上下文 25%')
    expect(wrapper.text()).toContain('已自动压缩 2 次')
    expect(
      wrapper.get('[role="progressbar"]').attributes('aria-valuenow'),
    ).toBe('25')
    expect(wrapper.attributes('title')).toContain('模型报告用量')
  })
})
