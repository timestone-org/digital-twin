/** @fileoverview 内置模板远程分页检索与本地身份预览的交互契约。 */
import type { ModelingBuiltinTemplate, Page } from '@dt/contracts'
import { DtButton, DtPagination, DtSegmented } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/api/modelingTemplates'
import TemplatePicker from '@/pages/Modeling/Pipelines/components/TemplatePicker.vue'
import { PIPELINE_TEMPLATES } from '@/pages/Modeling/Pipelines/scripts/templates'
import { builtinTemplatePage } from '@/testing/modelingBuiltinTemplateFixtures'

const wrappers: VueWrapper[] = []
function open(modelValue = 'regression') {
  const wrapper = mount(TemplatePicker, {
    props: { modelValue, disabled: false },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function search(wrapper: VueWrapper, text: string): Promise<void> {
  await wrapper.get('input[type="search"]').setValue(text)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`缺少按钮：${text}`)
  return found
}
beforeEach(() => {
  vi.spyOn(api, 'listBuiltinTemplates').mockResolvedValue({
    ...builtinTemplatePage(['regression_model']),
    total: 350,
  })
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})

it('页码、条数、检索和分类都提交后端，不对服务端结果再按关键词或分类过滤', async () => {
  const list = vi.mocked(api.listBuiltinTemplates)
  const wrapper = open()
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '', category: 'all' },
    expect.any(AbortSignal),
  )
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 2, size: 20, q: '', category: 'all' },
    expect.any(AbortSignal),
  )
  await wrapper.get('input').setValue('  第350条的后端命中词  ')
  expect(list).toHaveBeenCalledTimes(2)
  list.mockResolvedValueOnce({
    ...builtinTemplatePage(['classification_model']),
    total: 350,
  })
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '第350条的后端命中词', category: 'all' },
    expect.any(AbortSignal),
  )
  expect(wrapper.get('.template-picker__option').text()).toBe('通用分类模型')
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  list.mockResolvedValueOnce(builtinTemplatePage(['regression'], 'prediction'))
  await button(wrapper, '异常检测').trigger('click')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '第350条的后端命中词', category: 'detection' },
    expect.any(AbortSignal),
  )
  expect(wrapper.get('.template-picker__option').text()).toBe('回归预测')
  wrapper.getComponent(DtPagination).vm.$emit('update:size', 50)
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 1, size: 50, q: '第350条的后端命中词', category: 'detection' },
    expect.any(AbortSignal),
  )
  expect(wrapper.get('input').attributes('maxlength')).toBe('128')
})

it('网络响应只含四字段，返回键可选择既有图，选中预览跨后端页保留', async () => {
  const payload = builtinTemplatePage()
  expect(
    payload.items.every(
      (row) => Object.keys(row).sort().join(',') === 'category,hint,key,label',
    ),
  ).toBe(true)
  vi.mocked(api.listBuiltinTemplates).mockResolvedValue(payload)
  const wrapper = open()
  await flushPromises()
  expect(
    wrapper.findAll('.template-picker__option').map((row) => row.text()),
  ).toEqual(payload.items.map((row) => row.label))
  for (const template of PIPELINE_TEMPLATES) {
    await button(wrapper, template.label).trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([template.key])
    await wrapper.setProps({ modelValue: template.key })
    expect(wrapper.get('.template-picker__preview').text()).toContain(
      `${template.build().nodes.length} 个算子`,
    )
    expect(wrapper.get('.template-picker__preview').text()).toContain(
      template.hint,
    )
  }
  const selected = PIPELINE_TEMPLATES.at(-1)
  if (!selected) throw new Error('缺少模板')
  vi.mocked(api.listBuiltinTemplates).mockResolvedValueOnce(
    builtinTemplatePage(['blank']),
  )
  await search(wrapper, '另一个后端页')
  expect(wrapper.get('.template-picker__option').text()).toBe('空白')
  expect(wrapper.get('.template-picker__preview').text()).toContain(
    selected.label,
  )
})

it('失败可重试，空结果与加载态分别呈现，预览不依赖当前候选页', async () => {
  let fail: (() => void) | undefined
  const list = vi.mocked(api.listBuiltinTemplates).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = () => reject(new Error('offline'))
      }),
  )
  const wrapper = open()
  await flushPromises()
  expect(wrapper.text()).toContain('正在加载设计模板')
  fail?.()
  await flushPromises()
  expect(wrapper.text()).toContain('请求失败，请重试')
  expect(wrapper.text()).not.toContain('没有匹配的设计模板')
  list.mockResolvedValueOnce({ items: [], page: 1, size: 20, total: 0 })
  await button(wrapper, '重试').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('没有匹配的设计模板')
  expect(wrapper.find('.template-picker__preview').exists()).toBe(true)
})

it('新搜索取消旧读取，迟到结果不覆盖，卸载取消最后一条请求', async () => {
  const list = vi.mocked(api.listBuiltinTemplates)
  const wrapper = open()
  await flushPromises()
  let finish: ((value: Page<ModelingBuiltinTemplate>) => void) | undefined
  list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValueOnce(builtinTemplatePage(['classification']))
  await search(wrapper, 'old')
  const signal = list.mock.calls.at(-1)?.[1]
  const old = wrapper.get('.template-picker__option')
  expect(old.attributes('disabled')).toBeDefined()
  await old.trigger('click')
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  await search(wrapper, 'new')
  expect(signal?.aborted).toBe(true)
  finish?.(builtinTemplatePage(['device_anomaly']))
  await flushPromises()
  expect(wrapper.get('.template-picker__option').text()).toBe('分类判别')
  list.mockImplementationOnce(() => new Promise(() => {}))
  await search(wrapper, 'pending')
  const latest = list.mock.calls.at(-1)?.[1]
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  expect(latest?.aborted).toBe(true)
})

it('禁用时选择和筛选事件均不执行，未知分类也不触发读取', async () => {
  const list = vi.mocked(api.listBuiltinTemplates)
  const wrapper = open()
  await flushPromises()
  wrapper.getComponent(DtSegmented).vm.$emit('update:modelValue', 'unknown')
  await flushPromises()
  expect(list).toHaveBeenCalledOnce()
  await wrapper.setProps({ disabled: true })
  wrapper.getComponent(DtSegmented).vm.$emit('update:modelValue', 'rule')
  await wrapper.get('form').trigger('submit')
  const option = wrapper
    .findAllComponents(DtButton)
    .find((item) => item.classes().includes('template-picker__option'))
  option?.vm.$emit('click')
  await flushPromises()
  expect(list).toHaveBeenCalledOnce()
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
})

it.each([
  ['预测与分类', 'prediction'],
  ['异常检测', 'detection'],
  ['探索分析', 'analysis'],
  ['规则计算', 'rule'],
])('点击%s后读取对应后端分类，全部恢复无分类限制', async (label, category) => {
  const wrapper = open()
  await flushPromises()
  await button(wrapper, label).trigger('click')
  await flushPromises()
  expect(api.listBuiltinTemplates).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '', category },
    expect.any(AbortSignal),
  )
  await button(wrapper, '全部').trigger('click')
  await flushPromises()
  expect(api.listBuiltinTemplates).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '', category: 'all' },
    expect.any(AbortSignal),
  )
})
