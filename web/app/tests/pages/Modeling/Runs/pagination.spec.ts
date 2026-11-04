/** @fileoverview 训练历史真实游标翻页、后端检索、目录选择及取消读取。 */
import type { CursorPage, ModelingRunSummary } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRoute } from 'vue-router'
import * as modeling from '@/api/modeling'
import Runs from '@/pages/Modeling/Runs/index.vue'
import { useAuthStore } from '@/stores/auth'
import { run } from '@/testing/modelingTemplateFixtures'

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  const route = reactive<{ path: string; query: Record<string, string> }>({
    path: '/modeling/runs',
    query: {},
  })
  return { useRoute: () => route, RouterLink: { template: '<a><slot /></a>' } }
})
const wrappers: VueWrapper[] = []
const cursor = 'opaque:after/+==%原样'
function page(id = 'r1', hasMore = true): CursorPage<ModelingRunSummary> {
  return {
    items: [
      { ...run, id, pipeline_id: 'p1', pipeline_name: `后端工作流 ${id}` },
    ],
    next: hasMore ? cursor : null,
    has_more: hasMore,
  }
}
function button(wrapper: VueWrapper, name: string) {
  const found = wrapper
    .findAll('button')
    .find(
      (item) => (item.attributes('aria-label') ?? item.text().trim()) === name,
    )
  if (!found) throw new Error(`缺少按钮：${name}`)
  return found
}
async function open() {
  const wrapper = mount(Runs, {
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
async function search(wrapper: VueWrapper, text: string): Promise<void> {
  await wrapper.get('input[type="search"]').setValue(text)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
function select(wrapper: VueWrapper, label: string, value: string): void {
  const field = wrapper
    .findAllComponents(DtSelect)
    .find(
      (item) =>
        item.props('label') === label || item.props('ariaLabel') === label,
    )
  if (!field) throw new Error(`缺少选项：${label}`)
  field.vm.$emit('update:modelValue', value)
}
beforeEach(() => {
  useRoute().query = {}
  localStorage.clear()
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  vi.spyOn(modeling, 'listModelingRunHistory').mockResolvedValue(page())
  vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue({
    items: [],
    page: 1,
    size: 20,
    total: 0,
  })
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})

it('原样传递游标、上一页重放入口，刷新保留当前页且不伪造总数', async () => {
  const list = vi.mocked(modeling.listModelingRunHistory)
  const wrapper = await open()
  expect(modeling.listModelingPipelines).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('后端工作流 r1')
  expect(wrapper.text()).toContain('第 1 页 · 本页 1 条')
  expect(wrapper.findComponent({ name: 'DtPagination' }).exists()).toBe(false)
  list.mockResolvedValueOnce(page('r2', false))
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    null,
    { limit: 20, after: cursor },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('第 2 页 · 本页 1 条')
  expect(wrapper.text()).not.toContain('后端工作流 r1')
  expect(button(wrapper, '下一页').attributes('disabled')).toBeDefined()
  await button(wrapper, '刷新训练状态').trigger('click')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    null,
    { limit: 20, after: cursor },
    expect.any(AbortSignal),
  )
  await button(wrapper, '上一页').trigger('click')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    null,
    { limit: 20 },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('第 1 页 · 本页 1 条')
})

it('提交后端检索、状态和每页数量均重置游标，不在客户端再次过滤结果', async () => {
  const list = vi.mocked(modeling.listModelingRunHistory)
  const wrapper = await open()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  await wrapper.get('input[type="search"]').setValue('  rare-owner  ')
  expect(list).toHaveBeenCalledTimes(2)
  list.mockResolvedValueOnce(page('远程第350条'))
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    null,
    { limit: 20, q: 'rare-owner' },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('后端工作流 远程第350条')
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  select(wrapper, '训练状态', 'failed')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    null,
    { limit: 20, q: 'rare-owner', status: 'failed' },
    expect.any(AbortSignal),
  )
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  select(wrapper, '每页条数', '100')
  await flushPromises()
  expect(list).toHaveBeenLastCalledWith(
    null,
    { limit: 100, q: 'rare-owner', status: 'failed' },
    expect.any(AbortSignal),
  )
  select(wrapper, '每页条数', '999')
  select(wrapper, '训练状态', 'invalid')
  await flushPromises()
  expect(list).toHaveBeenCalledTimes(7)
  expect(wrapper.get('input[type="search"]').attributes('maxlength')).toBe(
    '128',
  )
})

it('后端工作流目录选择更新筛选且不逐行读取名称，当前选中名称无需再请求详情', async () => {
  const pipeline = {
    id: 'p350',
    code: 'remote_350',
    name: '远程工作流',
    description: null,
    node_count: 1,
    source_table_codes: [],
    created_by_name: null,
    created_at: run.created_at,
    updated_at: run.created_at,
  }
  const getPipeline = vi.spyOn(modeling, 'getModelingPipeline')
  vi.mocked(modeling.listModelingPipelines).mockResolvedValue({
    items: [pipeline],
    page: 1,
    size: 20,
    total: 1,
  })
  const wrapper = await open()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  await button(wrapper, '筛选工作流').trigger('click')
  await flushPromises()
  await button(wrapper, '选择工作流 远程工作流').trigger('click')
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenLastCalledWith(
    'p350',
    { limit: 20 },
    expect.any(AbortSignal),
  )
  expect(button(wrapper, '筛选工作流').text()).toBe('远程工作流')
  expect(getPipeline).not.toHaveBeenCalled()
  await button(wrapper, '筛选工作流').trigger('click')
  await flushPromises()
  await button(wrapper, '全部工作流').trigger('click')
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenLastCalledWith(
    null,
    { limit: 20 },
    expect.any(AbortSignal),
  )
})

it('快速提交检索取消旧请求并忽略迟到响应，卸载取消最新读取', async () => {
  const list = vi.mocked(modeling.listModelingRunHistory)
  const wrapper = await open()
  let finish: ((value: CursorPage<ModelingRunSummary>) => void) | undefined
  list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValueOnce(page('new'))
  await search(wrapper, 'old')
  const staleSignal = list.mock.calls.at(-1)?.[2]
  await search(wrapper, 'new')
  expect(staleSignal?.aborted).toBe(true)
  finish?.(page('old'))
  await flushPromises()
  expect(wrapper.text()).toContain('后端工作流 new')
  expect(wrapper.text()).not.toContain('后端工作流 old')
  list.mockImplementationOnce(() => new Promise(() => {}))
  await search(wrapper, 'pending')
  const signal = list.mock.calls.at(-1)?.[2]
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  expect(signal?.aborted).toBe(true)
})

it('带工作流ID直达只读取该条详情，切换时取消旧名称请求', async () => {
  useRoute().query = { pipeline_id: 'first' }
  let finish:
    | ((
        value: Awaited<ReturnType<typeof modeling.getModelingPipeline>>,
      ) => void)
    | undefined
  const get = vi
    .spyOn(modeling, 'getModelingPipeline')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValueOnce({
      id: 'next',
      code: 'next',
      name: '新选中工作流',
      description: null,
      node_count: 0,
      source_table_codes: [],
      created_by_name: null,
      created_at: run.created_at,
      updated_at: run.created_at,
      graph: { format_version: '1.0', nodes: [], edges: [] },
    })
  const wrapper = await open()
  const signal = get.mock.calls[0]?.[1]
  useRoute().query = { pipeline_id: 'next' }
  await flushPromises()
  expect(signal?.aborted).toBe(true)
  expect(get).toHaveBeenCalledTimes(2)
  finish?.({
    id: 'first',
    code: 'first',
    name: '旧名称',
    description: null,
    node_count: 0,
    source_table_codes: [],
    created_by_name: null,
    created_at: run.created_at,
    updated_at: run.created_at,
    graph: { format_version: '1.0', nodes: [], edges: [] },
  })
  await flushPromises()
  expect(button(wrapper, '筛选工作流').text()).toBe('新选中工作流')
  expect(modeling.listModelingPipelines).not.toHaveBeenCalled()
})
