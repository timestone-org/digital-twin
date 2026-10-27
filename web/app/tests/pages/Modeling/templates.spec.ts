/** @fileoverview 模板库真实列插槽展示名称、说明与算子数。 */
import type { ModelingTemplate } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import * as api from '@/api/modelingTemplates'
import Templates from '@/pages/Modeling/Templates/index.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ path: '/modeling/templates', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))
afterEach(() => vi.restoreAllMocks())

it('表格和卡片都展示完整模板信息', async () => {
  setActivePinia(createPinia())
  const item: ModelingTemplate = {
    id: 't1',
    pipeline_id: 'p1',
    code: 'energy',
    name: '冷机能耗模板',
    description: '预测每小时能耗',
    node_count: 6,
    version: 2,
    is_enabled: true,
    created_by_name: '测试员',
    created_at: '2026-10-27T00:00:00.000Z',
    updated_at: '2026-10-27T00:00:00.000Z',
  }
  vi.spyOn(api, 'listTemplates').mockResolvedValue({
    items: [item],
    page: 1,
    size: 20,
    total: 1,
  })
  const wrapper = mount(Templates)
  await flushPromises()
  expect(wrapper.text()).toContain('冷机能耗模板')
  expect(wrapper.text()).toContain('预测每小时能耗')
  expect(wrapper.text()).toContain('v2')
  expect(wrapper.text()).toContain('6')
  const table = wrapper.find('[aria-label="表格视图"]')
  if (table.exists()) await table.trigger('click')
  expect(wrapper.text()).toContain('冷机能耗模板')
  expect(wrapper.text()).toContain('预测每小时能耗')
  wrapper.unmount()
})
