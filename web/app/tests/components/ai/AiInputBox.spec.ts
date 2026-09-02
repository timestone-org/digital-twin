/**
 * @fileoverview 契约：集成输入框的壳——跑着回合时发送让位给停止且读屏名对得上；
 * 不能发时发送键禁用；点发送 / 停止往外报；附件槽不给就没有那条 ul。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'

import AiInputBox from '@/components/ai/AiInputBox.vue'

describe('AiInputBox', () => {
  it('跑着回合时是停止键，读屏名缺省是「停止这个回合」', () => {
    const wrapper = mount(AiInputBox, {
      props: { running: true, canSend: false },
    })

    expect(wrapper.find('button[aria-label="停止这个回合"]').exists()).toBe(
      true,
    )
    expect(wrapper.find('button[aria-label="发送"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('正在处理')
  })

  it('停止键的读屏名随 stopLabel 走', () => {
    const wrapper = mount(AiInputBox, {
      props: { running: true, canSend: false, stopLabel: '停止' },
    })

    expect(wrapper.find('button[aria-label="停止"]').exists()).toBe(true)
  })

  it('canSend 为假时发送键禁用，为真时可点', async () => {
    const wrapper = mount(AiInputBox, {
      props: { running: false, canSend: false },
    })
    const send = () => wrapper.find('button[aria-label="发送"]')

    expect(send().attributes('disabled')).toBeDefined()

    await wrapper.setProps({ canSend: true })
    expect(send().attributes('disabled')).toBeUndefined()
  })

  it('点发送往外报 send，点停止往外报 stop', async () => {
    const wrapper = mount(AiInputBox, {
      props: { running: false, canSend: true },
    })

    await wrapper.find('button[aria-label="发送"]').trigger('click')
    expect(wrapper.emitted('send')).toHaveLength(1)

    await wrapper.setProps({ running: true })
    await wrapper.find('button[aria-label="停止这个回合"]').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
  })

  it('没给附件槽就不渲染那条 ul，给了才有', () => {
    const bare = mount(AiInputBox, {
      props: { running: false, canSend: false },
    })
    expect(bare.find('ul.ai-inputbox__files').exists()).toBe(false)

    const withFiles = mount(AiInputBox, {
      props: { running: false, canSend: false },
      slots: { files: () => h('li', '点表.csv') },
    })
    expect(withFiles.find('ul.ai-inputbox__files').exists()).toBe(true)
    expect(withFiles.text()).toContain('点表.csv')
  })
})
