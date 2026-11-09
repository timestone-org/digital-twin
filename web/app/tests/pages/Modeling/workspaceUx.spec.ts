/** @fileoverview 模板选择、创建保护和流程图辅助操作的用户契约。 */
import { DtInput, DtModal, DtSegmented } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import PipelineFormDialog from '@/pages/Modeling/Pipelines/components/PipelineFormDialog.vue'
import TemplatePicker from '@/pages/Modeling/Pipelines/components/TemplatePicker.vue'
import WorkflowTemplateDialog from '@/pages/Modeling/Pipelines/components/WorkflowTemplateDialog.vue'
import CanvasToolbar from '@/pages/Modeling/Canvas/components/CanvasToolbar.vue'
import CanvasWorkspaceBar from '@/pages/Modeling/Canvas/components/CanvasWorkspaceBar.vue'
import { useAuthStore } from '@/stores/auth'
import AppNavGroupTree from '@/components/layout/AppNavGroupTree.vue'
import { NAV_ITEMS } from '@/components/layout/navItems'
import { usePipelineOps } from '@/pages/Modeling/Pipelines/scripts/usePipelineOps'
import * as modeling from '@/api/modeling'
import * as templatesApi from '@/api/modelingTemplates'
import { builtinTemplatePage } from '@/testing/modelingBuiltinTemplateFixtures'
import { defineComponent } from 'vue'
import { PIPELINE_TEMPLATES } from '@/pages/Modeling/Pipelines/scripts/templates'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(templatesApi, 'listBuiltinTemplates').mockResolvedValue(
    builtinTemplatePage(),
  )
})
afterEach(() => vi.restoreAllMocks())

it('工作栏提供配置与历史入口，并准确展示只读和草稿状态', async () => {
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  const state = {
    isReadonly: false,
    isReplaying: false,
    isDirty: true,
    canUndo: true,
    canRedo: true,
    canConfigure: true,
    nodeCount: 6,
    progress: '',
  }
  const wrapper = mount(CanvasWorkspaceBar, { props: { state } })
  expect(wrapper.text()).toContain('有未保存修改')
  for (const [label, event] of [
    ['配置选中节点', 'configure'],
    ['一键整理', 'autoLayout'],
    ['训练历史', 'history'],
    ['撤销', 'undo'],
    ['重做', 'redo'],
    ['快捷键', 'shortcuts'],
  ]) {
    const button = wrapper
      .findAll('button')
      .find(
        (item) =>
          item.text().trim() === label ||
          item.attributes('aria-label') === label,
      )
    if (!button || !event) throw new Error('缺少工作栏操作')
    await button.trigger('click')
    expect(wrapper.emitted(event)).toHaveLength(1)
  }
  await wrapper.setProps({
    state: {
      ...state,
      isReadonly: true,
      isReplaying: true,
      canConfigure: false,
    },
  })
  expect(wrapper.text()).toContain('正在回看历史运行')
  expect(
    wrapper.get('button[aria-label="撤销"]').attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper
      .findAll('button')
      .find((item) => item.text() === '配置选中节点')
      ?.attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper
      .findAll('button')
      .find((item) => item.text().trim() === '一键整理')
      ?.attributes('disabled'),
  ).toBeDefined()
  wrapper.unmount()
})

it('空图不能触发自动整理', async () => {
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  const wrapper = mount(CanvasWorkspaceBar, {
    props: {
      state: {
        isReadonly: false,
        isReplaying: false,
        isDirty: false,
        canUndo: false,
        canRedo: false,
        canConfigure: false,
        nodeCount: 0,
        progress: '',
      },
    },
  })
  const button = wrapper
    .findAll('button')
    .find((item) => item.text().trim() === '一键整理')
  if (!button) throw new Error('缺少自动整理入口')
  expect(button.attributes('disabled')).toBeDefined()
  await button.trigger('click')
  expect(wrapper.emitted('autoLayout')).toBeUndefined()
  wrapper.unmount()
})

it.each(['regression', 'tree', 'classification'])(
  '%s 初始节点之间保留连线空间',
  (key) => {
    const graph = PIPELINE_TEMPLATES.find((item) => item.key === key)?.build()
    const first = graph?.nodes[0]
    const next = graph?.nodes[1]
    if (!first || !next) throw new Error('缺少模板节点')
    expect(next.position.left - first.position.left).toBeGreaterThanOrEqual(256)
  },
)

it('模板按用途筛选，选中模板展示配置说明，搜索无结果时可恢复', async () => {
  vi.mocked(templatesApi.listBuiltinTemplates).mockImplementation((query) =>
    Promise.resolve(
      query.q
        ? { items: [], page: query.page, size: query.size, total: 0 }
        : builtinTemplatePage(['device_anomaly', 'anomaly_model'], 'detection'),
    ),
  )
  const wrapper = mount(TemplatePicker, {
    props: { modelValue: 'regression', disabled: false },
  })
  const filter = wrapper.getComponent(DtSegmented)
  filter.vm.$emit('update:modelValue', 'detection')
  await flushPromises()
  const options = wrapper.findAll('.template-picker__option')
  expect(options).toHaveLength(2)
  expect(options.some((option) => option.text().includes('设备异常检测'))).toBe(
    true,
  )
  await options
    .find((option) => option.text().includes('设备异常检测'))
    ?.trigger('click')
  expect(wrapper.emitted('update:modelValue')).toEqual([['device_anomaly']])
  await wrapper.setProps({ modelValue: 'device_anomaly' })
  expect(wrapper.get('.template-picker__preview').text()).toContain(
    '无需故障标签',
  )
  await wrapper.get('input').setValue('不存在的模板')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('没有匹配的设计模板')
  await wrapper.get('input').setValue('')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.findAll('.template-picker__option')).toHaveLength(2)
  wrapper.unmount()
})

