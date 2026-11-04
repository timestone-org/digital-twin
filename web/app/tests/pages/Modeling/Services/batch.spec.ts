/** @fileoverview 部署批量启停与删除保留逐项修订、确认和未知结果保护。 */
import { PERMISSION_CODES } from '@dt/contracts'
import type { ModelDeployment } from '@dt/contracts'
import * as ui from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BizError, TransportError } from '@/api/client'
import * as hierarchy from '@/api/hierarchy'
import * as modeling from '@/api/modeling'
import * as serving from '@/api/modelingServing'
import ServicesPage from '@/pages/Modeling/Services/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/modeling/services', query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
const STAMP = '2026-11-04T00:00:00Z'
const wrappers: VueWrapper[] = []
const ask = vi.fn().mockResolvedValue(true)
function deployment(id: string, revision = 1, enabled = true): ModelDeployment {
  return {
    id,
    revision,
    code: id,
    model_version_id: 'v1',
    model_name: '模型',
    model_version: 1,
    task: 'regression',
    name: id,
    description: null,
    is_enabled: enabled,
    is_servable: true,
    unservable_reason: null,
    max_rows_per_call: 200,
    rate_limit_per_minute: 60,
    key_count: 0,
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
  }
}
function open() {
  const wrapper = mount(ServicesPage, { global: { stubs: { Teleport: true } } })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const target = wrapper.findAll('button').find((item) => item.text() === text)
  if (!target) throw new Error(`缺少按钮：${text}`)
  return target
}
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockImplementation((codes) =>
    codes.includes(PERMISSION_CODES.modelingPublish),
  )
  vi.spyOn(hierarchy, 'capabilities').mockRejectedValue(new Error('未启用'))
  const confirm = ui.useConfirm()
  ask.mockReset().mockResolvedValue(true)
  vi.spyOn(ui, 'useConfirm').mockReturnValue({ ...confirm, ask })
  vi.spyOn(modeling, 'listModelDeployments').mockResolvedValue([
    deployment('d1', 2),
    deployment('d2', 5),
  ])
  vi.spyOn(modeling, 'listAllModelingVersions').mockResolvedValue([])
  vi.spyOn(modeling, 'getModelDeployment').mockImplementation((id) =>
    Promise.resolve(deployment(id, 8)),
  )
  vi.spyOn(modeling, 'deleteModelDeployment').mockResolvedValue()
  vi.spyOn(modeling, 'updateModelDeployment').mockImplementation((id, patch) =>
    Promise.resolve({
      ...deployment(id),
      is_enabled: patch.is_enabled ?? true,
    }),
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  ui.useToast().clear()
  vi.restoreAllMocks()
})
it('仅查看或管理权限不显示服务批量选择', async () => {
  vi.mocked(useAuthStore().can).mockReturnValue(false)
  const wrapper = open()
  await flushPromises()
  expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
})
it('批量停用逐项携带所选行修订号，统一确认并刷新一次', async () => {
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量停用服务').trigger('click')
  await flushPromises()
  expect(modeling.updateModelDeployment).toHaveBeenNthCalledWith(1, 'd1', {
    is_enabled: false,
    expected_revision: 2,
  })
  expect(modeling.updateModelDeployment).toHaveBeenNthCalledWith(2, 'd2', {
    is_enabled: false,
    expected_revision: 5,
  })
  expect(modeling.getModelDeployment).not.toHaveBeenCalled()
  expect(ask).toHaveBeenCalledOnce()
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      danger: true,
      message: expect.stringContaining('立即被拒绝'),
    }),
  )
  expect(modeling.listModelDeployments).toHaveBeenCalledTimes(2)
})
it('批量启用跳过已启用项，不改变其余配置', async () => {
  vi.mocked(modeling.listModelDeployments).mockResolvedValue([
    deployment('d1', 2),
    deployment('d2', 5, false),
  ])
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量启用服务').trigger('click')
  await flushPromises()
  expect(modeling.updateModelDeployment).toHaveBeenCalledOnce()
  expect(modeling.updateModelDeployment).toHaveBeenCalledWith('d2', {
    is_enabled: true,
    expected_revision: 5,
  })
  expect(wrapper.text()).toContain('服务已启用')
})
it('网络未知结果停止后续写入且禁止直接重复批次', async () => {
  vi.mocked(modeling.deleteModelDeployment).mockRejectedValueOnce(
    new TransportError(0, '连接中断'),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除服务').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelDeployment).toHaveBeenCalledOnce()
  expect(wrapper.text()).toContain('结果待核查')
  expect(button(wrapper, '批量删除服务').attributes('disabled')).toBeDefined()
  await button(wrapper, '批量删除服务').trigger('click')
  expect(modeling.deleteModelDeployment).toHaveBeenCalledOnce()
})

it('未知结果后单项写也锁定，调用说明仍可读取，显式清除后恢复', async () => {
  vi.mocked(modeling.deleteModelDeployment).mockRejectedValueOnce(
    new TransportError(0, '连接中断'),
  )
  vi.spyOn(modeling, 'listModelCallStats').mockResolvedValue([])
  vi.spyOn(serving, 'getOpenModelSignature').mockResolvedValue({
    task: 'regression',
    invoke_url: '/api/v1/platform/open-models/d1:predict',
    timestamp_key: null,
    inputs: [],
    output: { task: 'regression' },
  })
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除服务').trigger('click')
  await flushPromises()
  await wrapper.get('button[aria-label="停用"]').trigger('click')
  await flushPromises()
  expect(modeling.updateModelDeployment).not.toHaveBeenCalled()
  await wrapper.get('button[aria-label="改配置"]').trigger('click')
  expect(wrapper.findComponent({ name: 'DeploymentFormDialog' }).exists()).toBe(
    false,
  )
  await button(wrapper, '调用说明').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('用户 APIKey')
  expect(serving.getOpenModelSignature).toHaveBeenCalledWith(
    'd1',
    expect.any(AbortSignal),
  )
  await button(wrapper, '关闭').trigger('click')
  await button(wrapper, '清除选择与结果').trigger('click')
  await wrapper.get('button[aria-label="停用"]').trigger('click')
  await flushPromises()
  expect(modeling.updateModelDeployment).toHaveBeenCalledOnce()
})

it('取消批量确认不锁住单项服务修改', async () => {
  ask.mockResolvedValueOnce(false)
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除服务').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelDeployment).not.toHaveBeenCalled()
  await wrapper.get('button[aria-label="停用"]').trigger('click')
  await flushPromises()
  expect(modeling.updateModelDeployment).toHaveBeenCalledOnce()
})
it('明确引用冲突仅保留失败选择并继续下一项', async () => {
  vi.mocked(modeling.deleteModelDeployment).mockRejectedValueOnce(
    new BizError(41438, '部署仍被引用', 409, 'trace'),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除服务').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelDeployment).toHaveBeenCalledTimes(2)
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 服务 d1"]').element
      .checked,
  ).toBe(true)
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 服务 d2"]').element
      .checked,
  ).toBe(false)
  expect(wrapper.text()).toContain('部署仍被引用')
})
it('缺少旧修订号时通过可取消详情读取补取，卸载后不发写请求', async () => {
  const legacy = deployment('d1')
  delete legacy.revision
  vi.mocked(modeling.listModelDeployments).mockResolvedValue([legacy])
  let finish: ((row: ModelDeployment) => void) | undefined
  let signal: AbortSignal | undefined
  vi.mocked(modeling.getModelDeployment).mockImplementation((_id, given) => {
    signal = given
    return new Promise<ModelDeployment>((resolve) => {
      finish = resolve
    })
  })
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量停用服务').trigger('click')
  await flushPromises()
  expect(
    wrapper.get('button[aria-label="停用"]').attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper.get('input[aria-label="选择 服务 d1"]').attributes('disabled'),
  ).toBeDefined()
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  expect(signal?.aborted).toBe(true)
  finish?.(deployment('d1', 8))
  await flushPromises()
  expect(modeling.updateModelDeployment).not.toHaveBeenCalled()
  expect(modeling.listModelDeployments).toHaveBeenCalledOnce()
})
it('旧列表补取详情后使用真实修订，拒绝确认不删除服务', async () => {
  const legacy = deployment('d1')
  delete legacy.revision
  vi.mocked(modeling.listModelDeployments).mockResolvedValue([legacy])
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量停用服务').trigger('click')
  await flushPromises()
  expect(modeling.updateModelDeployment).toHaveBeenCalledWith('d1', {
    is_enabled: false,
    expected_revision: 8,
  })
  ask.mockResolvedValueOnce(false)
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除服务').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelDeployment).not.toHaveBeenCalled()
})

it('详情仍没有修订号时明确拒绝该项，继续处理有修订号的服务', async () => {
  const legacy = deployment('d1')
  delete legacy.revision
  vi.mocked(modeling.listModelDeployments).mockResolvedValue([
    legacy,
    deployment('d2', 5),
  ])
  vi.mocked(modeling.getModelDeployment).mockResolvedValue(legacy)
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量停用服务').trigger('click')
  await flushPromises()
  expect(modeling.updateModelDeployment).toHaveBeenCalledOnce()
  expect(modeling.updateModelDeployment).toHaveBeenCalledWith('d2', {
    is_enabled: false,
    expected_revision: 5,
  })
  expect(wrapper.text()).toContain('服务没有返回修订号')
  expect(wrapper.text()).not.toContain('结果待核查')
})
