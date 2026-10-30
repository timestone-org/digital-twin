/**
 * @fileoverview 流水线列表页：取回后渲染、按名称与编码本地过滤、取不全时明说、
 * 以及写码决定「新建」露不露面。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import type { ModelingPipelineSummary, Page } from '@dt/contracts'
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
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('流水线列表', () => {
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
