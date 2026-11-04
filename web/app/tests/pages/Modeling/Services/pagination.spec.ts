/** @fileoverview 部署后端分页检索、状态过滤、查询取消与当前页选择保护。 */
import type {
  ModelDeployment,
  ModelCallStat,
  Page,
  OpenModelSignature,
} from '@dt/contracts'
import * as ui from '@dt/ui'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BizError, TransportError } from '@/api/client'
import * as hierarchy from '@/api/hierarchy'
import * as modeling from '@/api/modeling'
import * as serving from '@/api/modelingServing'
import ServicesPage from '@/pages/Modeling/Services/index.vue'
import ServiceFilters from '@/pages/Modeling/Services/components/ServiceFilters.vue'
import DeploymentTable from '@/pages/Modeling/Services/components/DeploymentTable.vue'
import DeploymentAccessDrawer from '@/pages/Modeling/Services/components/DeploymentAccessDrawer.vue'
import { deployment as source } from '@/testing/modelingTemplateFixtures'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/modeling/services', query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
const wrappers: VueWrapper[] = []
const ask = vi.fn().mockResolvedValue(true)
function deployment(id = 'd1', name = '常规服务'): ModelDeployment {
  return { ...source, id, name, code: id, revision: 2 }
}
function page(
  items: ModelDeployment[],
  total = items.length,
): Page<ModelDeployment> {
  return { items, page: 1, size: 20, total }
}
function open() {
  const wrapper = mount(ServicesPage, {
    attachTo: document.body,
    global: { stubs: { Teleport: false } },
  })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, label: string) {
  const target = wrapper.findAll('button').find((item) => item.text() === label)
  if (!target) throw new Error(`没有按钮${label}`)
  return target
}
async function search(wrapper: VueWrapper, value: string) {
  await wrapper.get('input[aria-label="搜索已发布模型"]').setValue(value)
  await wrapper.get('button[aria-label="搜索已发布模型"]').trigger('click')
  await flushPromises()
}
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  vi.spyOn(hierarchy, 'capabilities').mockRejectedValue(new Error('未启用'))
  const confirm = ui.useConfirm()
  ask.mockReset().mockResolvedValue(true)
  vi.spyOn(ui, 'useConfirm').mockReturnValue({ ...confirm, ask })
  vi.spyOn(modeling, 'listModelDeploymentsPage').mockResolvedValue(
    page([deployment()], 201),
  )
  vi.spyOn(modeling, 'getModelDeployment').mockResolvedValue(deployment())
  vi.spyOn(modeling, 'listModelCallStats').mockResolvedValue([])
  vi.spyOn(modeling, 'deleteModelDeployment').mockResolvedValue()
  vi.spyOn(modeling, 'updateModelDeployment').mockResolvedValue(deployment())
  vi.spyOn(serving, 'getOpenModelSignature').mockResolvedValue({
    task: 'regression',
    invoke_url: '/api/v1/platform/open-models/d1:predict',
    timestamp_key: null,
    inputs: [],
    output: { task: 'regression' },
  } satisfies OpenModelSignature)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  ui.useToast().clear()
  vi.restoreAllMocks()
})
it('默认20条显示真实总数，挂载不读取静态版本全集', async () => {
  const versions = vi.spyOn(modeling, 'listModelingVersions')
  const pinned = vi.spyOn(modeling, 'getModelingVersion')
  const wrapper = open()
  await flushPromises()
  expect(modeling.listModelDeploymentsPage).toHaveBeenCalledWith(
    { page: 1, size: 20, q: '', isEnabled: undefined },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('共 201 条')
  expect(versions).not.toHaveBeenCalled()
  expect(pinned).not.toHaveBeenCalled()
})
it('关键词与状态都发给后端，检索从第一页开始并保留跨页匹配', async () => {
  vi.mocked(modeling.listModelDeploymentsPage).mockImplementation((query) =>
    Promise.resolve(
      page(
        [deployment('remote', query?.q ? '名称不同的后端匹配' : '初始服务')],
        201,
      ),
    ),
  )
  const wrapper = open()
  await flushPromises()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  await search(wrapper, '  工作流检索  ')
  expect(modeling.listModelDeploymentsPage).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '工作流检索', isEnabled: undefined },
    expect.any(AbortSignal),
  )
  expect(wrapper.text()).toContain('名称不同的后端匹配')
  wrapper
    .getComponent(ServiceFilters)
    .getComponent(ui.DtSelect)
    .vm.$emit('update:modelValue', 'disabled')
  await flushPromises()
  expect(modeling.listModelDeploymentsPage).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '工作流检索', isEnabled: false },
    expect.any(AbortSignal),
  )
  expect(
    wrapper.get('input[aria-label="搜索已发布模型"]').attributes('maxlength'),
  ).toBe('128')
})
it('快速后端检索会取消旧页，迟到响应不能覆盖当前结果', async () => {
  let complete: ((value: Page<ModelDeployment>) => void) | undefined
  let signal: AbortSignal | undefined
  vi.mocked(modeling.listModelDeploymentsPage).mockImplementation(
    (query, given) =>
      query?.q === 'slow'
        ? new Promise((resolve) => {
            complete = resolve
            signal = given
          })
        : Promise.resolve(
            page(
              [
                deployment(
                  'fresh',
                  query?.q === 'fast' ? '当前结果' : '初始结果',
                ),
              ],
              1,
            ),
          ),
  )
  const wrapper = open()
  await flushPromises()
  await search(wrapper, 'slow')
  await search(wrapper, 'fast')
  expect(signal?.aborted).toBe(true)
  complete?.(page([deployment('stale', '迟到结果')]))
  await flushPromises()
  expect(wrapper.text()).toContain('当前结果')
  expect(wrapper.text()).not.toContain('迟到结果')
})
it('切页取消当前调用统计并关闭旧详情', async () => {
  let complete: ((value: ModelCallStat[]) => void) | undefined
  let signal: AbortSignal | undefined
  vi.mocked(modeling.listModelCallStats).mockImplementation((_id, given) => {
    signal = given
    return new Promise((resolve) => {
      complete = resolve
    })
  })
  const wrapper = open()
  await flushPromises()
  await button(wrapper, '调用说明').trigger('click')
  await flushPromises()
  wrapper.getComponent(DeploymentTable).vm.$emit('update:page', 2)
  await flushPromises()
  expect(signal?.aborted).toBe(true)
  expect(
    wrapper.getComponent(DeploymentAccessDrawer).props('deployment'),
  ).toBeNull()
  complete?.([])
  await flushPromises()
  expect(
    wrapper.getComponent(DeploymentAccessDrawer).props('deployment'),
  ).toBeNull()
})
it('普通刷新缺少当前详情行时读详情确认，不把当前页缺项当删除', async () => {
  vi.mocked(modeling.listModelDeploymentsPage)
    .mockResolvedValueOnce(
      page([deployment('d1'), deployment('d2', '另一个服务')], 2),
    )
    .mockResolvedValue(page([deployment('d2', '另一个服务')], 1))
  const wrapper = open()
  await flushPromises()
  await button(wrapper, '调用说明').trigger('click')
  await flushPromises()
  const actions = wrapper.findAll('button[aria-label="停用"]')
  await actions[1]?.trigger('click')
  await flushPromises()
  expect(modeling.getModelDeployment).toHaveBeenCalledWith(
    'd1',
    expect.any(AbortSignal),
  )
  expect(
    wrapper.getComponent(DeploymentAccessDrawer).props('deployment')?.id,
  ).toBe('d1')
})
it('只有详情明确404才关闭缺失记录，失败不扫描其他页', async () => {
  vi.mocked(modeling.listModelDeploymentsPage)
    .mockResolvedValueOnce(page([deployment('d1'), deployment('d2')], 2))
    .mockResolvedValue(page([deployment('d2')], 1))
  vi.mocked(modeling.getModelDeployment).mockRejectedValue(
    new BizError(41418, '服务已删除', 404, 'trace'),
  )
  const wrapper = open()
  await flushPromises()
  await button(wrapper, '调用说明').trigger('click')
  await flushPromises()
  await wrapper.findAll('button[aria-label="停用"]')[1]?.trigger('click')
  await flushPromises()
  expect(
    wrapper.getComponent(DeploymentAccessDrawer).props('deployment'),
  ).toBeNull()
  expect(modeling.listModelDeploymentsPage).toHaveBeenCalledTimes(2)
})
it('删除有效末页最后一条后回到新的末页', async () => {
  let deleted = false
  vi.mocked(modeling.listModelDeploymentsPage).mockImplementation((query) =>
    Promise.resolve(
      page(
        query?.page === 2
          ? deleted
            ? []
            : [deployment('last')]
          : [deployment()],
        deleted ? 20 : 21,
      ),
    ),
  )
  vi.mocked(modeling.deleteModelDeployment).mockImplementation(() => {
    deleted = true
    return Promise.resolve()
  })
  const wrapper = open()
  await flushPromises()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  await wrapper.get('button[aria-label="删掉"]').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelDeployment).toHaveBeenCalledWith('last')
  expect(modeling.listModelDeploymentsPage).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: '', isEnabled: undefined },
    expect.any(AbortSignal),
  )
})
it('未知写入后仍可后端检索，但改查询不会解除单项和批量锁', async () => {
  vi.mocked(modeling.deleteModelDeployment).mockRejectedValueOnce(
    new TransportError(0, '回执丢失'),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除服务').trigger('click')
  await flushPromises()
  await search(wrapper, '另一个查询')
  expect(wrapper.text()).toContain('结果待核查')
  expect(
    wrapper.get('button[aria-label="删掉"]').attributes('disabled'),
  ).toBeDefined()
  expect(button(wrapper, '批量删除服务').attributes('disabled')).toBeDefined()
})

it('每页条数变化回第一页，向后端提交新size并清除本页选择', async () => {
  const wrapper = open()
  await flushPromises()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  wrapper.getComponent(ui.DtPagination).vm.$emit('update:size', 50)
  await flushPromises()
  expect(modeling.listModelDeploymentsPage).toHaveBeenLastCalledWith(
    { page: 1, size: 50, q: '', isEnabled: undefined },
    expect.any(AbortSignal),
  )
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 服务 常规服务"]')
      .element.checked,
  ).toBe(false)
})

