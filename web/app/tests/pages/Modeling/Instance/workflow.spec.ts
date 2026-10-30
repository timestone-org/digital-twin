/** @fileoverview 模型页面的完整配置、发布部署、权限和失败反馈。 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as ui from '@dt/ui'
import * as api from '@/api/modelingTemplates'
import { BizError } from '@/api/client'
import * as modeling from '@/api/modeling'
import * as hierarchy from '@/api/hierarchy'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import ParameterField from '@/pages/Modeling/Instance/components/ParameterField.vue'
import InstancePage from '@/pages/Modeling/Instance/index.vue'
import DeployDialog from '@/pages/Modeling/Instance/components/DeployModelDialog.vue'
import { useAuthStore } from '@/stores/auth'
import {
  configuration,
  deployment,
  run,
  version,
  versionSummary,
} from '@/testing/modelingTemplateFixtures'

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { instanceId: configuration.instance?.id },
    path: '/modeling/instances/i1',
    query: {},
  }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
  RouterLink: { template: '<a><slot /></a>' },
}))
const wrappers: VueWrapper[] = []

it('配置校验失败展示具体节点和字段原因', async () => {
  vi.mocked(api.configureInstance).mockRejectedValue(
    new BizError(41403, '请修正参数', 400, 'test-trace', [
      {
        field: 'configuration.nodes.split',
        code: 'graph_invalid',
        message: '测试比例必须小于 1',
      },
    ]),
  )
  const wrapper = await openPage()
  await button(wrapper, '完整 JSON').trigger('click')
  const changed = structuredClone(configuration.configuration)
  if (!changed.nodes['split']) throw new Error('缺少切分节点')
  changed.nodes['split']['test_ratio'] = 5
  await wrapper.get('textarea[rows="18"]').setValue(JSON.stringify(changed))
  await button(wrapper, '保存全部配置').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('测试比例必须小于 1')
  expect(wrapper.text()).toContain('split')
})

beforeEach(() => {
  vi.mocked(onBeforeRouteLeave).mockClear()
  vi.mocked(onBeforeRouteUpdate).mockClear()
  setActivePinia(createPinia())
  vi.spyOn(hierarchy, 'capabilities').mockResolvedValue({
    is_enabled: false,
    history_limit: 10,
    max_edges: 10,
    max_nodes: 10,
  })
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  const confirmation = ui.useConfirm()
  vi.spyOn(ui, 'useConfirm').mockReturnValue({
    ...confirmation,
    ask: vi.fn().mockResolvedValue(true),
  })
  vi.spyOn(api, 'getInstanceConfiguration').mockResolvedValue(
    structuredClone(configuration),
  )
  if (!configuration.instance) throw new Error('缺少实例夹具')
  vi.spyOn(api, 'getInstance').mockResolvedValue(configuration.instance)
  vi.spyOn(api, 'configureInstance').mockResolvedValue(configuration.instance)
  vi.spyOn(api, 'trainInstance').mockResolvedValue({
    ...run,
    status: 'pending',
    nodes: [],
    started_at: null,
    finished_at: null,
    duration_ms: null,
  })
  vi.spyOn(modeling, 'listModelingRuns').mockResolvedValue({
    items: configuration.instance.latest_run
      ? [configuration.instance.latest_run]
      : [],
    page: 1,
    size: 20,
    total: 1,
  })
  vi.spyOn(modeling, 'listModelingVersions').mockResolvedValue({
    items: [],
    page: 1,
    size: 20,
    total: 0,
  })
  vi.spyOn(modeling, 'publishModelingVersion').mockResolvedValue(version)
  vi.spyOn(api, 'deployInstance').mockResolvedValue(deployment)
  vi.spyOn(modeling, 'createModelApiKey').mockResolvedValue({
    id: 'key-1',
    deployment_id: deployment.id,
    name: '首次接入密钥',
    key_prefix: 'local',
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_by_name: '测试员',
    created_at: deployment.created_at,
    plaintext: 'test-only-serving-key',
  })
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})

async function openPage(): Promise<VueWrapper> {
  const wrapper = mount(InstancePage, { global: { stubs: { teleport: true } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper
    .findAll('button')
    .find((item) => item.text().trim() === text)
  if (!found) throw new Error(`没有按钮：${text}`)
  return found
}

it('只读账号可以检查配置而不能保存、训练或部署', async () => {
  vi.mocked(useAuthStore().can).mockReturnValue(false)
  const wrapper = await openPage()
  expect(wrapper.text()).toContain(configuration.instance?.name)
  expect(
    wrapper.findAll('button').some((item) => item.text().trim() === '开始训练'),
  ).toBe(false)
  expect(
    wrapper
      .findAll('button')
      .some((item) => item.text().trim() === '基于此配置优化'),
  ).toBe(false)
  expect(
    wrapper
      .findAll('button')
      .some((item) => item.text().trim() === '保存全部配置'),
  ).toBe(false)
  expect(wrapper.text()).not.toContain('优化流水线结构')
  expect(
    wrapper
      .findAll('input')
      .some((item) => item.attributes('disabled') !== undefined),
  ).toBe(true)
})

it('模型可从保存的流水线快照开始优化结构', async () => {
  const wrapper = await openPage()
  expect(
    button(wrapper, '优化流水线结构').attributes('disabled'),
  ).toBeUndefined()
  await button(wrapper, '优化流水线结构').trigger('click')
  expect(wrapper.text()).toContain('创建独立的流水线设计')
})

it('未保存的模型参数不能被结构优化入口遗漏', async () => {
  const wrapper = await openPage()
  await button(wrapper, '完整 JSON').trigger('click')
  await wrapper.get('textarea[rows="18"]').setValue('{')
  expect(button(wrapper, '优化流水线结构').attributes('disabled')).toBeDefined()
})

it('完整 JSON 可以修改全部参数并提交同一快照的修订号', async () => {
  const wrapper = await openPage()
  await button(wrapper, '完整 JSON').trigger('click')
  const changed = structuredClone(configuration.configuration)
  if (!changed.nodes['source']) throw new Error('缺少数据源')
  changed.nodes['source']['row_limit'] = 256
  await wrapper.get('textarea[rows="18"]').setValue(JSON.stringify(changed))
  expect(button(wrapper, '开始训练').attributes('disabled')).toBeDefined()
  await button(wrapper, '保存全部配置').trigger('click')
  await flushPromises()
  expect(api.configureInstance).toHaveBeenCalledWith(
    configuration.instance?.id,
    {
      expected_revision: configuration.instance?.revision,
      configuration: changed,
      name: configuration.instance?.name,
      description: configuration.instance?.description,
    },
  )
})

it('无效 JSON 不能保存，确认重新加载会丢弃同值配置的未完成草稿', async () => {
  const wrapper = await openPage()
  await wrapper.get('textarea').setValue('["unfinished",')
  expect(wrapper.text()).toContain('JSON 格式不完整')
  expect(button(wrapper, '保存全部配置').attributes('disabled')).toBeDefined()
  await button(wrapper, '重新加载').trigger('click')
  await flushPromises()
  expect(wrapper.text()).not.toContain('JSON 格式不完整')
  expect(wrapper.get('textarea').element.value).not.toContain('unfinished')
  expect(button(wrapper, '开始训练').attributes('disabled')).toBeUndefined()
})

it('配置 Schema 可阅读，并能在表单中切换算子', async () => {
  const wrapper = await openPage()
  await button(wrapper, '配置 Schema').trigger('click')
  expect(
    wrapper.get<HTMLTextAreaElement>('textarea[rows="18"]').element.value,
  ).toContain('additionalProperties')
  await button(wrapper, '参数表单').trigger('click')
  await button(wrapper, '线性回归').trigger('click')
  expect(wrapper.text()).toContain('拟合截距')
})

it('训练与发布版本使用当前模型和明确的成功运行', async () => {
  const wrapper = await openPage()
  await button(wrapper, '开始训练').trigger('click')
  await flushPromises()
  expect(api.trainInstance).toHaveBeenCalledWith(configuration.instance?.id)
  await button(wrapper, '发布版本').trigger('click')
  await flushPromises()
  expect(modeling.publishModelingVersion).toHaveBeenCalledWith({
    run_id: run.id,
    name: configuration.instance?.name,
    description: configuration.instance?.description,
  })
})

it('加载与写入失败给出可重试反馈', async () => {
  vi.mocked(api.getInstanceConfiguration).mockRejectedValueOnce(
    new Error('offline'),
  )
  const wrapper = await openPage()
  expect(wrapper.text()).toContain('请求失败')
  await button(wrapper, '重新加载').trigger('click')
  await flushPromises()
  vi.mocked(api.trainInstance).mockRejectedValueOnce(new Error('offline'))
  await button(wrapper, '开始训练').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('请求失败')
})

it('部署完成即可使用用户 APIKey，无需签发部署密钥', async () => {
  const wrapper = mount(DeployDialog, {
    props: { instanceId: versionSummary.pipeline_id, version: versionSummary },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  await wrapper.findAll('input')[1]?.setValue('local-service')
  await button(wrapper, '部署模型').trigger('click')
  await flushPromises()
  expect(api.deployInstance).toHaveBeenCalledTimes(1)
  expect(modeling.createModelApiKey).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('用户 APIKey')
  expect(wrapper.text()).not.toContain('调用密钥（仅显示一次）')
  expect(wrapper.text()).toContain('模型已部署')
  await button(wrapper, '完成').trigger('click')
  expect(wrapper.emitted('close')).toHaveLength(1)
})

it('部署进行中 X 关闭不会丢掉部署结果', async () => {
  let finish: ((value: typeof deployment) => void) | undefined
  vi.mocked(api.deployInstance).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = mount(DeployDialog, {
    props: { instanceId: versionSummary.pipeline_id, version: versionSummary },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  await wrapper.findAll('input')[1]?.setValue('local-service')
  await button(wrapper, '部署模型').trigger('click')
  const update = vi.mocked(onBeforeRouteUpdate).mock.calls.at(-1)?.[0]
  if (!update) throw new Error('部署缺少切换模型保护')
  expect(
    await update(navigationTarget('i2'), navigationTarget('i1'), vi.fn()),
  ).toBe(false)
  await wrapper.get('button[aria-label="关闭"]').trigger('click')
  expect(wrapper.emitted('close')).toBeUndefined()
  if (!finish) throw new Error('部署请求未提交')
  finish(deployment)
  await flushPromises()
  expect(wrapper.text()).toContain('模型已部署')
})

it('参数表单的文字、数字、枚举与开关都进入同一完整配置', async () => {
  const wrapper = await openPage()
  await textInput(wrapper, '模型名称').setValue('重新命名的模型')
  await textInput(wrapper, '模型说明').setValue('输入输出已核对')
  const fields = wrapper.findAllComponents(ParameterField)
  const since = fields.find((field) => field.props('field').key === 'since')
  const limit = fields.find((field) => field.props('field').key === 'row_limit')
  const source = fields.find(
    (field) => field.props('field').key === 'row_source',
  )
  const intercept = fields.find(
    (field) => field.props('field').key === 'use_intercept',
  )
  if (!since || !limit || !source || !intercept) throw new Error('缺少参数字段')
  since.findComponent(ui.DtInput).vm.$emit('update:modelValue', '-7d')
  limit.findComponent(ui.DtNumberInput).vm.$emit('update:modelValue', 512)
  source.findComponent(ui.DtSelect).vm.$emit('update:modelValue', 'all')
  intercept.findComponent(ui.DtSwitch).vm.$emit('update:modelValue', false)
  await flushPromises()
  await button(wrapper, '保存全部配置').trigger('click')
  await flushPromises()
  expect(api.configureInstance).toHaveBeenCalledWith(
    configuration.instance?.id,
    expect.objectContaining({
      name: '重新命名的模型',
      description: '输入输出已核对',
      configuration: expect.objectContaining({
        nodes: expect.objectContaining({
          source: expect.objectContaining({
            since: '-7d',
            row_limit: 512,
            row_source: 'all',
          }),
          model: expect.objectContaining({ use_intercept: false }),
        }),
      }),
    }),
  )
})

it('从版本列表部署并关闭结果后保留页面状态', async () => {
  vi.mocked(modeling.listModelingVersions).mockResolvedValue({
    items: [versionSummary],
    page: 1,
    size: 20,
    total: 1,
  })
  const wrapper = await openPage()
  await button(wrapper, '刷新状态').trigger('click')
  await flushPromises()
  const cardToggles = wrapper.findAll('[aria-label="卡片视图"]')
  for (const toggle of cardToggles) await toggle.trigger('click')
  await button(wrapper, '部署').trigger('click')
  await flushPromises()
  const dialog = wrapper.findComponent(DeployDialog)
  await textInput(dialog, '服务名称').setValue('新的模型服务')
  await textInput(dialog, '服务编码').setValue('ui-model-service')
  dialog
    .findAllComponents(ui.DtNumberInput)
    .find((field) => field.props('label') === '单次最大行数')
    ?.vm.$emit('update:modelValue', 100)
  dialog
    .findAllComponents(ui.DtNumberInput)
    .find((field) => field.props('label') === '每分钟调用次数')
    ?.vm.$emit('update:modelValue', 120)
  await button(wrapper, '部署模型').trigger('click')
  await flushPromises()
  expect(api.deployInstance).toHaveBeenCalledWith(configuration.instance?.id, {
    code: 'ui-model-service',
    name: '新的模型服务',
    model_version_id: version.id,
    max_rows_per_call: 100,
    rate_limit_per_minute: 120,
  })
  expect(wrapper.text()).toContain('模型已部署')
  await button(wrapper, '完成').trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
})

it('在途训练可请求取消，配置加载失败可显式重试', async () => {
  if (!configuration.instance?.latest_run) throw new Error('缺少运行夹具')
  const model = {
    ...configuration.instance,
    latest_run: {
      ...configuration.instance.latest_run,
      status: 'running' as const,
    },
  }
  vi.mocked(api.getInstance).mockResolvedValue(model)
  const cancel = vi
    .spyOn(modeling, 'cancelModelingRun')
    .mockResolvedValue({ ...run, status: 'cancelling' })
  const wrapper = await openPage()
  await button(wrapper, '取消训练').trigger('click')
  await flushPromises()
  expect(cancel).toHaveBeenCalledWith(run.id)
  expect(wrapper.text()).toContain('训练进行中，参数暂时锁定')
  expect(button(wrapper, '基于此配置优化').attributes('disabled')).toBeDefined()
})

function textInput(wrapper: VueWrapper, label: string) {
  const field = wrapper
    .findAllComponents(ui.DtInput)
    .find((item) => item.props('label') === label)
  if (!field) throw new Error(`没有输入框：${label}`)
  return field.get('input')
}

it('离开页面后完成的训练提交不会再次请求该页面数据', async () => {
  let finish: ((value: typeof run) => void) | undefined
  vi.mocked(api.trainInstance).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = await openPage()
  await button(wrapper, '开始训练').trigger('click')
  const reads = vi.mocked(api.getInstance).mock.calls.length
  wrapper.unmount()
  if (!finish) throw new Error('训练未提交')
  finish(run)
  await flushPromises()
  expect(api.getInstance).toHaveBeenCalledTimes(reads)
})

it('部署失败保留表单并允许修正后重试，不请求额外密钥', async () => {
  vi.mocked(api.deployInstance).mockRejectedValueOnce(
    new BizError(41418, '服务编码已存在', 409, 'test-trace'),
  )
  const wrapper = mount(DeployDialog, {
    props: { instanceId: versionSummary.pipeline_id, version: versionSummary },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  await wrapper.findAll('input')[1]?.setValue('account-service')
  await button(wrapper, '部署模型').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('服务编码已存在')
  expect(wrapper.findAll('input')[1]?.element.value).toBe('account-service')
  await wrapper.findAll('input')[1]?.setValue('account-service-new')
  await button(wrapper, '部署模型').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('模型已部署')
  expect(modeling.createModelApiKey).not.toHaveBeenCalled()
})

it('历史训练配置先载入草稿，检查优化后按当前修订号保存', async () => {
  const historical = structuredClone(configuration)
  if (!historical.configuration.nodes['source']) throw new Error('缺少数据源')
  historical.configuration.nodes['source']['row_limit'] = 256
  if (!historical.instance) throw new Error('缺少实例')
  historical.instance.revision = 99
  vi.mocked(api.getInstanceConfiguration).mockImplementation(
    (_id, _signal, runId) =>
      Promise.resolve(structuredClone(runId ? historical : configuration)),
  )
  const wrapper = await openPage()
  await button(wrapper, '基于此配置优化').trigger('click')
  await flushPromises()
  expect(api.getInstanceConfiguration).toHaveBeenCalledWith(
    configuration.instance?.id,
    expect.any(AbortSignal),
    run.id,
  )
  expect(api.configureInstance).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('已载入历史训练配置')
  expect(button(wrapper, '开始训练').attributes('disabled')).toBeDefined()
  await button(wrapper, '完整 JSON').trigger('click')
  expect(
    wrapper.get<HTMLTextAreaElement>('textarea[rows="18"]').element.value,
  ).toContain('256')
  await button(wrapper, '保存全部配置').trigger('click')
  await flushPromises()
  expect(api.configureInstance).toHaveBeenCalledWith(
    configuration.instance?.id,
    expect.objectContaining({
      expected_revision: configuration.instance?.revision,
      configuration: historical.configuration,
    }),
  )
  expect(wrapper.text()).not.toContain('已载入历史训练配置')
})

it('取消载入历史配置时保留未保存草稿', async () => {
  const wrapper = await openPage()
  await button(wrapper, '完整 JSON').trigger('click')
  const changed = structuredClone(configuration.configuration)
  if (!changed.nodes['source']) throw new Error('缺少数据源')
  changed.nodes['source']['row_limit'] = 512
  await wrapper.get('textarea[rows="18"]').setValue(JSON.stringify(changed))
  vi.mocked(ui.useConfirm().ask).mockResolvedValue(false)
  const count = vi.mocked(api.getInstanceConfiguration).mock.calls.length
  await button(wrapper, '基于此配置优化').trigger('click')
  await flushPromises()
  expect(api.getInstanceConfiguration).toHaveBeenCalledTimes(count)
  expect(
    wrapper.get<HTMLTextAreaElement>('textarea[rows="18"]').element.value,
  ).toContain('512')
})

it('切换模型参数与离开页面都保护未保存的配置', async () => {
  const wrapper = await openPage()
  await button(wrapper, '完整 JSON').trigger('click')
  await wrapper.get('textarea[rows="18"]').setValue('{"nodes":{}}')
  vi.mocked(ui.useConfirm().ask).mockResolvedValue(false)
  const guards = vi
    .mocked(onBeforeRouteLeave)
    .mock.calls.map(([guard]) => guard)
  const updates = vi
    .mocked(onBeforeRouteUpdate)
    .mock.calls.map(([guard]) => guard)
  if (guards.length === 0 || updates.length === 0)
    throw new Error('缺少导航草稿保护')
  const current = navigationTarget(configuration.instance?.id ?? 'current')
  const route = navigationTarget('another')
  const next = vi.fn()
  let canUpdate = true
  for (const guard of updates) {
    if ((await guard(route, current, next)) === false) canUpdate = false
  }
  expect(canUpdate).toBe(false)
  let canLeave = true
  for (const guard of guards) {
    if ((await guard(route, current, next)) === false) canLeave = false
  }
  expect(canLeave).toBe(false)
})

function navigationTarget(instanceId: string) {
  return {
    params: { instanceId },
    fullPath: `/modeling/instances/${instanceId}`,
    path: `/modeling/instances/${instanceId}`,
    query: {},
    hash: '',
    name: 'modeling-instance',
    matched: [],
    meta: {},
    redirectedFrom: undefined,
  }
}
