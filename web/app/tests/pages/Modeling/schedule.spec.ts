/** @fileoverview 工作流定时训练的加载竞态、周期与自动发布配置。 */
import type { ModelingSchedule } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import * as ui from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as workflow from '@/api/modelingWorkflow'
import ScheduleDialog from '@/pages/Modeling/components/PipelineScheduleDialog.vue'
import { useAuthStore } from '@/stores/auth'
const schedule: ModelingSchedule = {
  pipeline_id: 'p1',
  is_enabled: false,
  interval_minutes: 1440,
  auto_publish: false,
  next_run_at: null,
  last_run_at: null,
  last_run_id: null,
  last_error: null,
  revision: 3,
  updated_at: null,
}
const wrappers: VueWrapper[] = []
function open() {
  const wrapper = mount(ScheduleDialog, {
    props: { pipeline: null },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  vi.spyOn(workflow, 'getModelingSchedule').mockResolvedValue(schedule)
  vi.spyOn(workflow, 'saveModelingSchedule').mockResolvedValue({
    ...schedule,
    revision: 4,
  })
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})
it('保存周期、首航时刻、自动发布选项与当前修订号', async () => {
  const wrapper = open()
  await wrapper.setProps({ pipeline: { id: 'p1', name: '能耗' } })
  await flushPromises()
  const checks = wrapper.findAllComponents(ui.DtCheckbox)
  checks[0]?.vm.$emit('update:modelValue', true)
  checks[1]?.vm.$emit('update:modelValue', true)
  wrapper.getComponent(ui.DtNumberInput).vm.$emit('update:modelValue', 10080)
  wrapper
    .getComponent(ui.DtDateTimeInput)
    .vm.$emit('update:modelValue', '2026-11-04T01:00:00Z')
  await flushPromises()
  const save = wrapper.findAll('button').find((item) => item.text() === '保存')
  await save?.trigger('click')
  await flushPromises()
  expect(workflow.saveModelingSchedule).toHaveBeenCalledWith('p1', {
    is_enabled: true,
    interval_minutes: 10080,
    auto_publish: true,
    expected_revision: 3,
    first_run_at: '2026-11-04T01:00:00Z',
  })
  expect(wrapper.emitted('close')).toHaveLength(1)
})
it('无发布权限时不允许启用自动发布', async () => {
  vi.mocked(useAuthStore().can).mockImplementation(
    (codes) => !codes.includes(PERMISSION_CODES.modelingPublish),
  )
  const wrapper = open()
  await wrapper.setProps({ pipeline: { id: 'p1', name: '能耗' } })
  await flushPromises()
  expect(wrapper.findAllComponents(ui.DtCheckbox)[1]?.props('disabled')).toBe(
    true,
  )
})
it('快速切换工作流时迟到的旧规则不能覆盖新规则', async () => {
  let finish: ((value: ModelingSchedule) => void) | undefined
  vi.mocked(workflow.getModelingSchedule).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = open()
  await wrapper.setProps({ pipeline: { id: 'p1', name: '第一条' } })
  await wrapper.setProps({ pipeline: { id: 'p2', name: '第二条' } })
  await flushPromises()
  finish?.({ ...schedule, interval_minutes: 20 })
  await flushPromises()
  expect(wrapper.getComponent(ui.DtNumberInput).props('modelValue')).toBe(1440)
  expect(wrapper.text()).toContain('第二条')
})
it('读取失败展示重试，保存冲突保留用户配置', async () => {
  vi.mocked(workflow.getModelingSchedule).mockRejectedValueOnce(
    new Error('offline'),
  )
  vi.mocked(workflow.saveModelingSchedule).mockRejectedValue(
    new Error('conflict'),
  )
  const wrapper = open()
  await wrapper.setProps({ pipeline: { id: 'p1', name: '能耗' } })
  await flushPromises()
  expect(wrapper.text()).toContain('请求失败')
  await wrapper
    .findAll('button')
    .find((item) => item.text() === '重新加载')
    ?.trigger('click')
  await flushPromises()
  wrapper.getComponent(ui.DtNumberInput).vm.$emit('update:modelValue', 10)
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((item) => item.text() === '保存')
    ?.trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ui.DtNumberInput).props('modelValue')).toBe(10)
  expect(wrapper.emitted('close')).toBeUndefined()
  expect(wrapper.text()).toContain('请求失败')
})
it('初始已打开的规则也会加载', async () => {
  const wrapper = mount(ScheduleDialog, {
    props: { pipeline: { id: 'p1', name: '能耗' } },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  expect(workflow.getModelingSchedule).toHaveBeenCalledWith(
    'p1',
    expect.any(AbortSignal),
  )
})
