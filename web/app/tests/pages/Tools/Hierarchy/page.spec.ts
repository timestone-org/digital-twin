/** @fileoverview 真实层级图页面的创建、编辑、出图、版本与权限交互。 */
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuthUser, HierarchyProject } from '@dt/contracts'
import {
  DtConfirmHost,
  DtToastHost,
  useConfirm,
  useToast,
  DtFilePicker,
  DtNumberInput,
} from '@dt/ui'
import * as api from '@/api/hierarchy'
import { useAuthStore } from '@/stores/auth'
import HierarchyPage from '../../../../src/pages/Tools/Hierarchy/index.vue'
import HierarchyToolbar from '../../../../src/pages/Tools/Hierarchy/components/HierarchyToolbar.vue'
import HierarchyCanvas from '../../../../src/pages/Tools/Hierarchy/components/HierarchyCanvas.vue'
import HierarchyInspector from '../../../../src/pages/Tools/Hierarchy/components/HierarchyInspector.vue'
import { project } from '../../../../src/testing/hierarchyHarness'
import { WorkerFake } from '../../../../src/testing/hierarchyWorkerFake'
vi.mock('@/api/hierarchy')
const effects = { download: vi.fn(), revoke: vi.fn() }
const time = '2026-10-19T00:00:00.000Z'
function user(write: boolean): AuthUser {
  const permissions = write
    ? ['hierarchy:view', 'hierarchy:manage']
    : ['hierarchy:view']
  return {
    id: 'user',
    username: 'tester',
    email: 'tester@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: time,
    updated_at: time,
    role: { id: 'role', name: '测试', description: null, is_builtin: false },
    role_permissions: permissions,
    direct_permissions: [],
    permissions,
  }
}
let stored: HierarchyProject[] = []
beforeEach(() => {
  vi.stubGlobal('Worker', WorkerFake)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hierarchy-test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(effects.revoke)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    effects.download,
  )
  stored = [project()]
  vi.mocked(api.capabilities).mockResolvedValue({
    is_enabled: true,
    max_nodes: 300,
    max_edges: 2000,
    history_limit: 50,
  })
  vi.mocked(api.listProjects).mockImplementation(() =>
    Promise.resolve({
      items: stored,
      page: 1,
      size: 20,
      total: stored.length,
    }),
  )
  vi.mocked(api.getProject).mockImplementation((id) => {
    const found = stored.find((item) => item.id === id)
    if (!found) throw new Error('项目不存在')
    return Promise.resolve(structuredClone(found))
  })
  vi.mocked(api.createProject).mockImplementation((document) => {
    const created = {
      ...project(`created-${stored.length}`),
      title: document.title,
      document: structuredClone(document),
    }
    stored.push(created)
    return Promise.resolve(created)
  })
  vi.mocked(api.saveProject).mockImplementation((id, revision, document) => {
    const updated = {
      ...project(id, revision + 1),
      title: document.title,
      document: structuredClone(document),
    }
    stored = stored.map((item) => (item.id === id ? updated : item))
    return Promise.resolve(updated)
  })
  vi.mocked(api.history).mockResolvedValue({
    items: [{ revision: 1, created_at: time }],
    has_more: false,
    next: null,
  })
  vi.mocked(api.restoreProject).mockResolvedValue(project('project-1', 3))
  vi.mocked(api.deleteProject).mockImplementation((id) => {
    stored = stored.filter((item) => item.id !== id)
    return Promise.resolve()
  })
})
afterEach(() => {
  useConfirm().resolve(false)
  useToast().clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  localStorage.clear()
})
async function setup(write = true) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().user = user(write)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tools/hierarchy', component: HierarchyPage },
      { path: '/', component: { template: '<div>首页</div>' } },
      { path: '/profile', component: { template: '<div>个人中心</div>' } },
    ],
  })
  await router.push('/tools/hierarchy')
  await router.isReady()
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h('div', [h(RouterView), h(DtConfirmHost), h(DtToastHost)]),
    }),
    {
      global: { plugins: [pinia, router], stubs: { teleport: true } },
      attachTo: document.body,
    },
  )
  await flushPromises()
  return wrapper
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  const found = wrapper
    .findAll('button')
    .find(
      (node) => node.text() === text || node.attributes('aria-label') === text,
    )
  if (!found) throw new Error(`按钮不存在：${text}`)
  return found
}
it('编辑保存、生成、导出、版本恢复和复制可从页面完成', async () => {
  const wrapper = await setup()
  expect(wrapper.text()).toContain('蒸汽计量系统')
  expect(wrapper.findAll('[role="separator"]')).toHaveLength(2)
  const canvas = wrapper.getComponent(HierarchyCanvas)
  canvas.vm.$emit('save')
  await flushPromises()
  const nodes = wrapper.findAll('.hierarchy-node')
  await nodes[0]?.trigger('keydown', { key: 'Enter' })
  const inspector = wrapper.getComponent(HierarchyInspector)
  const name = inspector.get('textarea')
  await name.setValue('锅炉验收')
  await button(wrapper, '应用修改').trigger('click')
  await button(wrapper, '保存').trigger('click')
  await flushPromises()
  expect(api.saveProject).toHaveBeenCalledWith(
    'project-1',
    1,
    expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({ name: '锅炉验收' }),
      ]),
    }),
  )
  const toolbar = wrapper.getComponent(HierarchyToolbar)
  toolbar.vm.$emit('draw')
  await flushPromises()
  expect(wrapper.findAll('[role="separator"]')).toHaveLength(2)
  expect(wrapper.text()).toContain('33 个计量节点 · 4 层 · 5 行')
  expect(wrapper.find('img[alt="标准计量层级图"]').exists()).toBe(true)
  await button(wrapper, '放大').trigger('click')
  await button(wrapper, '缩小').trigger('click')
  await button(wrapper, '适应图纸').trigger('click')
  toolbar.vm.$emit('export', 'svg')
  await flushPromises()
  expect(effects.download).toHaveBeenCalled()
  toolbar.vm.$emit('export', 'json')
  await flushPromises()
  expect(effects.revoke).toHaveBeenCalled()
  await wrapper.get('[aria-label="项目操作"]').trigger('click')
  await button(wrapper, '历史版本').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('最近 50 个保存版本')
  await button(wrapper, '恢复此版本').trigger('click')
  useConfirm().resolve(true)
  await flushPromises()
  expect(api.restoreProject).toHaveBeenCalledWith('project-1', 2, 1)
  await wrapper.get('[aria-label="关闭"]').trigger('click')
  await wrapper.get('[aria-label="项目操作"]').trigger('click')
  await button(wrapper, '复制').trigger('click')
  await flushPromises()
  expect(api.createProject).toHaveBeenCalledWith(
    expect.objectContaining({ title: expect.stringContaining('副本') }),
  )
  wrapper.unmount()
})
it('新建示例、导入、删除、搜索和编辑器动作正确接线', async () => {
  const wrapper = await setup()
  await button(wrapper, '新建项目').trigger('click')
  const dialog = wrapper.get('[role="dialog"]')
  await dialog.get('input[type="text"]').setValue('新增验收')
  await dialog.get('input[type="checkbox"]').setValue(true)
  await button(wrapper, '创建项目').trigger('click')
  await flushPromises()
  expect(api.createProject).toHaveBeenCalledWith(
    expect.objectContaining({ title: '新增验收', nodes: expect.any(Array) }),
  )
  const toolbar = wrapper.getComponent(HierarchyToolbar)
  toolbar.vm.$emit('add', 'meter')
  await flushPromises()
  expect(wrapper.text()).toContain('新计量节点')
  await button(wrapper, '撤销').trigger('click')
  await button(wrapper, '重做').trigger('click')
  await button(wrapper, '删除选中').trigger('click')
  toolbar.vm.$emit('arrange')
  await vi.waitFor(() =>
    expect(button(wrapper, '整理画布').attributes('disabled')).toBeUndefined(),
  )
  const upload = wrapper.getComponent(DtFilePicker)
  upload.vm.$emit('select', [
    new File(
      [
        JSON.stringify({
          format: 'layerflow.project',
          document: project().document,
        }),
      ],
      '配置.json',
      { type: 'application/json' },
    ),
  ])
  await flushPromises()
  expect(api.createProject).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: '蒸汽计量系统' }),
  )
  await button(wrapper, '查询项目').trigger('click')
  await flushPromises()
  expect(api.listProjects).toHaveBeenCalled()
  await wrapper.get('[aria-label="项目操作"]').trigger('click')
  await button(wrapper, '删除项目').trigger('click')
  expect(useConfirm().pending.value, wrapper.text()).not.toBeNull()
  useConfirm().resolve(true)
  await flushPromises()
  expect(api.deleteProject).toHaveBeenCalled()
  wrapper.unmount()
})
it('只读账号不出现管理入口，服务缺席有明确状态', async () => {
  const wrapper = await setup(false)
  expect(
    wrapper.findAll('button').some((node) => node.text() === '新建项目'),
  ).toBe(false)
  expect(wrapper.findAll('[data-port]').length).toBe(0)
  wrapper.unmount()
  vi.mocked(api.capabilities).mockRejectedValue(new Error('服务不可用'))
  const absent = await setup()
  expect(absent.text()).toContain('层级图服务尚未启用或暂时不可用')
  await button(absent, '重新检查').trigger('click')
  await flushPromises()
  expect(absent.text()).toContain('服务不可用')
  absent.unmount()
})

