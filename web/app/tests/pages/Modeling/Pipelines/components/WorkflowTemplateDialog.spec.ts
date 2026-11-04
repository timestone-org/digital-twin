/** @fileoverview 模板选择仅属于新建弹窗，不进入独立模板管理页面。 */
import type { ModelingTemplate } from '@dt/contracts'
import { DtInput, DtSegmented } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/api/modelingTemplates'
import PipelineFormDialog from '@/pages/Modeling/Pipelines/components/PipelineFormDialog.vue'
import WorkflowTemplateDialog from '@/pages/Modeling/Pipelines/components/WorkflowTemplateDialog.vue'
import TemplatePicker from '@/pages/Modeling/Pipelines/components/TemplatePicker.vue'
import { builtinTemplatePage } from '@/testing/modelingBuiltinTemplateFixtures'

const named: ModelingTemplate = {
  id: 'template-1',
  pipeline_id: 'source-1',
  code: 'energy',
  name: '冷机能耗',
  description: '既有建模配置',
  version: 2,
  node_count: 6,
  task: 'regression',
  is_enabled: true,
  created_by_name: '分析员',
  created_at: '2026-11-03T00:00:00Z',
  updated_at: '2026-11-03T00:00:00Z',
}

afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  vi.spyOn(api, 'listBuiltinTemplates').mockResolvedValue(builtinTemplatePage())
})

it('新建表单只显示选择模板按钮，命名模板选择后随创建提交', async () => {
  const read = vi
    .spyOn(api, 'listTemplates')
    .mockResolvedValue({ items: [named], page: 1, size: 20, total: 1 })
  const draft = { id: null, code: 'new_energy', name: '', description: '' }
  const wrapper = mount(PipelineFormDialog, {
    props: { draft, isSaving: false },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  expect(wrapper.findComponent(WorkflowTemplateDialog).exists()).toBe(false)
  expect(read).not.toHaveBeenCalled()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '选择模板')
    ?.trigger('click')
  const chooser = wrapper.getComponent(WorkflowTemplateDialog)
  await flushPromises()
  chooser.getComponent(DtSegmented).vm.$emit('update:modelValue', 'saved')
  await flushPromises()
  await chooser
    .get('button[aria-label="选择模板 冷机能耗 v2"]')
    .trigger('click')
  await chooser
    .findAll('button')
    .find((button) => button.text() === '使用所选模板')
    ?.trigger('click')
  expect(wrapper.findComponent(WorkflowTemplateDialog).exists()).toBe(false)
  expect(wrapper.text()).toContain('冷机能耗 v2')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')?.[0]).toEqual([
    { ...draft, name: '冷机能耗 v2' },
    'saved:template-1',
  ])
  wrapper.unmount()
})

it('选择模板保留用户输入的工作流名称，取消选择保留原起点', async () => {
  const wrapper = mount(PipelineFormDialog, {
    props: {
      draft: {
        id: null,
        code: 'new_energy',
        name: '我的工作流',
        description: '',
      },
      isSaving: false,
    },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '选择模板')
    ?.trigger('click')
  const chooser = wrapper.getComponent(WorkflowTemplateDialog)
  await flushPromises()
  chooser
    .getComponent(TemplatePicker)
    .vm.$emit('update:modelValue', 'device_anomaly')
  await flushPromises()
  chooser.vm.$emit('close')
  await flushPromises()
  expect(wrapper.text()).toContain('回归预测')
  expect(
    wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '工作流名称')
      ?.props('modelValue'),
  ).toBe('我的工作流')
  wrapper.unmount()
})
