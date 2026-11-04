/** @fileoverview 已保存模板的分页、选择和异步生命周期契约。 */
import type { ModelingTemplate, Page } from '@dt/contracts'
import { DtPagination } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import * as api from '@/api/modelingTemplates'
import SavedTemplatePicker from '@/pages/Modeling/Pipelines/components/SavedTemplatePicker.vue'

function template(name: string, isEnabled = true): ModelingTemplate {
  return {
    id: name,
    pipeline_id: 'source',
    code: name,
    name,
    description: `${name}用途`,
    version: 2,
    node_count: 6,
    task: 'regression',
    is_enabled: isEnabled,
    created_by_name: '分析员',
    created_at: '2026-11-03T00:00:00Z',
    updated_at: '2026-11-03T00:00:00Z',
  }
}

function page(
  items: ModelingTemplate[],
  total = items.length,
): Page<ModelingTemplate> {
  return { items, page: 1, size: 20, total }
}

function deferred<TResult>() {
  let finish: ((value: TResult) => void) | undefined
  const promise = new Promise<TResult>((resolve) => {
    finish = resolve
  })
  return {
    promise,
    resolve(value: TResult) {
      if (!finish) throw new Error('请求未开始')
      finish(value)
    },
  }
}

afterEach(() => vi.restoreAllMocks())

it('按固定版本选择命名模板，停用模板不可使用并展示总数分页', async () => {
  vi.spyOn(api, 'listTemplates').mockResolvedValue(
    page([template('能耗模板'), template('旧模板', false)], 25),
  )
  const wrapper = mount(SavedTemplatePicker, { props: { selectedKey: '' } })
  await flushPromises()
  expect(wrapper.getComponent(DtPagination).props()).toMatchObject({
    page: 1,
    size: 20,
    total: 25,
  })
  expect(
    wrapper
      .get('button[aria-label="选择模板 旧模板 v2"]')
      .attributes('disabled'),
  ).toBeDefined()
  await wrapper
    .get('button[aria-label="选择模板 能耗模板 v2"]')
    .trigger('click')
  expect(wrapper.emitted('select')).toEqual([
    [{ key: 'saved:能耗模板', label: '能耗模板 v2' }],
  ])
  wrapper.unmount()
})

it('点击搜索图标实际筛选并重置分页，按钮使用字段actions插槽', async () => {
  const read = vi
    .spyOn(api, 'listTemplates')
    .mockResolvedValue(page([template('能耗模板')], 25))
  const wrapper = mount(SavedTemplatePicker, { props: { selectedKey: '' } })
  await flushPromises()
  wrapper.getComponent(DtPagination).vm.$emit('update:page', 2)
  await flushPromises()
  expect(read).toHaveBeenLastCalledWith(
    { page: 2, size: 20, q: '' },
    expect.any(AbortSignal),
  )
  await wrapper.get('input[type="search"]').setValue('  能耗  ')
  await wrapper.get('button[aria-label="搜索"]').trigger('click')
  await flushPromises()
  expect(read).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '能耗' },
    expect.any(AbortSignal),
  )
  expect(wrapper.get('button[aria-label="搜索"]').attributes('type')).toBe(
    'button',
  )
  expect(read).toHaveBeenCalledTimes(3)
  expect(wrapper.get('button[aria-label="搜索"]').classes()).toContain(
    'dt-btn--icon-only',
  )
  expect(
    wrapper.get('button[aria-label="搜索"]').element.closest('.dt-field'),
  ).toBe(wrapper.get('input[type="search"]').element.closest('.dt-field'))
  wrapper.unmount()
})

it('已挂载表单的真实点击只搜索一次，表单提交入口继续可用', async () => {
  const read = vi.spyOn(api, 'listTemplates').mockResolvedValue(page([]))
  const wrapper = mount(SavedTemplatePicker, {
    props: { selectedKey: '' },
    attachTo: document.body,
  })
  await flushPromises()
  await wrapper.get('input[type="search"]').setValue('能耗')
  const searchButton = wrapper.get('button[aria-label="搜索"]').element
  if (!(searchButton instanceof HTMLButtonElement))
    throw new Error('缺少原生搜索按钮')
  searchButton.click()
  await flushPromises()
  expect(read).toHaveBeenCalledTimes(2)
  expect(read).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '能耗' },
    expect.any(AbortSignal),
  )
  await wrapper.get('input[type="search"]').setValue('冷机')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(read).toHaveBeenCalledTimes(3)
  expect(read).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '冷机' },
    expect.any(AbortSignal),
  )
  wrapper.unmount()
})

it('加载失败可重试，空目录说明保存模板的位置', async () => {
  vi.spyOn(api, 'listTemplates')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page([]))
  const wrapper = mount(SavedTemplatePicker, { props: { selectedKey: '' } })
  await flushPromises()
  expect(wrapper.text()).toContain('请求失败')
  const retry = wrapper.get('button[aria-label="重试"]')
  expect(retry.classes()).toContain('dt-btn--icon-only')
  await retry.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('还没有已保存模板')
  expect(wrapper.text()).toContain('保存为模板')
  wrapper.unmount()
})

it('较慢的旧搜索不能覆盖较新的搜索结果', async () => {
  const older = deferred<Page<ModelingTemplate>>()
  const newer = deferred<Page<ModelingTemplate>>()
  vi.spyOn(api, 'listTemplates')
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise)
  const wrapper = mount(SavedTemplatePicker, { props: { selectedKey: '' } })
  await wrapper.get('input').setValue('新')
  await wrapper.get('form').trigger('submit')
  newer.resolve(page([template('新模板')]))
  await flushPromises()
  older.resolve(page([template('过期模板')]))
  await flushPromises()
  expect(wrapper.text()).toContain('新模板')
  expect(wrapper.text()).not.toContain('过期模板')
  wrapper.unmount()
})

it('关闭选择器中止未完成目录请求', async () => {
  const pending = deferred<Page<ModelingTemplate>>()
  let requestSignal: AbortSignal | undefined
  vi.spyOn(api, 'listTemplates').mockImplementation((_query, signal) => {
    requestSignal = signal
    return pending.promise
  })
  const wrapper = mount(SavedTemplatePicker, { props: { selectedKey: '' } })
  wrapper.unmount()
  expect(requestSignal?.aborted).toBe(true)
  pending.resolve(page([template('晚返回的模板')]))
  await flushPromises()
})
