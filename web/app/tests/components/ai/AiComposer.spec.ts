/** @fileoverview 发送之后点开过的附件预览要复位：下一条附件不该一进来就是展开的。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AiAttachmentChip from '@/components/ai/AiAttachmentChip.vue'
import AiComposer from '@/components/ai/AiComposer.vue'
import AiInputBox from '@/components/ai/AiInputBox.vue'
import { newComposeState } from '@/composables/useAiCompose'

function file(name: string) {
  return { name, meta: '1 KB', text: '正文', dataUri: '' }
}

describe('AiComposer 的附件预览', () => {
  it('发送后再加一条附件，它是收着的', async () => {
    const compose = newComposeState()
    compose.setAttachments([file('a.txt')])
    const wrapper = mount(AiComposer, {
      props: { compose, running: false },
    })
    wrapper.findComponent(AiAttachmentChip).vm.$emit('toggle')
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(AiAttachmentChip).props('expanded')).toBe(true)
    wrapper.findComponent(AiInputBox).vm.$emit('send')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('send')).toHaveLength(1)
    compose.setAttachments([file('b.txt')])
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(AiAttachmentChip).props('expanded')).toBe(
      false,
    )
  })
})
