/**
 * @fileoverview 流水线列表页：取回后渲染、按名称与编码本地过滤、取不全时明说、
 * 以及写码决定「新建」露不露面。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import { DtInput } from '@dt/ui'
import type {
  ModelingPipeline,
  ModelingPipelineSummary,
  Page,
} from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import PipelinesPage from '@/pages/Modeling/Pipelines/index.vue'
import PipelineFormDialog from '@/pages/Modeling/Pipelines/components/PipelineFormDialog.vue'
import { useAuthStore } from '@/stores/auth'

const STAMP = '2026-01-01T00:00:00.000Z'
const push = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  useRoute: () => ({ path: '/modeling/pipelines', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function pipeline(
  over: Partial<ModelingPipelineSummary> = {},
): ModelingPipelineSummary {
  return {
    id: 'p1',
    code: 'energy_fit',
    name: '能耗回归',
    description: null,
    node_count: 5,
    source_table_codes: ['energy_log'],
    created_by_name: '张三',
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function page(
  items: ModelingPipelineSummary[],
  total = items.length,
): Page<ModelingPipelineSummary> {
  return { items, page: 1, size: 200, total }
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

beforeEach(() => {
  push.mockClear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('流水线列表', () => {
  it('有设计权限时可从现有流水线打开复制表单', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline()]),
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage, {
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    await wrapper.get('button[aria-label="复制流水线"]').trigger('click')
    const dialog = wrapper.getComponent(PipelineFormDialog)
    expect(dialog.props('draft')).toEqual({
      id: null,
      sourcePipelineId: 'p1',
      code: expect.stringMatching(/^model_[a-f0-9]{32}$/),
      name: '能耗回归 副本',
      description: '',
    })
    expect(wrapper.text()).toContain('复制并进入流程图')
    wrapper.unmount()
  })

  it('提交复制表单后打开新副本，原流水线不被更新', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline()]),
    )
    const source: ModelingPipeline = {
      ...pipeline(),
      graph: { format_version: '1.0', nodes: [], edges: [] },
    }
    vi.spyOn(modeling, 'getModelingPipeline').mockResolvedValue(source)
    const create = vi
      .spyOn(modeling, 'createModelingPipeline')
      .mockResolvedValue({
        ...source,
        id: 'copy-1',
        code: 'copy_energy',
        name: '能耗分析改进版',
      })
    const update = vi.spyOn(modeling, 'updateModelingPipeline')
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage, {
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    await wrapper.get('button[aria-label="复制流水线"]').trigger('click')
    const dialog = wrapper.getComponent(PipelineFormDialog)
    const draft = dialog.props('draft')
    if (!draft) throw new Error('复制表单未打开')
    dialog.vm.$emit(
      'submit',
      { ...draft, code: 'copy_energy', name: '能耗分析改进版' },
      '',
    )
    await flushPromises()
    expect(create).toHaveBeenCalledWith({
      code: 'copy_energy',
      name: '能耗分析改进版',
      description: null,
      graph: source.graph,
    })
    expect(update).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/modeling/pipelines/copy-1')
    wrapper.unmount()
  })

  it('只读权限不显示已有流水线的复制入口', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline()]),
    )
    signIn([PERMISSION_CODES.modelingView])
    const wrapper = mount(PipelinesPage)
    await flushPromises()
    expect(wrapper.text()).toContain('能耗回归')
    expect(wrapper.find('button[aria-label="复制流水线"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('打开流程图仍进入原流水线，并且不创建副本', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline()]),
    )
    const create = vi.spyOn(modeling, 'createModelingPipeline')
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage)
    await flushPromises()
    const open = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === '打开流程图')
    if (!open) throw new Error('缺少打开流程图按钮')
    await open.trigger('click')
    expect(push).toHaveBeenCalledWith('/modeling/pipelines/p1')
    expect(create).not.toHaveBeenCalled()
    expect(wrapper.getComponent(PipelineFormDialog).props('draft')).toBeNull()
    wrapper.unmount()
  })

  it('复制创建失败保留用户修改，修正编码后重试进入副本', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline()]),
    )
    const source: ModelingPipeline = {
      ...pipeline(),
      graph: { format_version: '1.0', nodes: [], edges: [] },
    }
    vi.spyOn(modeling, 'getModelingPipeline').mockResolvedValue(source)
    const create = vi
      .spyOn(modeling, 'createModelingPipeline')
      .mockRejectedValueOnce(new Error('duplicate code'))
      .mockResolvedValueOnce({ ...source, id: 'copy-retry' })
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage, {
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    await wrapper.get('button[aria-label="复制流水线"]').trigger('click')
    function input(label: string) {
      const field = wrapper
        .getComponent(PipelineFormDialog)
        .findAllComponents(DtInput)
        .find((item) => item.props('label') === label)
      if (!field) throw new Error(`缺少输入框：${label}`)
      return field.get('input')
    }
    await input('流水线名称').setValue('修改后的副本')
    await input('编码').setValue('conflicting_code')
    await wrapper.getComponent(PipelineFormDialog).get('form').trigger('submit')
    await flushPromises()
    expect(input('流水线名称').element.value).toBe('修改后的副本')
    expect(input('编码').element.value).toBe('conflicting_code')
    expect(push).not.toHaveBeenCalled()
    await input('编码').setValue('new_copy_code')
    await wrapper.getComponent(PipelineFormDialog).get('form').trigger('submit')
    await flushPromises()
    expect(create).toHaveBeenLastCalledWith({
      code: 'new_copy_code',
      name: '修改后的副本',
      description: null,
      graph: source.graph,
    })
    expect(push).toHaveBeenCalledWith('/modeling/pipelines/copy-retry')
    wrapper.unmount()
  })

  it('日常入口保留完整流程，发布工作流与模型实例可以直接进入', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage)
    await flushPromises()
    expect(wrapper.text()).toContain('选择设计模板')
    expect(wrapper.text()).toContain('配置流程图')
    expect(wrapper.text()).toContain('运行并查看结果')
    const nav = wrapper.get('nav[aria-label="分析建模导航"]')
    expect(nav.text()).toContain('建模工作台')
    expect(nav.text()).toContain('模型实例')
    expect(nav.text()).toContain('已发布工作流')
    wrapper.unmount()
  })

  it('按设计模板创建成功后直接打开返回的流水线画布', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    vi.spyOn(modeling, 'createModelingPipeline').mockResolvedValue({
      ...pipeline(),
      graph: { format_version: '1.0', nodes: [], edges: [] },
    })
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage)
    await flushPromises()
    wrapper.getComponent(PipelineFormDialog).vm.$emit(
      'submit',
      {
        id: null,
        code: 'energy_fit',
        name: '能耗回归',
        description: '',
      },
      'regression',
    )
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/modeling/pipelines/p1')
    expect(modeling.createModelingPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        graph: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({ operator: 'linear_regression' }),
          ]),
        }),
      }),
    )
    wrapper.unmount()
  })
  it('取回之后名称与取自的台账都在页面上', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline()]),
    )
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = mount(PipelinesPage)
    await flushPromises()

    expect(wrapper.text()).toContain('能耗回归')
    expect(wrapper.text()).toContain('energy_log')
  })

  it('搜索只在本地筛，编码也算命中', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline(), pipeline({ id: 'p2', code: 'other', name: '另一条' })]),
    )
    signIn([PERMISSION_CODES.modelingView])
    const wrapper = mount(PipelinesPage)
    await flushPromises()

    await wrapper.find('input[type="search"]').setValue('energy_fit')
    await flushPromises()

    expect(wrapper.text()).toContain('能耗回归')
    expect(wrapper.text()).not.toContain('另一条')
  })

  it('取回的比库里的少时要明说，否则本地筛选是在拿半份结果冒充全部', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline()], 7),
    )
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = mount(PipelinesPage)
    await flushPromises()

    expect(wrapper.text()).toContain('还有 6 条流水线没取回来')
  })

  it('只有读码时不给「新建」，并留一句说明', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = mount(PipelinesPage)
    await flushPromises()

    expect(wrapper.text()).not.toContain('新建流水线')
    expect(wrapper.find('button[aria-label="复制流水线"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="perm-readonly"]').exists()).toBe(true)
  })

  it('有写码就给「新建」', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])

    const wrapper = mount(PipelinesPage)
    await flushPromises()

    expect(wrapper.text()).toContain('新建流水线')
  })

  it('一条都没有时劝人去建，而不是显示一张空表', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = mount(PipelinesPage)
    await flushPromises()

    expect(wrapper.text()).toContain('还没有流水线')
  })

  it('筛出来是空的时候不劝人去建——那是关键词的问题', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline()]),
    )
    signIn([PERMISSION_CODES.modelingView])
    const wrapper = mount(PipelinesPage)
    await flushPromises()

    await wrapper.find('input[type="search"]').setValue('对不上的词')
    await flushPromises()

    expect(wrapper.text()).not.toContain('还没有流水线')
  })
})
