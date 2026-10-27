/** @fileoverview 模板发布、建模、启停及检索的用户交互。 */
import type { ModelingTemplate } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as ui from '@dt/ui'
import * as api from '@/api/modelingTemplates'
import * as hierarchy from '@/api/hierarchy'
import { useAuthStore } from '@/stores/auth'
import Templates from '@/pages/Modeling/Templates/index.vue'
import Instances from '@/pages/Modeling/Instances/index.vue'
import Integration from '@/pages/Modeling/Integration/index.vue'
import PublishButton from '@/pages/Modeling/components/PublishTemplateButton.vue'
import PublishTemplateDialog from '@/pages/Modeling/components/PublishTemplateDialog.vue'
import { configuration } from '@/testing/modelingTemplateFixtures'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/modeling/templates', query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
const template: ModelingTemplate = {
  id: 't1',
  pipeline_id: 'p1',
  code: 'energy',
  name: '能耗模板',
  description: '输入温度与负荷',
  node_count: 4,
  version: 1,
  is_enabled: true,
  created_by_name: '测试员',
  created_at: '2026-10-27T00:00:00.000Z',
  updated_at: '2026-10-27T00:00:00.000Z',
}
const wrappers: VueWrapper[] = []
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper
    .findAll('button')
    .find((item) => item.text().trim() === text)
  if (!found) throw new Error(`没有按钮：${text}`)
  return found
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  vi.spyOn(hierarchy, 'capabilities').mockResolvedValue({
    is_enabled: false,
    history_limit: 10,
    max_edges: 10,
    max_nodes: 10,
  })
  const confirmation = ui.useConfirm()
  vi.spyOn(ui, 'useConfirm').mockReturnValue({
    ...confirmation,
    ask: vi.fn().mockResolvedValue(true),
  })
  vi.spyOn(api, 'listTemplates').mockResolvedValue({
    items: [template],
    page: 1,
    size: 20,
    total: 1,
  })
  vi.spyOn(api, 'setTemplateEnabled').mockResolvedValue({
    ...template,
    is_enabled: false,
  })
  vi.spyOn(api, 'publishTemplate').mockResolvedValue(template)
  if (!configuration.instance) throw new Error('缺少模型夹具')
  vi.spyOn(api, 'createInstance').mockResolvedValue(configuration.instance)
  vi.spyOn(api, 'listInstances').mockResolvedValue({
    items: [configuration.instance],
    page: 1,
    size: 20,
    total: 1,
  })
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})

it('模板库支持服务端搜索、启停并创建独立模型', async () => {
  const wrapper = mount(Templates, { global: { stubs: { teleport: true } } })
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.get('input[type="search"]').setValue('energy')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(api.listTemplates).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: 'energy' },
    expect.any(AbortSignal),
  )
  await button(wrapper, '停用').trigger('click')
  await flushPromises()
  expect(api.setTemplateEnabled).toHaveBeenCalledWith('t1', false)
  await button(wrapper, '创建模型').trigger('click')
  await flushPromises()
  const dialog = wrapper.findComponent(ui.DtModal)
  await textInput(dialog, '模型名称').setValue('新模型')
  await textInput(dialog, '模型编码').setValue('new-model')
  await dialog.get('textarea').setValue('验证模板复用')
  await button(wrapper, '创建并配置').trigger('click')
  await flushPromises()
  expect(api.createInstance).toHaveBeenCalledWith({
    template_id: 't1',
    code: 'new-model',
    name: '新模型',
    description: '验证模板复用',
  })
})

it('发布已保存设计，失败时保留内容可再次提交', async () => {
  vi.mocked(api.publishTemplate).mockRejectedValueOnce(new Error('offline'))
  const wrapper = mount(PublishButton, {
    props: { pipeline: { id: 'p1', name: '设计' } },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  await button(wrapper, '发布为模板').trigger('click')
  await flushPromises()
  const modal = wrapper.findComponent(ui.DtModal)
  await modal.get('input').setValue('可复用模板')
  await modal.get('textarea').setValue('说明')
  await button(wrapper, '发布模板').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('请求失败')
  await button(wrapper, '发布模板').trigger('click')
  await flushPromises()
  expect(api.publishTemplate).toHaveBeenLastCalledWith({
    pipeline_id: 'p1',
    name: '可复用模板',
    description: '说明',
  })
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
})

it('模型列表显示实例来源和状态，并按编码搜索', async () => {
  const wrapper = mount(Instances)
  wrappers.push(wrapper)
  await flushPromises()
  expect(wrapper.text()).toContain(configuration.instance?.name)
  expect(wrapper.text()).toContain('训练成功')
  await wrapper.get('input[type="search"]').setValue('model')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(api.listInstances).toHaveBeenLastCalledWith(
    { page: 1, size: 20, q: 'model' },
    expect.any(AbortSignal),
  )
})

it('接入说明包含完整配置入口和两种密钥用途', () => {
  const wrapper = mount(Integration)
  wrappers.push(wrapper)
  expect(wrapper.text()).toContain('PUT /modeling-instances/{id}/configuration')
  expect(wrapper.text()).toContain('X-Api-Key')
  expect(wrapper.text()).toContain('Idempotency-Key')
})

function textInput(wrapper: VueWrapper, label: string) {
  const field = wrapper
    .findAllComponents(ui.DtInput)
    .find((item) => item.props('label') === label)
  if (!field) throw new Error(`没有输入框：${label}`)
  return field.get('input')
}

it.each([
  ['模板库', Templates, '还没有已发布模板', '没有匹配的模板'],
  ['模型实例', Instances, '创建第一个模型', '没有匹配的模型'],
] as const)(
  '%s 区分空库与已提交筛选的无结果',
  async (_name, page, blank, filtered) => {
    vi.mocked(api.listTemplates).mockResolvedValue({
      items: [],
      page: 1,
      size: 20,
      total: 0,
    })
    vi.mocked(api.listInstances).mockResolvedValue({
      items: [],
      page: 1,
      size: 20,
      total: 0,
    })
    const wrapper = mount(page)
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain(blank)
    await wrapper.get('input[type="search"]').setValue('no-such-entry')
    expect(wrapper.text()).toContain(blank)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain(filtered)
    expect(wrapper.text()).not.toContain(blank)
    await wrapper.get('input[type="search"]').setValue('')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain(blank)
  },
)

it('模板发布草稿防止误关，切换设计时建立新的干净基准', async () => {
  const wrapper = mount(PublishTemplateDialog, {
    props: { pipeline: { id: 'p1', name: '原设计' } },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  expect(wrapper.findComponent(ui.DtModal).props('dirty')).toBe(false)
  await wrapper.get('textarea').setValue('尚未保存的模板用途')
  expect(wrapper.findComponent(ui.DtModal).props('dirty')).toBe(true)
  await wrapper.get('.dt-modal__backdrop').trigger('click')
  expect(wrapper.emitted('close')).toBeUndefined()
  expect(wrapper.text()).toContain('有还没提交的内容')
  await wrapper.setProps({ pipeline: { id: 'p2', name: '另一个设计' } })
  expect(wrapper.findComponent(ui.DtModal).props('dirty')).toBe(false)
  expect(wrapper.get('input').element.value).toBe('另一个设计')
})
