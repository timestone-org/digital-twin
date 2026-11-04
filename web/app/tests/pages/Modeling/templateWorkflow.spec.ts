/** @fileoverview 模板发布、历史实例检索与第三方接入说明。 */
import type { ModelingTask, ModelingTemplate } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as ui from '@dt/ui'
import * as api from '@/api/modelingTemplates'
import * as hierarchy from '@/api/hierarchy'
import { useAuthStore } from '@/stores/auth'
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
  task: 'regression',
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
  vi.spyOn(api, 'publishTemplate').mockResolvedValue(template)
  if (!configuration.instance) throw new Error('缺少模型夹具')
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

it('发布已保存设计，失败时保留内容可再次提交', async () => {
  vi.mocked(api.publishTemplate).mockRejectedValueOnce(new Error('offline'))
  const wrapper = mount(PublishButton, {
    props: { pipeline: { id: 'p1', name: '设计' } },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  await button(wrapper, '保存为模板').trigger('click')
  await flushPromises()
  const modal = wrapper.findComponent(ui.DtModal)
  await modal.get('input').setValue('可复用模板')
  await modal.get('textarea').setValue('说明')
  await button(wrapper, '保存模板').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('请求失败')
  await button(wrapper, '保存模板').trigger('click')
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

it.each<{ task: ModelingTask; label: string }>([
  { task: 'regression', label: '回归' },
  { task: 'classification', label: '分类' },
  { task: 'anomaly_detection', label: '异常检测' },
  { task: 'rule_calculation', label: '规则计算' },
])('$task 未训练实例在列表中也有模型类型', async ({ task, label }) => {
  if (!configuration.instance) throw new Error('缺少模型夹具')
  vi.mocked(api.listInstances).mockResolvedValue({
    items: [{ ...configuration.instance, task, latest_run: null }],
    page: 1,
    size: 20,
    total: 1,
  })
  const wrapper = mount(Instances)
  wrappers.push(wrapper)
  await flushPromises()
  expect(wrapper.text()).toContain(label)
  const tableView = wrapper.find('[aria-label="表格视图"]')
  if (tableView.exists()) await tableView.trigger('click')
  expect(wrapper.findAll('thead th').map((cell) => cell.text())).toContain(
    '模型类型',
  )
  expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toContain(
    label,
  )
})

it('接入说明包含完整配置入口和统一用户 APIKey', () => {
  const wrapper = mount(Integration)
  wrappers.push(wrapper)
  expect(wrapper.text()).toContain(
    'POST /modeling-templates/{template_id}:create-workflow',
  )
  expect(wrapper.text()).toContain('PUT /modeling-pipelines/{id}/schedule')
  expect(wrapper.text()).toContain('Authorization: Bearer')
  expect(wrapper.text()).toContain('用户 APIKey')
  expect(wrapper.text()).not.toContain('X-Api-Key')
  expect(wrapper.text()).toContain('Idempotency-Key')
  expect(wrapper.text()).toContain('invoke_url')
  expect(wrapper.text()).toContain('signature_url')
  expect(wrapper.text()).toContain('default_on_missing')
  expect(wrapper.text()).toContain('missing_policy')
})

it.each([['模型实例', Instances, '创建第一个模型', '没有匹配的模型']] as const)(
  '%s 区分空库与已提交筛选的无结果',
  async (_name, page, blank, filtered) => {
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
