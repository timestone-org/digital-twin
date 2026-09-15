/** @fileoverview 不适用的视口操作禁用，允许的定位动作分别发出意图。 */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import TwinViewportTools from '@/pages/TwinEditor/components/TwinViewportTools.vue'
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