it('预览中修改图纸宽度标记过期，重新生成后更新预览', async () => {
  const wrapper = await setup()
  await button(wrapper, '生成层级图').trigger('click')
  await flushPromises()
  const inspector = wrapper.getComponent(HierarchyInspector)
  expect(inspector.text()).toContain('图纸宽度')
  inspector.getComponent(DtNumberInput).vm.$emit('update:modelValue', 2245)
  await flushPromises()
  expect(wrapper.text()).toContain('配置已更新，当前预览尚未刷新')
  await button(wrapper, '重新生成预览').trigger('click')
  await flushPromises()
  expect(wrapper.text()).not.toContain('当前预览尚未刷新')
  expect(wrapper.find('img[alt="标准计量层级图"]').exists()).toBe(true)
  await button(wrapper, '返回编辑').trigger('click')
  expect(wrapper.getComponent(HierarchyCanvas).isVisible()).toBe(true)
  wrapper.unmount()
})

it('窄屏一次显示一个面板，切换配置保留草稿并可返回项目画布', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  const wrapper = await setup()
  expect(wrapper.findAll('[data-pane]')).toHaveLength(1)
  expect(wrapper.get('[data-pane]').attributes('data-pane')).toBe('canvas')
  await wrapper.get('.hierarchy-node').trigger('keydown', { key: 'Enter' })
  await button(wrapper, '配置面板').trigger('click')
  expect(wrapper.get('[data-pane]').attributes('data-pane')).toBe('inspector')
  await wrapper.get('textarea').setValue('窄屏编辑草稿')
  await button(wrapper, '编辑画布').trigger('click')
  await button(wrapper, '配置').trigger('click')
  expect(wrapper.get('textarea').element.value).toBe('窄屏编辑草稿')
  await button(wrapper, '项目列表').trigger('click')
  expect(wrapper.get('[data-pane]').attributes('data-pane')).toBe('projects')
  await button(wrapper, '蒸汽计量系统').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-pane]').attributes('data-pane')).toBe('canvas')
  expect(wrapper.text()).toContain('窄屏编辑草稿')
  wrapper.unmount()
})

