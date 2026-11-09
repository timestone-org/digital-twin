/** @fileoverview 模型版本与公式绑定的本页批量管理、权限和失败保护。 */
import { PERMISSION_CODES } from '@dt/contracts'
import type { ModelingBinding, ModelingVersionSummary } from '@dt/contracts'
import * as ui from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BizError, TransportError } from '@/api/client'
import * as hierarchy from '@/api/hierarchy'
import * as modeling from '@/api/modeling'
import * as workflow from '@/api/modelingWorkflow'
import ModelsPage from '@/pages/Modeling/Models/index.vue'
import VersionTable from '@/pages/Modeling/Models/components/VersionTable.vue'
import VersionDetailDialog from '@/pages/Modeling/Models/components/VersionDetailDialog.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/modeling/models', query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
const STAMP = '2026-11-04T00:00:00Z'
const wrappers: VueWrapper[] = []
const ask = vi.fn().mockResolvedValue(true)
function version(
  id: string,
  changes: Partial<ModelingVersionSummary> = {},
): ModelingVersionSummary {
  return {
    id,
    pipeline_id: 'p1',
    run_id: `run-${id}`,
    version: 1,
    name: id,
    algo: 'linear_regression',
    task: 'regression',
    is_servable: true,
    serving_channel: 'json',
    unservable_reason: null,
    feature_keys: ['temperature'],
    target_key: 'energy',
    created_by_name: null,
    created_at: STAMP,
    ...changes,
  }
}
function binding(id: string, enabled = true): ModelingBinding {
  return {
    id,
    fx_code: `formula-${id}`,
    model_version_id: 'v1',
    param_map: [],
    is_enabled: enabled,
    is_orphaned: false,
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
  }
}
function open() {
  const wrapper = mount(ModelsPage, { global: { stubs: { Teleport: true } } })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const target = wrapper.findAll('button').find((item) => item.text() === text)
  if (!target) throw new Error(`缺少按钮：${text}`)
  return target
}
async function choose(wrapper: VueWrapper, names: string[]) {
  for (const name of names)
    await wrapper.get(`input[aria-label="选择 ${name}"]`).setValue(true)
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
  vi.spyOn(modeling, 'listModelingVersions').mockResolvedValue({
    items: [version('v1'), version('v2')],
    page: 1,
    size: 200,
    total: 2,
  })
  vi.spyOn(modeling, 'listModelingBindings').mockResolvedValue({
    items: [binding('b1'), binding('b2', false)],
    page: 1,
    size: 200,
    total: 2,
  })
  vi.spyOn(workflow, 'deleteModelingVersion').mockResolvedValue()
  vi.spyOn(modeling, 'deleteModelingBinding').mockResolvedValue()
  vi.spyOn(modeling, 'archiveModelingVersion').mockImplementation((id) =>
    Promise.resolve({
      ...version(id, { is_servable: false }),
      signature: {},
      metrics: {},
      fingerprint: {},
      description: null,
    }),
  )
  vi.spyOn(modeling, 'updateModelingBinding').mockImplementation((id, patch) =>
    Promise.resolve({
      ...binding(id),
      is_enabled: patch.is_enabled ?? true,
      model_version_id: patch.model_version_id ?? 'v1',
      usages: [],
    }),
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  ui.useToast().clear()
  vi.restoreAllMocks()
})
it('仅管理权限不显示版本删除和两类选择，发布权限可单项删除', async () => {
  vi.mocked(useAuthStore().can).mockImplementation((codes) =>
    codes.includes(PERMISSION_CODES.modelingManage),
  )
  const denied = open()
  await flushPromises()
  expect(denied.find('input[type="checkbox"]').exists()).toBe(false)
  expect(denied.find('button[aria-label="删除"]').exists()).toBe(false)
  denied.unmount()
  wrappers.splice(wrappers.indexOf(denied), 1)
  vi.mocked(useAuthStore().can).mockImplementation((codes) =>
    codes.includes(PERMISSION_CODES.modelingPublish),
  )
  const allowed = open()
  await flushPromises()
  await allowed.get('button[aria-label="删除"]').trigger('click')
  await flushPromises()
  expect(workflow.deleteModelingVersion).toHaveBeenCalledWith('v1')
})
it('批量删除版本保留冲突选择并只刷新一次，不提供批量发布', async () => {
  vi.mocked(workflow.deleteModelingVersion).mockRejectedValueOnce(
    new BizError(41438, '版本仍绑定公式', 409, 'trace'),
  )
  const wrapper = open()
  await flushPromises()
  await choose(wrapper, ['模型 v1 v1', '模型 v2 v1'])
  expect(
    wrapper.findAll('button').some((item) => item.text() === '批量发布'),
  ).toBe(false)
  await button(wrapper, '批量删除模型').trigger('click')
  await flushPromises()
  expect(workflow.deleteModelingVersion).toHaveBeenCalledTimes(2)
  expect(modeling.listModelingVersions).toHaveBeenCalledTimes(2)
  expect(modeling.listModelingBindings).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('版本仍绑定公式')
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 模型 v1 v1"]').element
      .checked,
  ).toBe(true)
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 模型 v2 v1"]').element
      .checked,
  ).toBe(false)
})
it('批量下线走归档而不删除，已下线版本跳过并说明影响', async () => {
  vi.mocked(modeling.listModelingVersions).mockResolvedValue({
    items: [
      version('v1', { is_servable: false }),
      version('v2', { archived_at: '2026-01-01T00:00:00Z' }),
    ],
    page: 1,
    size: 200,
    total: 2,
  })
  const wrapper = open()
  await flushPromises()
  await choose(wrapper, ['模型 v1 v1', '模型 v2 v1'])
  await button(wrapper, '批量下线模型').trigger('click')
  await flushPromises()
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      danger: true,
      message: expect.stringContaining('服务端拒绝下线'),
    }),
  )
  expect(modeling.archiveModelingVersion).toHaveBeenCalledOnce()
  expect(modeling.archiveModelingVersion).toHaveBeenCalledWith('v1')
  expect(workflow.deleteModelingVersion).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('模型已下线')
})

