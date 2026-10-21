/** @fileoverview 不适用的视口操作禁用，允许的定位动作分别发出意图。 */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import TwinViewportTools from '@/pages/TwinEditor/components/TwinViewportTools.vue'

it('五个视口操作全部使用同尺寸图标并保留中文名称', () => {
  const wrapper = mount(TwinViewportTools, {
    props: { isolated: false, canIsolate: true, canBack: true },
  })
  const buttons = wrapper.findAll('button')
  expect(buttons).toHaveLength(5)
  for (const button of buttons) {
    expect(button.classes()).toContain('dt-btn--icon-only')
    expect(button.classes()).toContain('dt-btn--sm')
    expect(button.find('svg path').exists()).toBe(true)
    expect(button.find('.dt-btn__label').exists()).toBe(false)
  }
  expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
    '聚焦选中',
    '只看选中',
    '显示全部',
    '全览',
    '上一视角',
  ])
  wrapper.unmount()
})

it('隔离操作显示按压状态，切换后提示退出隔离', async () => {
  const wrapper = mount(TwinViewportTools, {
    props: { isolated: false, canIsolate: true, canBack: true },
    attachTo: document.body,
  })
  expect(
    wrapper.get('button[aria-label="只看选中"]').attributes('aria-pressed'),
  ).toBe('false')
  await wrapper.setProps({ isolated: true })
  const button = wrapper.get('button[aria-label="退出隔离"]')
  expect(button.attributes('aria-pressed')).toBe('true')
  await button.trigger('focusin')
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
    '退出隔离',
  )
  wrapper.unmount()
})

it('无历史、未选部件时不能后退或隔离', async () => {
  const wrapper = mount(TwinViewportTools, {
    props: { isolated: false, canIsolate: false, canBack: false },
  })
  const button = (name: string) => {
    const item = wrapper.findAll('button').find((item) => item.text() === name)
    if (!item) throw new Error(name)
    return item
  }
  expect(button('只看选中').attributes('disabled')).toBeDefined()
  expect(button('上一视角').attributes('disabled')).toBeDefined()
  await button('只看选中').trigger('click')
  await button('上一视角').trigger('click')
  expect(wrapper.emitted('isolate')).toBeUndefined()
  expect(wrapper.emitted('back')).toBeUndefined()
  await wrapper.setProps({ canIsolate: true, canBack: true })
  await button('只看选中').trigger('click')
  expect(wrapper.emitted('isolate')).toHaveLength(1)
  await wrapper.setProps({ isolated: true })
  expect(wrapper.text()).toContain('退出隔离')
  await button('上一视角').trigger('click')
  expect(wrapper.emitted('back')).toHaveLength(1)
  await button('聚焦选中').trigger('click')
  await button('全览').trigger('click')
  await button('显示全部').trigger('click')
  expect(wrapper.emitted('focus')).toHaveLength(1)
  expect(wrapper.emitted('overview')).toHaveLength(1)
  expect(wrapper.emitted('reset')).toHaveLength(1)
  wrapper.unmount()
})
