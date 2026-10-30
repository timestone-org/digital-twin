/** @fileoverview 模型服务的账号调用说明、启停与版本状态。 */
import { PERMISSION_CODES } from '@dt/contracts'
import type {
  ModelApiKey,
  ModelCallStat,
  ModelDeployment,
  ModelingVersionSummary,
} from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { DtInput, useConfirm, useToast } from '@dt/ui'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import * as serving from '@/api/modelingServing'
import ServicesPage from '@/pages/Modeling/Services/index.vue'
import CallStatList from '@/pages/Modeling/Services/components/CallStatList.vue'
import { useAuthStore } from '@/stores/auth'

const STAMP = '2026-01-01T00:00:00.000Z'
const PLAINTEXT = 'dtmk_this-is-the-only-time-you-see-it'
const mounted: { unmount: () => void }[] = []

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/modeling/services', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function deployment(over: Partial<ModelDeployment> = {}): ModelDeployment {
  return {
    id: 'd1',
    code: 'energy-forecast',
    model_version_id: 'v1',
    model_name: '能耗回归',
    model_version: 3,
    name: '能耗预测服务',
    description: null,
    is_enabled: true,
    is_servable: true,
    unservable_reason: null,
    max_rows_per_call: 200,
    rate_limit_per_minute: 60,
    key_count: 1,
    created_by_name: '张三',
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function apiKey(over: Partial<ModelApiKey> = {}): ModelApiKey {
  return {
    id: 'k1',
    deployment_id: 'd1',
    name: 'MES 生产系统',
    key_prefix: 'dtmk_abc123',
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_by_name: '张三',
    created_at: STAMP,
    ...over,
  }
}

function version(): ModelingVersionSummary {
  return {
    id: 'v1',
    pipeline_id: 'p1',
    run_id: 'r1',
    version: 3,
    name: '能耗回归',
    algo: 'linear_regression',
    task: 'regression',
    is_servable: true,
    serving_channel: 'json',
    unservable_reason: null,
    feature_keys: ['temperature', 'load'],
    target_key: 'energy',
    created_by_name: '张三',
    created_at: STAMP,
  }
}

function signIn(permissions: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'u',
    email: 'u@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    permissions,
    role_permissions: permissions,
    direct_permissions: [],
    role: { id: 'r1', name: 'r', description: null, is_builtin: false },
  }
  auth.accessToken = 'token'
}

function stub(
  rows: ModelDeployment[],
  keys: ModelApiKey[] = [],
  versions: ModelingVersionSummary[] = [],
): void {
  vi.spyOn(modeling, 'listModelDeployments').mockResolvedValue(rows)
  vi.spyOn(modeling, 'listModelApiKeys').mockResolvedValue(keys)
  vi.spyOn(modeling, 'listModelCallStats').mockResolvedValue([])
  vi.spyOn(modeling, 'listAllModelingVersions').mockResolvedValue(versions)
}

function open() {
  const wrapper = mount(ServicesPage, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  mounted.push(wrapper)
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.spyOn(serving, 'getOpenModelSignature').mockResolvedValue({
    inputs: [
      { key: 'temperature', label: '温度', dtype: 'number', is_required: true },
    ],
    output: { task: 'regression' },
  })
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  useToast().clear()
  vi.restoreAllMocks()
})

