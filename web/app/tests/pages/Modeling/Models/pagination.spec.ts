/** @fileoverview 模型与绑定的后端分页检索、查询取消及批量未知结果保护。 */
import type {
  ModelingBinding,
  ModelingVersionSummary,
  Page,
} from '@dt/contracts'
import * as ui from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TransportError } from '@/api/client'
import * as hierarchy from '@/api/hierarchy'
import * as modeling from '@/api/modeling'
import * as workflow from '@/api/modelingWorkflow'
import ModelsPage from '@/pages/Modeling/Models/index.vue'
import { versionSummary } from '@/testing/modelingTemplateFixtures'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/modeling/models', query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
const wrappers: VueWrapper[] = []
const ask = vi.fn().mockResolvedValue(true)
function page<TRow>(items: TRow[], total = items.length): Page<TRow> {
  return { items, page: 1, size: 20, total }
}
function version(id = 'v1', name = '普通模型'): ModelingVersionSummary {
  return { ...versionSummary, id, name }
}
function binding(): ModelingBinding {
  return {
    id: 'b1',
    fx_code: 'some_formula',
    model_version_id: 'not-on-version-page',
    model_name: '其他页的模型',
    model_version: 7,
    param_map: [],
    is_enabled: true,
    is_orphaned: false,
    created_by_name: null,
    created_at: versionSummary.created_at,
    updated_at: versionSummary.created_at,
  }
}
function open() {
  const wrapper = mount(ModelsPage, { global: { stubs: { Teleport: true } } })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, label: string) {
  const target = wrapper.findAll('button').find((item) => item.text() === label)
  if (!target) throw new Error(`没有按钮${label}`)
  return target
}
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  vi.spyOn(hierarchy, 'capabilities').mockRejectedValue(new Error('未启用'))
  const confirm = ui.useConfirm()
  ask.mockReset().mockResolvedValue(true)
  vi.spyOn(ui, 'useConfirm').mockReturnValue({ ...confirm, ask })
  vi.spyOn(modeling, 'listModelingVersions').mockResolvedValue(
    page([version()], 201),
  )
  vi.spyOn(modeling, 'listModelingBindings').mockResolvedValue(
    page([binding()], 83),
  )
  vi.spyOn(workflow, 'deleteModelingVersion').mockResolvedValue()
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  ui.useToast().clear()
  vi.restoreAllMocks()
})
it('两个列表默认20条并使用服务端总数，绑定名称无需扫版本或N+1', async () => {
  const get = vi.spyOn(modeling, 'getModelingVersion')
  const wrapper = open()
  await flushPromises()
  expect(modeling.listModelingVersions).toHaveBeenCalledWith(
    { page: 1, size: 20, q: '', pipelineId: undefined },
    expect.any(AbortSignal),
  )
  expect(modeling.listModelingBindings).toHaveBeenCalledWith(
    { page: 1, size: 20, q: '' },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('共 201 条')
  expect(wrapper.text()).toContain('共 83 条')
  expect(wrapper.text()).toContain('其他页的模型 v7')
  expect(get).not.toHaveBeenCalled()
})
it('检索提交到后端且回第一页，不对服务端匹配结果再本地过滤', async () => {
  vi.mocked(modeling.listModelingVersions).mockImplementation((query) =>
    Promise.resolve(
      page([version('remote', query?.q ? '名称不含关键词' : '初始模型')], 201),
    ),
  )
  const wrapper = open()
  await flushPromises()
  const block = wrapper.findAll('.dt-ml-models__block')[0]
  await block
    ?.findAll('button')
    .find((item) => item.text() === '下一页')
    ?.trigger('click')
  await flushPromises()
  await wrapper
    .get('input[aria-label="搜索模型版本"]')
    .setValue('  工作流远端匹配  ')
  await wrapper.get('button[aria-label="搜索模型版本"]').trigger('click')
  await flushPromises()
  expect(modeling.listModelingVersions).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '工作流远端匹配', pipelineId: undefined },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('名称不含关键词')
  expect(
    wrapper.get('input[aria-label="搜索模型版本"]').attributes('maxlength'),
  ).toBe('128')
})
it('公式绑定独立后端检索，不改变版本列表查询', async () => {
  const wrapper = open()
  await flushPromises()
  vi.mocked(modeling.listModelingVersions).mockClear()
  await wrapper
    .get('input[aria-label="搜索公式绑定"]')
    .setValue('  绑定模型名称  ')
  await wrapper.get('button[aria-label="搜索公式绑定"]').trigger('click')
  await flushPromises()
  expect(modeling.listModelingBindings).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '绑定模型名称' },
    expect.any(AbortSignal),
  )
  expect(modeling.listModelingVersions).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('some_formula')
})
it('新检索取消旧请求且迟到结果不覆盖当前匹配', async () => {
  let finish: ((result: Page<ModelingVersionSummary>) => void) | undefined
  let signal: AbortSignal | undefined
  vi.mocked(modeling.listModelingVersions).mockImplementation((query, given) =>
    query?.q === 'slow'
      ? new Promise((resolve) => {
          finish = resolve
          signal = given
        })
      : Promise.resolve(
          page(
            [version('fresh', query?.q === 'fast' ? '新结果' : '初始结果')],
            1,
          ),
        ),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="搜索模型版本"]').setValue('slow')
  await wrapper.get('button[aria-label="搜索模型版本"]').trigger('click')
  await flushPromises()
  await wrapper.get('input[aria-label="搜索模型版本"]').setValue('fast')
  await wrapper.get('button[aria-label="搜索模型版本"]').trigger('click')
  await flushPromises()
  expect(signal?.aborted).toBe(true)
  finish?.(page([version('stale', '迟到旧结果')]))
  await flushPromises()
  expect(wrapper.text()).toContain('新结果')
  expect(wrapper.text()).not.toContain('迟到旧结果')
})
it('删除最后一页最后模型后按真实总数回到有效末页', async () => {
  let deleted = false
  vi.mocked(modeling.listModelingVersions).mockImplementation((query) =>
    Promise.resolve(
      page(
        query?.page === 2 ? (deleted ? [] : [version('last')]) : [version()],
        deleted ? 20 : 21,
      ),
    ),
  )
  vi.mocked(workflow.deleteModelingVersion).mockImplementation(() => {
    deleted = true
    return Promise.resolve()
  })
  const wrapper = open()
  await flushPromises()
  const block = wrapper.findAll('.dt-ml-models__block')[0]
  await block
    ?.findAll('button')
    .find((item) => item.text() === '下一页')
    ?.trigger('click')
  await flushPromises()
  await block?.get('button[aria-label="删除"]').trigger('click')
  await flushPromises()
  expect(workflow.deleteModelingVersion).toHaveBeenCalledWith('last')
  expect(modeling.listModelingVersions).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '', pipelineId: undefined },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('普通模型')
})
it('改变后端检索范围清除选择，但不会解除未知写入锁', async () => {
  vi.mocked(workflow.deleteModelingVersion).mockRejectedValueOnce(
    new TransportError(0, '回执丢失'),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择 模型 普通模型 v1"]').setValue(true)
  await button(wrapper, '批量删除模型').trigger('click')
  await flushPromises()
  await wrapper.get('input[aria-label="搜索模型版本"]').setValue('另一个查询')
  await wrapper.get('button[aria-label="搜索模型版本"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('结果待核查')
  expect(
    wrapper.get('button[aria-label="删除"]').attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 模型 普通模型 v1"]')
      .element.checked,
  ).toBe(false)
})

it('两个工具条都不占标签行，搜索仍有可访问名称', async () => {
  const wrapper = open()
  await flushPromises()
  for (const toolbar of wrapper.findAll('.dt-data-view__toolbar')) {
    expect(toolbar.find('.dt-field__label').exists()).toBe(false)
  }
  expect(wrapper.find('input[aria-label="搜索模型版本"]').exists()).toBe(true)
  expect(wrapper.find('input[aria-label="搜索公式绑定"]').exists()).toBe(true)
})

it('用页签切换模型版本与公式绑定，同一时间只显示一张表', async () => {
  const wrapper = open()
  await flushPromises()
  const blocks = wrapper.findAll<HTMLElement>('.dt-ml-models__block')
  const tabs = wrapper.get('[aria-label="模型分区"]')
  const shown = () =>
    blocks.map((block) => block.element.style.display !== 'none')
  expect(tabs.findAll('button').map((item) => item.text())).toEqual([
    '模型版本',
    '公式绑定',
  ])
  expect(shown()).toEqual([true, false])
  await button(wrapper, '公式绑定').trigger('click')
  expect(shown()).toEqual([false, true])
  await button(wrapper, '模型版本').trigger('click')
  expect(shown()).toEqual([true, false])
})

it('切换页签保留另一张表的搜索词，不重新取数', async () => {
  const wrapper = open()
  await flushPromises()
  const input = wrapper.get<HTMLInputElement>(
    'input[aria-label="搜索模型版本"]',
  )
  await input.setValue('冷机')
  const list = vi.mocked(modeling.listModelingVersions)
  const calls = list.mock.calls.length
  await button(wrapper, '公式绑定').trigger('click')
  await button(wrapper, '模型版本').trigger('click')
  await flushPromises()
  expect(input.element.value).toBe('冷机')
  expect(list.mock.calls.length).toBe(calls)
})