it('关闭编辑弹窗中止固定版本请求，不在后台继续读取目录', async () => {
  let signal: AbortSignal | undefined
  const read = vi
    .spyOn(modeling, 'getModelingVersion')
    .mockImplementation((_id, given) => {
      signal = given
      return new Promise(() => undefined)
    })
  const versions = vi.spyOn(modeling, 'listModelingVersions')
  const wrapper = open()
  await flushPromises()
  await wrapper.get('button[aria-label="改配置"]').trigger('click')
  await flushPromises()
  await new DOMWrapper(document.body)
    .get('button[aria-label="关闭"]')
    .trigger('click')
  await flushPromises()
  expect(signal?.aborted).toBe(true)
  expect(read).toHaveBeenCalledOnce()
  expect(versions).not.toHaveBeenCalled()
})

it('后端页读取失败允许显式重试，成功后恢复实际服务端总数', async () => {
  vi.mocked(modeling.listModelDeploymentsPage).mockRejectedValueOnce(
    new TransportError(503, '分页暂不可用'),
  )
  const wrapper = open()
  await flushPromises()
  expect(wrapper.text()).toContain('分页暂不可用')
  await button(wrapper, '重试').trigger('click')
  await flushPromises()
  expect(modeling.listModelDeploymentsPage).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('共 201 条')
})
