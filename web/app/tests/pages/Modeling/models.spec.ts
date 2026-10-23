/**
 * @fileoverview 模型库页：不可用要说出原因、孤儿绑定照实标出来、形参按位置
 * 对应特征列、换绑回执里的影响面要报给用户。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import type {
  ModelingBinding,
  ModelingVersion,
  ModelingVersionSummary,
} from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import ModelsPage from '@/pages/Modeling/Models/index.vue'
import { impactText } from '@/pages/Modeling/Models/scripts/useBindingOps'
import { useAuthStore } from '@/stores/auth'

const STAMP = '2026-01-01T00:00:00.000Z'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/modeling/models', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function version(
  over: Partial<ModelingVersionSummary> = {},
): ModelingVersionSummary {
  return {
    id: 'v1',
    pipeline_id: 'p1',
    run_id: 'r1',
    version: 3,
    name: '能耗回归',
    algo: 'linear',
    task: 'regression',
    is_servable: true,
    serving_channel: 'json',
    unservable_reason: null,
    feature_keys: ['temp', 'load'],
    target_key: 'power',
    created_by_name: '张三',
    created_at: STAMP,
    ...over,
  }
}

function binding(over: Partial<ModelingBinding> = {}): ModelingBinding {
  return {
    id: 'b1',
    fx_code: 'predict_power',
    model_version_id: 'v1',
    param_map: [
      { param: 'a', feature: 'temp' },
      { param: 'b', feature: 'load' },
    ],
    is_enabled: true,
    is_orphaned: false,
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function signIn(permissions: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'u',
    permissions,
    role_permissions: permissions,
    direct_permissions: [],
    role: { name: 'r', description: '' },
  } as never
  auth.accessToken = 'token'
}

function stub(versions: ModelingVersionSummary[], bindings: ModelingBinding[]) {
  vi.spyOn(modeling, 'listModelingVersions').mockResolvedValue({
    items: versions,
    page: 1,
    size: 200,
    total: versions.length,
  })
  vi.spyOn(modeling, 'listModelingBindings').mockResolvedValue({
    items: bindings,
    page: 1,
    size: 200,
    total: bindings.length,
  })
}

function open() {
  return mount(ModelsPage, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('模型库', () => {
  it('规则计算版本显示规则任务且不给绑定数值公式', async () => {
    stub([version({ task: 'rule_calculation', target_key: null })], [])
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])
    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('规则计算（无目标列）')
    const bind = wrapper
      .findAll('button')
      .find((button) => button.text() === '绑公式')
    expect(bind?.attributes('disabled')).toBeDefined()
  })

  it('发布权限允许改名并保存名称和说明', async () => {
    stub([version()], [])
    vi.spyOn(modeling, 'updateModelingVersion').mockResolvedValue({
      ...version(),
      signature: {},
      metrics: {},
      fingerprint: {},
      description: '原说明',
    })
    vi.spyOn(modeling, 'getModelingVersion').mockResolvedValue({
      ...version(),
      signature: {},
      metrics: {},
      fingerprint: {},
      description: '原说明',
    })
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])
    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '改名')
      ?.trigger('click')
    await flushPromises()
    await wrapper
      .get('input[aria-label="模型名称"]')
      .setValue('设备能效评估模型')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '保存名称')
      ?.trigger('click')
    await flushPromises()

    expect(modeling.updateModelingVersion).toHaveBeenCalledWith('v1', {
      name: '设备能效评估模型',
      description: '原说明',
    })
  })

  it('只读账号没有模型版本改名入口', async () => {
    stub([version()], [])
    signIn([PERMISSION_CODES.modelingView])
    const wrapper = open()
    await flushPromises()
    expect(
      wrapper.findAll('button').some((button) => button.text() === '改名'),
    ).toBe(false)
  })

  it('快速切换改名对象时迟到的详情不会覆盖当前对象', async () => {
    const first = version({ id: 'v1', name: '设备异常检测模型' })
    const second = version({ id: 'v2', name: '能耗预测模型' })
    stub([first, second], [])
    let finishFirst: (value: ModelingVersion) => void = () => {}
    vi.spyOn(modeling, 'getModelingVersion').mockImplementation((id) =>
      id === 'v1'
        ? new Promise<ModelingVersion>((resolve) => {
            finishFirst = resolve
          })
        : Promise.resolve({
            ...second,
            signature: {},
            metrics: {},
            fingerprint: {},
            description: null,
          }),
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])
    const wrapper = open()
    await flushPromises()
    const buttons = wrapper
      .findAll('button')
      .filter((button) => button.text() === '改名')
    await buttons[0]?.trigger('click')
    await buttons[1]?.trigger('click')
    await flushPromises()
    finishFirst({
      ...first,
      signature: {},
      metrics: {},
      fingerprint: {},
      description: null,
    })
    await flushPromises()

    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="模型名称"]').element
        .value,
    ).toBe('能耗预测模型')
  })

  it('空名称不可提交，取消改名不写入', async () => {
    stub([version()], [])
    vi.spyOn(modeling, 'getModelingVersion').mockResolvedValue({
      ...version(),
      signature: {},
      metrics: {},
      fingerprint: {},
      description: null,
    })
    const update = vi.spyOn(modeling, 'updateModelingVersion')
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])
    const wrapper = open()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '改名')
      ?.trigger('click')
    await flushPromises()
    await wrapper.get('input[aria-label="模型名称"]').setValue('')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '保存名称')
        ?.attributes('disabled'),
    ).toBeDefined()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消')
      ?.trigger('click')
    expect(update).not.toHaveBeenCalled()
  })
  it('两块列表分别显示分页器，空绑定列表也保留分页区', async () => {
    stub([version()], [])
    signIn([PERMISSION_CODES.modelingView])
    const wrapper = open()
    await flushPromises()

    const pagers = wrapper.findAll('nav[aria-label="分页"]')
    expect(pagers).toHaveLength(2)
    expect(pagers[0]?.text()).toContain('共 1 条')
    expect(pagers[1]?.text()).toContain('共 0 条')
  })

  it.each([
    ['模型版本', 'listModelingVersions', 'listModelingBindings'],
    ['公式绑定', 'listModelingBindings', 'listModelingVersions'],
  ] as const)('%s 的翻页只更新自己的列表', async (title, target, other) => {
    stub([version()], [binding()])
    vi.mocked(modeling.listModelingVersions).mockResolvedValue({
      items: [version()],
      page: 1,
      size: 200,
      total: 400,
    })
    vi.mocked(modeling.listModelingBindings).mockResolvedValue({
      items: [binding()],
      page: 1,
      size: 200,
      total: 400,
    })
    signIn([PERMISSION_CODES.modelingView])
    const wrapper = open()
    await flushPromises()
    const block = wrapper
      .findAll('.dt-ml-models__block')
      .find((item) => item.find('h2').text() === title)
    const next = block
      ?.findAll('button')
      .find((item) => item.text() === '下一页')
    expect(next).toBeDefined()
    vi.mocked(modeling[target]).mockClear()
    vi.mocked(modeling[other]).mockClear()
    await next?.trigger('click')
    await flushPromises()

    expect(modeling[target]).toHaveBeenCalledWith({ page: 2, size: 200 })
    expect(modeling[other]).not.toHaveBeenCalled()

    await block?.get('button[role="combobox"]').trigger('click')
    await wrapper
      .findAll('[role="option"]')
      .find((item) => item.text() === '20 条/页')
      ?.trigger('click')
    await flushPromises()

    expect(modeling[target]).toHaveBeenLastCalledWith({ page: 1, size: 20 })
    expect(modeling[other]).not.toHaveBeenCalled()
  })

  it('不可用的版本要说出原因，不是只标一个「不可用」', async () => {
    stub(
      [
        version({
          is_servable: false,
          unservable_reason: '训练用的特征列 temp 已经不在台账里了',
        }),
      ],
      [],
    )
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('不在台账里')
  })

  it('公式条目被删掉的绑定照实标成孤儿', async () => {
    stub([version()], [binding({ is_orphaned: true })])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('公式已删')
  })

  it('绑定表里显示的是版本名而不是一串 id', async () => {
    stub([version()], [binding()])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('能耗回归 v3')
    expect(wrapper.text()).not.toContain('v1")')
  })

  it('形参按位置对应特征列，界面上写出这层关系', async () => {
    stub([version()], [binding()])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('1→temp')
    expect(wrapper.text()).toContain('2→load')
  })

  it('没有发布码时启停开关换成只读标签', async () => {
    stub([version()], [binding()])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.find('button[role="switch"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('启用')
  })

  it('不可用的版本不给绑', async () => {
    stub(
      [version({ is_servable: false, unservable_reason: '还没训练出来' })],
      [],
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingPublish])

    const wrapper = open()
    await flushPromises()

    const bind = wrapper.findAll('button').find((b) => b.text() === '绑公式')
    expect(bind?.attributes('disabled')).toBeDefined()
  })
})

describe('换绑回执里的影响面', () => {
  it('有引用时把台账列一条条说清楚', () => {
    const text = impactText({
      ...binding(),
      usages: [
        { table_code: 'energy_log', column_key: 'pred' },
        { table_code: 'plant', column_key: 'guess' },
      ],
    })

    expect(text).toContain('energy_log.pred')
    expect(text).toContain('plant.guess')
    expect(text).toContain('回填')
  })

  it('一条引用都没有时也明说，不给一句空话', () => {
    const text = impactText({ ...binding(), usages: [] })

    expect(text).toContain('还没有台账列引用')
  })
})
