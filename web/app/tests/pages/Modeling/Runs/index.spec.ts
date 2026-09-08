/**
 * @fileoverview 运行记录页：成功运行可发布为模型版本，且权限与已发布状态会收住入口。
 */
import { ERROR_CODES, PERMISSION_CODES } from '@dt/contracts'
import type {
  ModelingPipelineSummary,
  ModelingRunSummary,
  ModelingVersion,
  ModelingVersionSummary,
  Page,
} from '@dt/contracts'
import { DtSelect, useToast } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import { BizError } from '@/api/client'
import RunsPage from '@/pages/Modeling/Runs/index.vue'
import { useAuthStore } from '@/stores/auth'

const STAMP = '2026-01-01T00:00:00.000Z'
const mounted: { unmount: () => void }[] = []

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/modeling/runs', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function page<T>(items: T[], total = items.length): Page<T> {
  return { items, page: 1, size: 200, total }
}

function pipeline(): ModelingPipelineSummary {
  return {
    id: 'p1',
    code: 'energy-fit',
    name: '能耗回归',
    description: null,
    node_count: 6,
    source_table_codes: ['energy-log'],
    created_by_name: '张三',
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function run(over: Partial<ModelingRunSummary> = {}): ModelingRunSummary {
  return {
    id: 'r1',
    pipeline_id: 'p1',
    status: 'succeeded',
    trigger: 'manual',
    started_at: STAMP,
    finished_at: STAMP,
    duration_ms: 1200,
    row_count: 20,
    is_source_truncated: false,
    is_keeping_frames: false,
    error_text: null,
    created_by_name: '张三',
    created_at: STAMP,
    ...over,
  }
}

function versionSummary(
  over: Partial<ModelingVersionSummary> = {},
): ModelingVersionSummary {
  return {
    id: 'v1',
    pipeline_id: 'p1',
    run_id: 'r1',
    version: 1,
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
    ...over,
  }
}

function version(over: Partial<ModelingVersion> = {}): ModelingVersion {
  return {
    ...versionSummary(),
    signature: {
      format_version: '1.0',
      inputs: [],
      derived: [],
      output: {
        key: 'energy',
        label: '能耗',
        unit: 'kWh',
        dtype: 'number',
        task: 'regression',
      },
    },
    metrics: {},
    fingerprint: {},
    description: '给 MES 使用',
    ...over,
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
  runs: ModelingRunSummary[],
  versions: ModelingVersionSummary[] = [],
): void {
  vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
    page([pipeline()]),
  )
  vi.spyOn(modeling, 'listModelingRuns').mockResolvedValue(page(runs))
  vi.spyOn(modeling, 'listAllModelingVersions').mockResolvedValue(versions)
}

function open() {
  const wrapper = mount(RunsPage, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  mounted.push(wrapper)
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  useToast().clear()
  vi.restoreAllMocks()
})

describe('发布模型版本', () => {
  it('成功运行可以填写名称与说明后发布', async () => {
    stub([run()])
    const publish = vi
      .spyOn(modeling, 'publishModelingVersion')
      .mockResolvedValue(version())
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    const publishButton = wrapper
      .findAll('button')
      .find((item) => item.text() === '发布版本')
    expect(publishButton).toBeDefined()
    await publishButton?.trigger('click')
    await flushPromises()
    await wrapper.find('input').setValue('能耗预测 v1')
    await wrapper.find('textarea').setValue('给 MES 使用')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布')
      ?.trigger('click')
    await flushPromises()

    expect(publish).toHaveBeenCalledWith({
      run_id: 'r1',
      name: '能耗预测 v1',
      description: '给 MES 使用',
    })
    expect(wrapper.text()).toContain('已发布')
    expect(wrapper.text()).not.toContain('发布模型版本')
  })

  it('发布失败时保留表单与已填内容，并给出错误', async () => {
    stub([run()])
    vi.spyOn(modeling, 'publishModelingVersion').mockRejectedValue(
      new Error('offline'),
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布版本')
      ?.trigger('click')
    await wrapper.find('input').setValue('不能丢的名称')
    await wrapper.find('textarea').setValue('不能丢的说明')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('发布模型版本')
    expect(wrapper.find('input').element.value).toBe('不能丢的名称')
    expect(wrapper.find('textarea').element.value).toBe('不能丢的说明')
    expect(useToast().toasts.value.at(-1)?.message).toBe('请求失败，请重试')
    expect(wrapper.text()).not.toContain('已发布')
  })

  it('发布请求返回前离开页面，不再写状态或发送全局提示', async () => {
    stub([run()])
    let finish: (created: ModelingVersion) => void = () => undefined
    vi.spyOn(modeling, 'publishModelingVersion').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布版本')
      ?.trigger('click')
    const submit = wrapper
      .findAll('button')
      .find((item) => item.text() === '发布')
    await submit?.trigger('click')
    await submit?.trigger('click')
    await wrapper
      .find('[role="dialog"] button[aria-label="关闭"]')
      .trigger('click')
    await flushPromises()

    expect(modeling.publishModelingVersion).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('发布模型版本')
    wrapper.unmount()
    mounted.splice(mounted.indexOf(wrapper), 1)
    finish(version())
    await flushPromises()

    expect(useToast().toasts.value).toHaveLength(0)
  })

  it('空白名称不能提交', async () => {
    stub([run()])
    const publish = vi.spyOn(modeling, 'publishModelingVersion')
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布版本')
      ?.trigger('click')
    await wrapper.find('input').setValue('   ')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })

    expect(
      wrapper
        .findAll('button')
        .find((item) => item.text() === '发布')
        ?.attributes('disabled'),
    ).toBeDefined()
    expect(publish).not.toHaveBeenCalled()
  })

  it('空说明归一成 null，不把空字符串交给后端', async () => {
    stub([run()])
    const publish = vi
      .spyOn(modeling, 'publishModelingVersion')
      .mockResolvedValue(version())
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布版本')
      ?.trigger('click')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(publish).toHaveBeenCalledWith({
      run_id: 'r1',
      name: '能耗回归',
      description: null,
    })
  })

  it('关闭发布表单不创建模型版本', async () => {
    stub([run()])
    const publish = vi.spyOn(modeling, 'publishModelingVersion')
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布版本')
      ?.trigger('click')
    await wrapper
      .find('[role="dialog"] button[aria-label="关闭"]')
      .trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('发布模型版本')
    expect(publish).not.toHaveBeenCalled()
  })

  it('版本发布成功但不可服务时把原因直接告诉用户', async () => {
    stub([run()])
    const unusable = version({
      is_servable: false,
      unservable_reason: '滞后特征需要历史窗口',
    })
    vi.spyOn(modeling, 'publishModelingVersion').mockResolvedValue(unusable)
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布版本')
      ?.trigger('click')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已发布')
    expect(useToast().toasts.value.at(-1)?.message).toContain(
      '滞后特征需要历史窗口',
    )
  })

  it('发布状态过期且后端返回 41411 时收敛成已发布', async () => {
    stub([run()])
    vi.spyOn(modeling, 'publishModelingVersion').mockRejectedValue(
      new BizError(
        ERROR_CODES.modelingRunAlreadyPublished,
        '这次运行已经发布过一个版本了',
        409,
        'trace',
      ),
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布版本')
      ?.trigger('click')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已发布')
    expect(wrapper.text()).not.toContain('发布模型版本')
    expect(useToast().toasts.value.at(-1)?.message).toContain('状态已刷新')
  })

  it('发布结果不确定时重读状态，已经落库就收敛成已发布', async () => {
    stub([run()])
    vi.mocked(modeling.listAllModelingVersions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([versionSummary()])
    vi.spyOn(modeling, 'publishModelingVersion').mockRejectedValue(
      new BizError(50000, '服务端暂时不可用', 500, 'trace'),
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布版本')
      ?.trigger('click')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '发布')
      ?.trigger('click')
    await flushPromises()

    expect(modeling.listAllModelingVersions).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('已发布')
    expect(wrapper.text()).not.toContain('发布模型版本')
    expect(useToast().toasts.value.at(-1)?.message).toContain('状态已刷新')
  })

  it('已经发布过的运行只显示状态，不再给发布入口', async () => {
    stub([run()], [versionSummary()])
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('已发布')
    expect(wrapper.findAll('button').map((item) => item.text())).not.toContain(
      '发布版本',
    )
  })

  it('模型版本状态加载失败时说明原因并收住发布入口', async () => {
    stub([run()])
    vi.mocked(modeling.listAllModelingVersions)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([])
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('模型版本状态加载失败')
    expect(wrapper.text()).toContain('请求失败，请重试')
    expect(wrapper.findAll('button').map((item) => item.text())).not.toContain(
      '发布版本',
    )
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '重新加载发布状态')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('模型版本状态加载失败')
    expect(wrapper.findAll('button').map((item) => item.text())).toContain(
      '发布版本',
    )
  })

  it.each([
    ['没有发布权限', [PERMISSION_CODES.modelingView], run()],
    [
      '排队中',
      [PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish],
      run({ status: 'pending' }),
    ],
    [
      '运行中',
      [PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish],
      run({ status: 'running' }),
    ],
    [
      '取消中',
      [PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish],
      run({ status: 'cancelling' }),
    ],
    [
      '失败',
      [PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish],
      run({ status: 'failed', error_text: '取数失败' }),
    ],
    [
      '已取消',
      [PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish],
      run({ status: 'cancelled' }),
    ],
  ])('%s 时不显示发布入口', async (_name, permissions, row) => {
    stub([row])
    signIn(permissions)

    const wrapper = open()
    await flushPromises()

    expect(wrapper.findAll('button').map((item) => item.text())).not.toContain(
      '发布版本',
    )
  })

  it('切换流水线筛选和卡片视图后仍使用同一批发布动作', async () => {
    stub([run(), run({ id: 'r2', duration_ms: null, row_count: null })])
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'p1')
    await flushPromises()
    await wrapper.find('[aria-label="卡片视图"]').trigger('click')

    expect(modeling.listModelingRuns).toHaveBeenLastCalledWith('p1', {
      page: 1,
      size: 200,
    })
    expect(
      wrapper.findAll('button').filter((item) => item.text() === '发布版本'),
    ).toHaveLength(2)
  })

  it('流水线清单返回前离页，不再启动发布状态加载', async () => {
    stub([run()])
    let finish: (page: Page<ModelingPipelineSummary>) => void = () => undefined
    vi.mocked(modeling.listModelingPipelines).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    wrapper.unmount()
    mounted.splice(mounted.indexOf(wrapper), 1)
    finish(page([pipeline()]))
    await flushPromises()

    expect(modeling.listAllModelingVersions).not.toHaveBeenCalled()
  })
})
