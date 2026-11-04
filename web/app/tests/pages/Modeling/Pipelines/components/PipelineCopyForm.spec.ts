/** @fileoverview 复制表单保留来源、允许修改副本信息并在提交期间保护操作。 */
import { DtInput, DtModal } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PipelineFormDialog from '@/pages/Modeling/Pipelines/components/PipelineFormDialog.vue'
import TemplatePicker from '@/pages/Modeling/Pipelines/components/TemplatePicker.vue'

const draft = {
  id: null,
  sourcePipelineId: 'source',
  name: '能耗分析 副本',
  code: 'new_energy',
  description: '说明',
}

it('复制表单不提供模板选择，并提交新的元数据和原来源身份', async () => {
  const wrapper = mount(PipelineFormDialog, {
    props: { draft, isSaving: false },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  expect(wrapper.getComponent(DtModal).props('title')).toBe('复制工作流')
  expect(wrapper.findComponent(TemplatePicker).exists()).toBe(false)
  expect(wrapper.text()).toContain('运行记录、模型版本和部署不会复制')
  const name = wrapper
    .findAllComponents(DtInput)
    .find((field) => field.props('label') === '工作流名称')
  if (!name) throw new Error('缺少名称输入框')
  await name.get('input').setValue('修改后的副本')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')).toEqual([
    [{ ...draft, name: '修改后的副本' }, ''],
  ])
  wrapper.unmount()
})

it('空名称或无效编码不能提交，修正后可复制', async () => {
  const wrapper = mount(PipelineFormDialog, {
    props: { draft, isSaving: false },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  function input(label: string) {
    const field = wrapper
      .findAllComponents(DtInput)
      .find((item) => item.props('label') === label)
    if (!field) throw new Error(`缺少输入框：${label}`)
    return field.get('input')
  }
  await input('工作流名称').setValue('  ')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')).toBeUndefined()
  await input('工作流名称').setValue('新副本')
  await input('编码').setValue('!invalid')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')).toBeUndefined()
  await input('编码').setValue('valid_code')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')).toHaveLength(1)
  wrapper.unmount()
})

it('复制期间禁用字段、取消、重复提交及背景关闭', async () => {
  const wrapper = mount(PipelineFormDialog, {
    props: { draft, isSaving: true },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  expect(
    wrapper
      .findAll('input, textarea')
      .every((field) => field.attributes('disabled') !== undefined),
  ).toBe(true)
  expect(wrapper.getComponent(DtModal).props('closeOnBackdrop')).toBe(false)
  await wrapper.get('form').trigger('submit')
  wrapper.getComponent(DtModal).vm.$emit('update:modelValue', false)
  expect(wrapper.emitted('submit')).toBeUndefined()
  expect(wrapper.emitted('close')).toBeUndefined()
  wrapper.unmount()
})

it('修改副本说明后可以取消，取消只关闭表单而不创建副本', async () => {
  const wrapper = mount(PipelineFormDialog, {
    props: { draft, isSaving: false },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  await wrapper.get('textarea').setValue('仅用于新的能耗分析')
  expect(wrapper.getComponent(DtModal).props('dirty')).toBe(true)
  const cancel = wrapper
    .findAll('button')
    .find((button) => button.text().trim() === '取消')
  if (!cancel) throw new Error('缺少取消按钮')
  await cancel.trigger('click')
  expect(wrapper.emitted('close')).toEqual([[]])
  expect(wrapper.emitted('submit')).toBeUndefined()
  expect(draft.description).toBe('说明')
  wrapper.unmount()
})
