/** @fileoverview 训练按钮的事件、权限及在途操作保护。 */
import { PERMISSION_CODES } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import RunControls from '@/pages/Modeling/Canvas/components/RunControls.vue'
import { useAuthStore } from '@/stores/auth'
beforeEach(() => {
  setActivePinia(createPinia())
})
const props = {
  isRunning: false,
  isReadonly: false,
  isStarting: false,
  isKeepingFrames: false,
}
it('训练并发布发出独立意图，普通训练保留单独入口', async () => {
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  const wrapper = mount(RunControls, { props })
  await wrapper
    .findAll('button')
    .find((item) => item.text() === '训练并发布')
    ?.trigger('click')
  expect(wrapper.emitted('trainAndDeploy')).toEqual([[]])
  expect(wrapper.emitted('run')).toBeUndefined()
  await wrapper
    .findAll('button')
    .find((item) => item.text() === '开始训练')
    ?.trigger('click')
  expect(wrapper.emitted('run')).toEqual([[]])
  await wrapper.setProps({ isRunning: true })
  expect(wrapper.text()).not.toContain('训练并发布')
  await wrapper
    .findAll('button')
    .find((item) => item.text() === '取消训练')
    ?.trigger('click')
  expect(wrapper.emitted('cancel')).toEqual([[]])
  wrapper.unmount()
})
it('没有发布权限时仅提供普通训练，回看时禁止发起训练', () => {
  vi.spyOn(useAuthStore(), 'can').mockImplementation(
    (codes) => !codes.includes(PERMISSION_CODES.modelingPublish),
  )
  const wrapper = mount(RunControls, { props: { ...props, isReadonly: true } })
  expect(wrapper.text()).not.toContain('训练并发布')
  const train = wrapper
    .findAll('button')
    .find((item) => item.text() === '开始训练')
  expect(train?.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