describe('模型服务', () => {
  it('停用与「版本不可用」是两回事，各说各的', async () => {
    stub([
      deployment({ is_enabled: false }),
      deployment({
        id: 'd2',
        code: 'other',
        is_servable: false,
        unservable_reason: '模型产物已经不在存储里了',
      }),
    ])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('已停用')
    expect(wrapper.text()).toContain('不在存储里')
  })

  it('配额两档都摆出来，用户不必去猜', async () => {
    stub([deployment({ rate_limit_per_minute: 120, max_rows_per_call: 500 })])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('120 次/分')
    expect(wrapper.text()).toContain('500 行/次')
  })

  it('调用说明使用用户 APIKey，且不获取或签发部署密钥', async () => {
    stub([deployment()], [apiKey()])
    const createKey = vi.spyOn(modeling, 'createModelApiKey')
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])
    const wrapper = open()
    await flushPromises()
    const access = wrapper
      .findAll('button')
      .find((item) => item.text() === '调用说明')
    if (!access) throw new Error('缺少调用说明入口')
    await access.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(
      '/api/v1/platform/open-models/energy-forecast:predict',
    )
    expect(wrapper.text()).toContain(
      '/api/v1/platform/open-models/energy-forecast:calculate',
    )
    expect(wrapper.text()).toContain('用户 APIKey')
    expect(wrapper.text()).toContain('结构化结果')
    expect(
      wrapper
        .findAll('input')
        .some(
          (item) =>
            item.element.value === 'Authorization: Bearer <用户 APIKey>',
        ),
    ).toBe(true)
    expect(modeling.listModelApiKeys).not.toHaveBeenCalled()
    expect(createKey).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('铸一把')
    expect(wrapper.text()).not.toContain(PLAINTEXT)
  })

  it('只读账号看不到开通与撤销的入口', async () => {
    stub([deployment()], [apiKey()])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    const labels = wrapper.findAll('button').map((item) => item.text())
    expect(labels).not.toContain('开一个服务')
  })

  it('还没开出服务时说清楚下一步去哪儿', async () => {
    stub([])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('还没有开出对外服务')
    expect(wrapper.text()).toContain('模型库')
  })

  it('没有可上线版本时指向运行记录里的发布入口', async () => {
    stub([])
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '开一个服务')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('先到「运行记录」')
    expect(wrapper.text()).toContain('成功运行发布成版本')
  })

  it('完整版本列表里的可服务版本会进入开通下拉', async () => {
    stub([], [], [version()])
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '开一个服务')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('能耗回归 v3')
    expect(wrapper.text()).not.toContain('还没有可上线的模型版本')
  })

  it('模型版本加载失败时不伪装成空列表，并可重试恢复', async () => {
    stub([])
    vi.mocked(modeling.listAllModelingVersions)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([version()])
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('模型版本加载失败')
    expect(wrapper.text()).toContain('请求失败，请重试')
    expect(
      wrapper
        .findAll('button')
        .find((item) => item.text() === '开一个服务')
        ?.attributes('disabled'),
    ).toBeDefined()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '重新加载模型版本')
      ?.trigger('click')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '开一个服务')
      ?.trigger('click')

    expect(wrapper.text()).not.toContain('模型版本加载失败')
    expect(wrapper.text()).toContain('能耗回归 v3')
    expect(modeling.listAllModelingVersions).toHaveBeenCalledTimes(2)
    expect(modeling.listAllModelingVersions).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    )
  })

  it('离开页面会中止仍在翻页的模型版本请求', async () => {
    stub([])
    let signal: AbortSignal | undefined
    vi.mocked(modeling.listAllModelingVersions).mockImplementation((given) => {
      signal = given
      return new Promise(() => undefined)
    })
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()
    wrapper.unmount()
    mounted.splice(mounted.indexOf(wrapper), 1)

    expect(signal?.aborted).toBe(true)
  })
})