it('未知结果后详情仍可读取，详情注册被阻止且清除后恢复', async () => {
  vi.mocked(useAuthStore().can).mockReturnValue(true)
  vi.mocked(workflow.deleteModelingVersion).mockRejectedValueOnce(
    new TransportError(0, '写入响应丢失'),
  )
  vi.spyOn(modeling, 'getModelingVersion').mockResolvedValue({
    ...version('v1'),
    signature: {},
    metrics: {},
    fingerprint: {},
    description: null,
  })
  const register = vi
    .spyOn(modeling, 'registerModelingFormula')
    .mockRejectedValue(new BizError(41414, '公式已存在', 409, 'trace'))
  const wrapper = open()
  await flushPromises()
  await choose(wrapper, ['模型 v1 v1'])
  await button(wrapper, '批量删除模型').trigger('click')
  await flushPromises()
  await wrapper.get('button[aria-label="详情"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('要提供哪几列')
  await button(wrapper, '注册').trigger('click')
  await flushPromises()
  expect(register).not.toHaveBeenCalled()
  wrapper.getComponent(VersionDetailDialog).vm.$emit('register', '仍需核查')
  await flushPromises()
  expect(register).not.toHaveBeenCalled()
  await button(wrapper, '关闭').trigger('click')
  await button(wrapper, '清除选择与结果').trigger('click')
  await wrapper.get('button[aria-label="详情"]').trigger('click')
  await flushPromises()
  await button(wrapper, '注册').trigger('click')
  await flushPromises()
  expect(register).toHaveBeenCalledOnce()
})

it.each(['version', 'binding'] as const)(
  '$source未知结果同时锁住版本和绑定的批量与单项写',
  async (source) => {
    if (source === 'version')
      vi.mocked(workflow.deleteModelingVersion).mockRejectedValueOnce(
        new TransportError(0, '响应丢失'),
      )
    else
      vi.mocked(modeling.deleteModelingBinding).mockRejectedValueOnce(
        new TransportError(0, '响应丢失'),
      )
    const wrapper = open()
    await flushPromises()
    await choose(wrapper, ['模型 v1 v1', '公式绑定 formula-b1'])
    await button(
      wrapper,
      source === 'version' ? '批量删除模型' : '批量解除绑定',
    ).trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="下线"]').trigger('click')
    await wrapper.get('button[aria-label="启用这条绑定"]').trigger('click')
    await button(wrapper, '批量下线模型').trigger('click')
    await button(wrapper, '批量停用绑定').trigger('click')
    await flushPromises()
    expect(modeling.archiveModelingVersion).not.toHaveBeenCalled()
    expect(modeling.updateModelingBinding).not.toHaveBeenCalled()
  },
)
it.each([true, false])(
  '公式绑定批量切换到%s，仅提交状态不同的项',
  async (enabled) => {
    const wrapper = open()
    await flushPromises()
    await choose(wrapper, ['公式绑定 formula-b1', '公式绑定 formula-b2'])
    await button(wrapper, enabled ? '批量启用绑定' : '批量停用绑定').trigger(
      'click',
    )
    await flushPromises()
    expect(modeling.updateModelingBinding).toHaveBeenCalledOnce()
    expect(modeling.updateModelingBinding).toHaveBeenCalledWith(
      enabled ? 'b2' : 'b1',
      { is_enabled: enabled },
    )
    expect(ask).toHaveBeenCalledOnce()
  },
)
it('解绑只解除绑定且未确认不提交', async () => {
  ask.mockResolvedValueOnce(false)
  const wrapper = open()
  await flushPromises()
  await choose(wrapper, ['公式绑定 formula-b1', '公式绑定 formula-b2'])
  await button(wrapper, '批量解除绑定').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelingBinding).not.toHaveBeenCalled()
  await button(wrapper, '批量解除绑定').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelingBinding).toHaveBeenCalledTimes(2)
  expect(ask).toHaveBeenLastCalledWith(
    expect.objectContaining({
      message: expect.stringContaining('公式条目本身保留'),
    }),
  )
})
it('版本批次运行时锁定绑定写操作与选择，卡片和换页遵守选择范围', async () => {
  let finish: (() => void) | undefined
  vi.mocked(workflow.deleteModelingVersion).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = open()
  await flushPromises()
  await choose(wrapper, ['模型 v1 v1', '公式绑定 formula-b1'])
  wrapper.getComponent(VersionTable).vm.$emit('update:view', 'card')
  await flushPromises()
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 模型 v1 v1"]').element
      .checked,
  ).toBe(true)
  await button(wrapper, '批量删除模型').trigger('click')
  await flushPromises()
  expect(button(wrapper, '批量停用绑定').attributes('disabled')).toBeDefined()
  expect(
    wrapper.get('button[aria-label="解绑"]').attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper
      .get('input[aria-label="选择 公式绑定 formula-b1"]')
      .attributes('disabled'),
  ).toBeDefined()
  finish?.()
  await flushPromises()
  wrapper.getComponent(VersionTable).vm.$emit('update:page', 2)
  await flushPromises()
  expect(
    wrapper.getComponent(VersionTable).props('selection')?.selectedIds,
  ).toEqual([])
})

it('绑定批次运行时也锁定版本批量和单项写操作', async () => {
  let finish: (() => void) | undefined
  vi.mocked(modeling.deleteModelingBinding).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = open()
  await flushPromises()
  await choose(wrapper, ['模型 v1 v1', '公式绑定 formula-b1'])
  await button(wrapper, '批量解除绑定').trigger('click')
  await flushPromises()
  expect(button(wrapper, '批量下线模型').attributes('disabled')).toBeDefined()
  expect(
    wrapper.get('button[aria-label="删除"]').attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper.get('input[aria-label="选择 模型 v1 v1"]').attributes('disabled'),
  ).toBeDefined()
  finish?.()
  await flushPromises()
})