it('无项目时提供空白和示例入口，取消新建不产生项目', async () => {
  stored = []
  const wrapper = await setup()
  expect(wrapper.text()).toContain('从一张层级图开始')
  await button(wrapper, '创建空白项目').trigger('click')
  expect(
    wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked,
  ).toBe(false)
  await button(wrapper, '取消').trigger('click')
  expect(api.createProject).not.toHaveBeenCalled()
  await button(wrapper, '从示例开始').trigger('click')
  expect(
    wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked,
  ).toBe(true)
  await button(wrapper, '创建项目').trigger('click')
  await flushPromises()
  expect(wrapper.findAll('.hierarchy-node')).toHaveLength(34)
  wrapper.unmount()
})

it('窄屏从配置面板添加节点后可立即编辑并生成预览', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  const wrapper = await setup()
  await button(wrapper, '配置').trigger('click')
  await button(wrapper, '计量节点').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-pane]').attributes('data-pane')).toBe('inspector')
  expect(wrapper.get('textarea').element.value).toBe('新计量节点')
  await button(wrapper, '生成层级图').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-pane]').attributes('data-pane')).toBe('canvas')
  await button(wrapper, '配置').trigger('click')
  await button(wrapper, '重新生成').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-pane]').attributes('data-pane')).toBe('canvas')
  wrapper.unmount()
})