it('关闭后打开另一部署时丢弃先前迟到的调用统计', async () => {
  stub([
    deployment(),
    deployment({ id: 'd2', code: 'other', name: '第二服务' }),
  ])
  signIn([PERMISSION_CODES.modelingView])
  let finish: ((rows: ModelCallStat[]) => void) | undefined
  let signal: AbortSignal | undefined
  vi.mocked(modeling.listModelCallStats)
    .mockImplementationOnce((_id, given) => {
      signal = given
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    .mockResolvedValueOnce([{ day: '2026-10-28', total: 2, failed: 0 }])
  const wrapper = open()
  await flushPromises()
  const entries = wrapper
    .findAll('button')
    .filter((item) => item.text() === '调用说明')
  await entries[0]?.trigger('click')
  await flushPromises()
  const close = wrapper.findAll('button').find((item) => item.text() === '关闭')
  if (!close || !finish) throw new Error('调用说明未打开')
  await close.trigger('click')
  expect(signal?.aborted).toBe(true)
  await entries[1]?.trigger('click')
  await flushPromises()
  finish([{ day: '2026-10-27', total: 99, failed: 99 }])
  await flushPromises()
  expect(wrapper.findComponent(CallStatList).props('rows')).toEqual([
    { day: '2026-10-28', total: 2, failed: 0 },
  ])
})

it('调用统计失败显示错误，关闭后中止请求', async () => {
  stub([deployment()])
  signIn([PERMISSION_CODES.modelingView])
  vi.mocked(modeling.listModelCallStats).mockRejectedValue(new Error('offline'))
  const wrapper = open()
  await flushPromises()
  const entry = wrapper
    .findAll('button')
    .find((item) => item.text() === '调用说明')
  if (!entry) throw new Error('缺少调用说明')
  await entry.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('请求失败，请重试')
  expect(wrapper.findComponent(CallStatList).exists()).toBe(false)
})

it('使用账号鉴权的服务仍可修改配置、启停并删除', async () => {
  stub([deployment()], [], [version()])
  signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])
  const update = vi
    .spyOn(modeling, 'updateModelDeployment')
    .mockResolvedValue(deployment())
  const remove = vi
    .spyOn(modeling, 'deleteModelDeployment')
    .mockResolvedValue(undefined)
  const wrapper = open()
  await flushPromises()
  await wrapper.get('button[title="改配置"]').trigger('click')
  await flushPromises()
  const name = wrapper
    .findAllComponents(DtInput)
    .find((input) => input.props('label') === '名称')
  if (!name) throw new Error('未显示名称字段')
  await name.get('input').setValue('已更新服务')
  const save = wrapper.findAll('button').find((item) => item.text() === '保存')
  if (!save) throw new Error('缺少保存按钮')
  await save.trigger('click')
  await flushPromises()
  expect(update).toHaveBeenCalledWith(
    'd1',
    expect.objectContaining({ name: '已更新服务' }),
  )
  await wrapper.get('button[title="停用"]').trigger('click')
  await flushPromises()
  expect(update).toHaveBeenLastCalledWith('d1', { is_enabled: false })
  await wrapper.get('button[title="删掉"]').trigger('click')
  useConfirm().resolve(true)
  await flushPromises()
  expect(remove).toHaveBeenCalledWith('d1')
})

it('创建服务完成后无需签发密钥，并能关闭配置和调用说明', async () => {
  stub([deployment()], [], [version()])
  signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])
  const create = vi
    .spyOn(modeling, 'createModelDeployment')
    .mockResolvedValue(deployment())
  const wrapper = open()
  await flushPromises()
  const click = async (name: string) => {
    const item = wrapper
      .findAll('button')
      .find((element) => element.text() === name)
    if (!item) throw new Error('缺少操作按钮')
    await item.trigger('click')
    await flushPromises()
  }
  await click('开一个服务')
  for (const [label, value] of [
    ['对外标识', 'account-service'],
    ['名称', '账号调用服务'],
  ]) {
    const input = wrapper
      .findAllComponents(DtInput)
      .find((item) => item.props('label') === label)
    if (!input || value === undefined) throw new Error('缺少配置输入')
    await input.get('input').setValue(value)
  }
  await click('开通')
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'account-service' }),
  )
  await click('开一个服务')
  await click('取消')
  await wrapper.get('[aria-label="卡片视图"]').trigger('click')
  await click('调用说明')
  const dismiss = wrapper
    .findAll('button')
    .find((item) => item.attributes('aria-label') === '关闭')
  if (!dismiss) throw new Error('缺少关闭窗口按钮')
  await dismiss.trigger('click')
  await flushPromises()
  expect(wrapper.text()).not.toContain('的调用说明')
})

it('部署服务可在页面内输入数据在线试算', async () => {
  stub([deployment()])
  signIn([PERMISSION_CODES.modelingView])
  const wrapper = open()
  await flushPromises()
  const entry = wrapper
    .findAll('button')
    .find((item) => item.text() === '调用说明')
  if (!entry) throw new Error('缺少调用说明入口')
  await entry.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('在线试算')
  expect(wrapper.find('textarea').exists()).toBe(true)
})
