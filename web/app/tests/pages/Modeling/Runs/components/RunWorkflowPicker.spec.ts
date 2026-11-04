/** @fileoverview 工作流目录按后端分页检索，选择与迟到请求的交互边界。 */
import type { ModelingPipelineSummary, Page } from '@dt/contracts'
import { DtButton, DtPagination } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import * as modeling from '@/api/modeling'
import Picker from '@/pages/Modeling/Runs/components/RunWorkflowPicker.vue'

const wrappers: VueWrapper[] = []
function row(id: string): ModelingPipelineSummary {
  return {
    id,
    name: `工作流 ${id}`,
    code: `code_${id}`,
    description: null,
    node_count: 1,
    source_table_codes: [],
    created_by_name: null,
    created_at: '2026-11-04T00:00:00Z',
    updated_at: '2026-11-04T00:00:00Z',
  }
}
function page(id: string, total = 350): Page<ModelingPipelineSummary> {
  return { items: [row(id)], total, page: 1, size: 20 }
}
function open(selectedId = '') {
  const wrapper = mount(Picker, {
    props: { selectedId },
    global: { stubs: { Teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function search(wrapper: VueWrapper, query: string): Promise<void> {
  await wrapper.get('input[type="search"]').setValue(query)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})

it('分页和提交检索都访问后端，能选到首200条以外且名称不含关键词的服务端结果', async () => {
  const list = vi
    .spyOn(modeling, 'listModelingPipelines')
    .mockResolvedValueOnce(page('first'))
    .mockResolvedValueOnce(page('page2'))
    .mockResolvedValueOnce(page('350'))
  const wrapper = open('350')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '' },
    expect.any(AbortSignal),
  )
  const next = wrapper
    .getComponent(DtPagination)
    .findAll('button')
    .find((item) => item.text() === '下一页')
  if (!next) throw new Error('缺少下一页')
  await next.trigger('click')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 2, size: 20, q: '' },
    expect.any(AbortSignal),
  )
  await wrapper.get('input[type="search"]').setValue('  rare-code  ')
  expect(list).toHaveBeenCalledTimes(2)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: 'rare-code' },
    expect.any(AbortSignal),
  )
  const choice = wrapper.get('button[aria-label="选择工作流 工作流 350"]')
  expect(choice.attributes('aria-pressed')).toBe('true')
  await choice.trigger('click')
  expect(wrapper.emitted('select')).toEqual([[row('350')]])
  expect(wrapper.get('input').attributes('maxlength')).toBe('128')
})

it('改每页数量回到首屏并保持已应用检索，全部工作流可清除筛选', async () => {
  const list = vi
    .spyOn(modeling, 'listModelingPipelines')
    .mockResolvedValue(page('p1'))
  const wrapper = open('p1')
  await flushPromises()
  await search(wrapper, ' energy ')
  wrapper.getComponent(DtPagination).vm.$emit('update:page', 2)
  await flushPromises()
  wrapper.getComponent(DtPagination).vm.$emit('update:size', 50)
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 1, size: 50, q: 'energy' },
    expect.any(AbortSignal),
  )
  const all = wrapper
    .findAll('button')
    .find((item) => item.text() === '全部工作流')
  if (!all) throw new Error('缺少全部工作流')
  await all.trigger('click')
  expect(wrapper.emitted('select')).toEqual([[null]])
})

it('新检索取消旧请求，迟到结果不覆盖；取数中禁止选取已有条目', async () => {
  let finish: ((value: Page<ModelingPipelineSummary>) => void) | undefined
  const list = vi
    .spyOn(modeling, 'listModelingPipelines')
    .mockResolvedValue(page('first'))
  const wrapper = open()
  await flushPromises()
  list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValueOnce(page('new'))
  await search(wrapper, 'old')
  const signal = list.mock.calls.at(-1)?.[1]
  expect(
    wrapper
      .get('button[aria-label="选择工作流 工作流 first"]')
      .attributes('disabled'),
  ).toBeDefined()
  const choice = wrapper
    .findAllComponents(DtButton)
    .find((item) => item.attributes('aria-label') === '选择工作流 工作流 first')
  choice?.vm.$emit('click')
  expect(wrapper.emitted('select')).toBeUndefined()
  await search(wrapper, 'new')
  expect(signal?.aborted).toBe(true)
  finish?.(page('old'))
  await flushPromises()
  expect(wrapper.text()).toContain('工作流 new')
  expect(wrapper.text()).not.toContain('工作流 old')
})

it('失败可重试，空结果明确说明，关闭和卸载取消在途读取', async () => {
  const list = vi
    .spyOn(modeling, 'listModelingPipelines')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [], page: 1, size: 20, total: 0 })
  const wrapper = open()
  await flushPromises()
  const retry = wrapper.findAll('button').find((item) => item.text() === '重试')
  if (!retry) throw new Error('缺少重试')
  await retry.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('没有匹配的工作流')
  list.mockImplementationOnce(() => new Promise(() => {}))
  await search(wrapper, 'pending')
  const signal = list.mock.calls.at(-1)?.[1]
  await wrapper.get('button[aria-label="关闭"]').trigger('click')
  expect(wrapper.emitted('close')).toEqual([[]])
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  expect(signal?.aborted).toBe(true)
})
