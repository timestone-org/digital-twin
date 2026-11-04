/** @fileoverview 工作流后端页检索的取消与写后末页纠正。 */
import type { ModelingPipelineSummary, Page } from '@dt/contracts'
import * as ui from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as modeling from '@/api/modeling'
import Pipelines from '@/pages/Modeling/Pipelines/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ path: '/modeling/pipelines', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))
const wrappers: VueWrapper[] = []
function row(id: string): ModelingPipelineSummary {
  return {
    id,
    code: id,
    name: id,
    description: null,
    node_count: 1,
    source_table_codes: [],
    created_by_name: null,
    created_at: '2026-11-04T00:00:00Z',
    updated_at: '2026-11-04T00:00:00Z',
  }
}
function page(id: string, total = 350): Page<ModelingPipelineSummary> {
  return { items: [row(id)], page: 1, size: 20, total }
}
async function open() {
  const wrapper = mount(Pipelines, {
    global: {
      stubs: {
        Teleport: true,
        AppShell: { template: '<section><slot /></section>' },
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`缺少按钮：${text}`)
  return found
}
async function search(wrapper: VueWrapper, q: string): Promise<void> {
  await wrapper.get('input[type="search"]').setValue(q)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  vi.spyOn(ui, 'useConfirm').mockReturnValue({
    ...ui.useConfirm(),
    ask: vi.fn().mockResolvedValue(true),
  })
  vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page('first'))
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})

it('搜索和翻页使用新读取信号，旧搜索迟到不会覆盖，卸载取消当前请求', async () => {
  const list = vi.mocked(modeling.listModelingPipelines)
  const wrapper = await open()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  let finish: ((result: Page<ModelingPipelineSummary>) => void) | undefined
  list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValueOnce(page('new'))
  await search(wrapper, 'old')
  const oldSignal = list.mock.calls.at(-1)?.[1]
  await search(wrapper, 'new')
  expect(oldSignal?.aborted).toBe(true)
  finish?.(page('old'))
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: 'new', includeInstances: false },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('new')
  expect(wrapper.text()).not.toContain('old')
  list.mockImplementationOnce(() => new Promise(() => {}))
  await search(wrapper, 'pending')
  const signal = list.mock.calls.at(-1)?.[1]
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  expect(signal?.aborted).toBe(true)
})

it('批量删完末页后先刷新该页再回退，保留后端检索条件', async () => {
  const list = vi.mocked(modeling.listModelingPipelines)
  let deleted = false
  list.mockImplementation((query = {}) =>
    Promise.resolve({
      items: query.page === 2 ? (deleted ? [] : [row('last')]) : [row('kept')],
      total: deleted ? 20 : 21,
      page: query.page ?? 1,
      size: 20,
    }),
  )
  vi.spyOn(modeling, 'deleteModelingPipeline').mockImplementation(() => {
    deleted = true
    return Promise.resolve()
  })
  const wrapper = await open()
  await search(wrapper, '  kept-server-scope  ')
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除工作流').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelingPipeline).toHaveBeenCalledExactlyOnceWith(
    'last',
  )
  expect(list.mock.calls.map(([query]) => query?.page)).toEqual([1, 1, 2, 2, 1])
  expect(list).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: 'kept-server-scope', includeInstances: false },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('kept')
  expect(wrapper.text()).toContain('已选择 0 项')
  expect(button(wrapper, '批量删除工作流').attributes('disabled')).toBeDefined()
})
