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
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import PipelinesPage from '@/pages/Modeling/Pipelines/index.vue'
import PipelineFormDialog from '@/pages/Modeling/Pipelines/components/PipelineFormDialog.vue'
import PipelineCard from '@/pages/Modeling/Pipelines/components/PipelineCard.vue'
import PublishTemplateDialog from '@/pages/Modeling/components/PublishTemplateDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { NAV_ITEMS } from '@/components/layout/navItems'

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

async function selectMore(wrapper: VueWrapper, label: string): Promise<void> {
  const trigger = wrapper.find('button[aria-label="工作流更多操作"]')
  if (!trigger.exists()) throw new Error('缺少更多操作菜单')
  await trigger.trigger('click')
  await flushPromises()
  const action = wrapper
    .findAll('[role="menuitem"]')
    .find((item) => item.text() === label)
  if (!action) throw new Error(`缺少菜单操作：${label}`)
  await action.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  push.mockClear()
  localStorage.removeItem('dt.view-mode.modeling-pipelines')
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('流水线列表', () => {
  it('导入图标保持中文名称与点击行为，新建保留主按钮文字', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage, {
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    const entry = wrapper.get('button[aria-label="导入 JSON"]')
    expect(entry.classes()).toContain('dt-btn--icon-only')
    expect(
      wrapper.findAll('button').some((item) => item.text() === '新建工作流'),
    ).toBe(true)
    await entry.trigger('click')
    expect(wrapper.text()).toContain('导入工作流 JSON')
    wrapper.unmount()
  })

  it('有设计权限时可从现有流水线打开复制表单', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline()]),
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage, {
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    await selectMore(wrapper, '复制工作流')
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
    await selectMore(wrapper, '复制工作流')
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
    expect(wrapper.find('button[aria-label="复制工作流"]').exists()).toBe(false)
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
      .find((button) => button.text().trim() === '打开工作流')
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
    await selectMore(wrapper, '复制工作流')
    function input(label: string) {
      const field = wrapper
        .getComponent(PipelineFormDialog)
        .findAllComponents(DtInput)
        .find((item) => item.props('label') === label)
      if (!field) throw new Error(`缺少输入框：${label}`)
      return field.get('input')
    }
    await input('工作流名称').setValue('修改后的副本')
    await input('编码').setValue('conflicting_code')
    await wrapper.getComponent(PipelineFormDialog).get('form').trigger('submit')
    await flushPromises()
    expect(input('工作流名称').element.value).toBe('修改后的副本')
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

  it('工作流入口展示三步流程，各管理页从侧栏直接进入', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage)
    await flushPromises()
    expect(wrapper.text()).toContain('创建工作流')
    expect(wrapper.text()).toContain('配置与训练')
    expect(wrapper.text()).toContain('发布模型')
    expect(wrapper.text()).toContain('历史实例')
    expect(modeling.listModelingPipelines).toHaveBeenCalledWith({
      page: 1,
      size: 200,
      includeInstances: false,
    })
    expect(wrapper.find('nav[aria-label="分析建模导航"]').exists()).toBe(false)
    expect(
      NAV_ITEMS.find((item) => item.key === 'modeling')?.children?.map(
        (item) => item.to,
      ),
    ).toEqual([
      '/modeling/pipelines',
      '/modeling/runs',
      '/modeling/models',
      '/modeling/services',
    ])
    wrapper.unmount()
  })

  it('卡片视图使用独立信息卡与底部操作，保存模板入口在两种视图中一致', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(
      page([pipeline({ description: '按温度和负荷预测能耗' })]),
    )
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
    const wrapper = mount(PipelinesPage, {
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    await wrapper.get('[aria-label="卡片视图"]').trigger('click')
    const card = wrapper.getComponent(PipelineCard)
    expect(card.text()).toContain('按温度和负荷预测能耗')
    expect(card.get('footer').text()).toContain('打开工作流')
    expect(card.get('.pipeline-card__body').find('button').exists()).toBe(false)
    await selectMore(wrapper, '保存为模板')
    expect(
      wrapper.getComponent(PublishTemplateDialog).props('pipeline'),
    ).toMatchObject({ id: 'p1', name: '能耗回归' })
    wrapper.getComponent(PublishTemplateDialog).vm.$emit('close')
    await flushPromises()
    expect(
      wrapper.getComponent(PublishTemplateDialog).props('pipeline'),
    ).toBeNull()
    await wrapper.get('[aria-label="表格视图"]').trigger('click')
    expect(wrapper.findComponent(PipelineCard).exists()).toBe(false)
    await selectMore(wrapper, '保存为模板')
    expect(
      wrapper.getComponent(PublishTemplateDialog).props('pipeline'),
    ).toMatchObject({ id: 'p1' })
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

    expect(wrapper.text()).toContain('还有 6 条工作流没取回来')
  })

  it('只有读码时不给「新建」，并留一句说明', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = mount(PipelinesPage)
    await flushPromises()

    expect(wrapper.text()).not.toContain('新建工作流')
    expect(wrapper.find('button[aria-label="复制工作流"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="perm-readonly"]').exists()).toBe(true)
  })

  it('有写码就给「新建」', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])

    const wrapper = mount(PipelinesPage)
    await flushPromises()

    expect(wrapper.text()).toContain('新建工作流')
  })

  it('一条都没有时劝人去建，而不是显示一张空表', async () => {
    vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue(page([]))
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = mount(PipelinesPage)
    await flushPromises()

    expect(wrapper.text()).toContain('还没有工作流')
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

    expect(wrapper.text()).not.toContain('还没有工作流')
  })
})