it('新建提交选择的模板和名称，再次打开恢复缺省模板并清除脏态', async () => {
  const draft = { id: null, name: '', code: 'model_test', description: '' }
  const wrapper = mount(PipelineFormDialog, {
    props: { draft, isSaving: false },
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  const name = wrapper
    .findAllComponents(DtInput)
    .find((item) => item.props('label') === '工作流名称')
  if (!name) throw new Error('缺少工作流名称')
  await name.get('input').setValue('冷机异常')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '选择模板')
    ?.trigger('click')
  await flushPromises()
  wrapper
    .getComponent(TemplatePicker)
    .vm.$emit('update:modelValue', 'device_anomaly')
  await flushPromises()
  await wrapper
    .getComponent(WorkflowTemplateDialog)
    .findAll('button')
    .find((button) => button.text() === '使用所选模板')
    ?.trigger('click')
  expect(wrapper.getComponent(DtModal).props('dirty')).toBe(true)
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')?.[0]).toEqual([
    { ...draft, name: '冷机异常' },
    'device_anomaly',
  ])
  await wrapper.setProps({ draft: null })
  await wrapper.setProps({ draft: { ...draft, code: 'model_next' } })
  await flushPromises()
  expect(wrapper.findComponent(TemplatePicker).exists()).toBe(false)
  expect(wrapper.text()).toContain('回归预测')
  expect(wrapper.getComponent(DtModal).props('dirty')).toBe(false)
  wrapper.unmount()
})

it('保存期间禁止再次提交和关闭，编辑信息不提供替换模板', async () => {
  const wrapper = mount(PipelineFormDialog, {
    props: {
      draft: { id: 'p1', name: '已存在', code: 'old_model', description: '' },
      isSaving: true,
    },
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  expect(wrapper.findComponent(TemplatePicker).exists()).toBe(false)
  await wrapper.get('form').trigger('submit')
  wrapper.getComponent(DtModal).vm.$emit('update:modelValue', false)
  expect(wrapper.emitted('submit')).toBeUndefined()
  expect(wrapper.emitted('close')).toBeUndefined()
  expect(
    wrapper
      .findAllComponents(DtInput)
      .every((field) => field.props('disabled')),
  ).toBe(true)
  wrapper.unmount()
})

it('视口操作保留缩放和吸附语义，只读仍可适应视图', async () => {
  const wrapper = mount(CanvasToolbar, {
    props: { zoom: 0.75, isSnapping: true, isReadonly: true, hasNodes: true },
  })
  expect(wrapper.get('[aria-label="回到 100%"] ').text()).toBe('75%')
  await wrapper.get('[aria-label="适应视图"]').trigger('click')
  expect(wrapper.emitted('fit')).toHaveLength(1)
  expect(
    wrapper.get('[aria-label="吸附对齐"]').attributes('aria-pressed'),
  ).toBe('true')
  expect(
    wrapper.get('[aria-label="一键整理"]').attributes('disabled'),
  ).toBeDefined()
  wrapper.unmount()
})

it.each([
  '/modeling/pipelines',
  '/modeling/templates',
  '/modeling/instances/i1',
  '/modeling/integration',
])('%s 仅展示工作流、训练、模型与发布导航', async (path) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  const item = NAV_ITEMS.find((entry) => entry.key === 'modeling')
  if (!item) throw new Error('缺少分析建模导航分组')
  const wrapper = mount(AppNavGroupTree, {
    props: { item, currentPath: path },
    global: { plugins: [router] },
  })
  if (wrapper.get('button').attributes('aria-expanded') === 'false')
    await wrapper.get('button').trigger('click')
  const nav = wrapper.get('.nav-tree__children')
  for (const [href, label] of [
    ['/modeling/pipelines', '工作流'],
    ['/modeling/runs', '训练记录'],
    ['/modeling/models', '训练模型与公式'],
    ['/modeling/services', '已发布模型'],
  ]) {
    expect(nav.get(`a[href="${href}"]`).text()).toContain(label)
  }
  expect(wrapper.find('a[href="/modeling/templates"]').exists()).toBe(false)
  expect(wrapper.find('a[href="/modeling/integration"]').exists()).toBe(false)
  wrapper.unmount()
})

it('创建期间重复提交只发送一次，离开后不触发导航回调', async () => {
  let finish: (() => void) | undefined
  const create = vi
    .spyOn(modeling, 'createModelingPipeline')
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              id: 'p1',
              code: 'model_test',
              name: '测试',
              description: null,
              node_count: 0,
              source_table_codes: [],
              created_by_name: null,
              created_at: '2026-10-28T00:00:00Z',
              updated_at: '2026-10-28T00:00:00Z',
              graph: { format_version: '1.0', nodes: [], edges: [] },
            })
        }),
    )
  const done = vi.fn()
  const host = defineComponent({
    setup() {
      return { ops: usePipelineOps(done) }
    },
    template: '<div />',
  })
  const wrapper = mount(host)
  const ops = wrapper.vm.ops
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    throw new TypeError('randomUUID requires a secure context')
  })
  ops.openCreate()
  expect(ops.draft.value?.code).toMatch(/^model_[a-f0-9]{8}$/)
  const draft = { id: null, code: 'model_test', name: '测试', description: '' }
  const pending = ops.save(draft, 'regression')
  expect(await ops.save(draft, 'regression')).toBeNull()
  wrapper.unmount()
  finish?.()
  expect(await pending).toBeNull()
  expect(create).toHaveBeenCalledOnce()
  expect(done).not.toHaveBeenCalled()
})
