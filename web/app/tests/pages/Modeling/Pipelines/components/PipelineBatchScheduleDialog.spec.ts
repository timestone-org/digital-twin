/** @fileoverview 批量定时弹窗的默认保留策略、间隔约束与权限变化。 */
import { PERMISSION_CODES } from '@dt/contracts'
import { DtCheckbox, DtModal, DtNumberInput, DtSelect } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PipelineBatchScheduleDialog from '@/pages/Modeling/Pipelines/components/PipelineBatchScheduleDialog.vue'
import { useAuthStore } from '@/stores/auth'

const wrappers: VueWrapper[] = []
const canPublish = ref(true)
function open(isBusy = false) {
  const wrapper = mount(PipelineBatchScheduleDialog, {
    props: { count: 2, isBusy },
    global: { stubs: { Teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
function save(wrapper: VueWrapper) {
  const button = wrapper
    .findAll('button')
    .find((item) => item.text() === '保存并开启')
  if (!button) throw new Error('没有保存按钮')
  return button
}
beforeEach(() => {
  setActivePinia(createPinia())
  canPublish.value = true
  vi.spyOn(useAuthStore(), 'can').mockImplementation(
    (codes) =>
      codes.includes(PERMISSION_CODES.modelingRun) ||
      (codes.includes(PERMISSION_CODES.modelingPublish) && canPublish.value),
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})
it('默认保留各项配置，未配置项采用每天且不自动发布', async () => {
  const wrapper = open()
  await save(wrapper).trigger('click')
  expect(wrapper.emitted('submit')).toEqual([
    [{ strategy: 'preserve', intervalMinutes: 1440, autoPublish: false }],
  ])
})
it.each([undefined, 0, 4, 5.5, 525601])('间隔%s无效时不提交', async (value) => {
  const wrapper = open()
  wrapper.getComponent(DtNumberInput).vm.$emit('update:modelValue', value)
  await flushPromises()
  expect(save(wrapper).attributes('disabled')).toBeDefined()
  await save(wrapper).trigger('click')
  expect(wrapper.emitted('submit')).toBeUndefined()
})
it('五分钟为有效下限，明确选择统一策略才替换', async () => {
  const wrapper = open()
  wrapper.getComponent(DtNumberInput).vm.$emit('update:modelValue', 5)
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'replace')
  await flushPromises()
  await save(wrapper).trigger('click')
  expect(wrapper.emitted('submit')).toEqual([
    [{ strategy: 'replace', intervalMinutes: 5, autoPublish: false }],
  ])
})
it('更新所选数量不重置正在编辑的设置', async () => {
  const wrapper = open()
  wrapper.getComponent(DtNumberInput).vm.$emit('update:modelValue', 60)
  wrapper.getComponent(DtCheckbox).vm.$emit('update:modelValue', true)
  await wrapper.setProps({ count: 3 })
  await save(wrapper).trigger('click')
  expect(wrapper.emitted('submit')).toEqual([
    [{ strategy: 'preserve', intervalMinutes: 60, autoPublish: true }],
  ])
})
it('失去发布权限后不将已选自动发布静默清成false', async () => {
  const wrapper = open()
  wrapper.getComponent(DtCheckbox).vm.$emit('update:modelValue', true)
  await flushPromises()
  canPublish.value = false
  await flushPromises()
  expect(save(wrapper).attributes('disabled')).toBeDefined()
  await save(wrapper).trigger('click')
  expect(wrapper.emitted('submit')).toBeUndefined()
  expect(wrapper.getComponent(DtCheckbox).props('modelValue')).toBe(true)
})
it('忙碌时锁定输入和关闭路径，只允许停止后续操作', async () => {
  const wrapper = open(true)
  expect(wrapper.getComponent(DtNumberInput).props('disabled')).toBe(true)
  expect(wrapper.getComponent(DtSelect).props('disabled')).toBe(true)
  expect(wrapper.getComponent(DtCheckbox).props('disabled')).toBe(true)
  wrapper.getComponent(DtModal).vm.$emit('update:modelValue', false)
  await flushPromises()
  expect(wrapper.emitted('close')).toBeUndefined()
  const stop = wrapper
    .findAll('button')
    .find((item) => item.text() === '停止后续操作')
  await stop?.trigger('click')
  expect(wrapper.emitted('stop')).toEqual([[]])
})
