/** @fileoverview 切换报告期间不能把旧草稿写到新模板。 */
import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { DtButton, DtSelect, DtCheckbox } from '@dt/ui'
import { useRoute } from 'vue-router'
import type { ReportTemplate } from '@dt/contracts'
import * as api from '@/api/reports'
import * as dataset from '@/api/dataset'
import EditorPage from '@/pages/Reports/Editor/index.vue'
import MetricPanel from '@/pages/Reports/Editor/components/MetricPanel.vue'
import PageDialog from '@/pages/Reports/Editor/components/PageDialog.vue'
import NodeDialog from '@/pages/Reports/Editor/components/NodeDialog.vue'
import { BizError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/pages/Reports/Editor/components/ReportEditor.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'ReportEditorStub',
      setup(_, { expose }) {
        expose({ insert: vi.fn() })
        return () => h('div', '报告正文编辑器')
      },
    }),
  }
})

vi.mock('vue-router', () => {
  const route = reactive({
    path: '/reports/templates/r1',
    params: { templateId: 'r1' },
    query: {},
  })
  return {
    useRoute: () => route,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    onBeforeRouteLeave: vi.fn(),
    onBeforeRouteUpdate: vi.fn(),
    RouterLink: { template: '<a><slot /></a>' },
  }
})
const stamp = '2026-08-01T00:00:00.000Z'
function template(id: string): ReportTemplate {
  return {
    id,
    code: id,
    name: `报告${id}`,
    description: null,
    granularity: 'month',
    is_enabled: true,
    row_version: 1,
    created_at: stamp,
    updated_at: stamp,
    doc_json: { type: 'doc', content: [{ type: 'paragraph' }] },
    metrics: [],
    page_json: {},
  }
}
afterEach(() => vi.restoreAllMocks())
it('新模板尚未加载时不能保存旧模板内容', async () => {
  setupEditor()
  vi.spyOn(api, 'getReport').mockImplementation((id) =>
    id === 'r1'
      ? Promise.resolve(template('r1'))
      : new Promise(() => undefined),
  )
  vi.spyOn(api, 'saveReport').mockResolvedValue(template('r2'))
  const wrapper = mount(EditorPage, { global: { stubs: { teleport: true } } })
  await flushPromises()
  useRoute().params['templateId'] = 'r2'
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '保存模板')
    ?.trigger('click')
  await flushPromises()
  expect(api.saveReport).not.toHaveBeenCalled()
  wrapper.unmount()
})

function setupEditor(): void {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.accessToken = 'token'
  auth.user = {
    id: 'u',
    username: 'user',
    email: '',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: stamp,
    updated_at: stamp,
    role: { id: 'r', name: 'admin', description: null, is_builtin: true },
    permissions: ['report:view', 'report:manage', 'report:render'],
    direct_permissions: [],
    role_permissions: ['report:view', 'report:manage', 'report:render'],
  }
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 200,
  })
  useRoute().params['templateId'] = 'r1'
}

it('保存、试算、生成及配置修改走完整页面接线', async () => {
  setupEditor()
  vi.spyOn(api, 'getReport').mockResolvedValue(template('r1'))
  vi.spyOn(api, 'saveReport').mockResolvedValue({
    ...template('r1'),
    row_version: 2,
  })
  vi.spyOn(api, 'previewReport').mockResolvedValue({
    is_valid: true,
    period: '2026-08',
    timezone: 'UTC',
    metrics: [],
    nodes: {},
    warnings: [],
  })
  vi.spyOn(api, 'generateReport').mockResolvedValue({
    id: 'j1',
    template_id: 'r1',
    schedule_id: null,
    period: '2026-08',
    granularity: 'month',
    timezone: 'UTC',
    kind: 'render',
    status: 'pending',
    warnings: [],
    error: null,
    created_at: stamp,
    started_at: null,
    finished_at: null,
  })
  const wrapper = mount(EditorPage, { global: { stubs: { teleport: true } } })
  await flushPromises()
  async function click(label: string): Promise<void> {
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === label)
      ?.trigger('click')
    await flushPromises()
  }
  await click('保存模板')
  expect(api.saveReport).toHaveBeenCalledWith(
    'r1',
    expect.objectContaining({ expected_version: 1 }),
  )
  await wrapper.find('input[aria-label="报告期"]').setValue('2026-08')
  await click('试算')
  expect(wrapper.text()).toContain('报告期 2026-08')
  await click('生成已保存模板')
  expect(api.generateReport).toHaveBeenCalledWith('r1', '2026-08')
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'year')
  wrapper.findComponent(DtCheckbox).vm.$emit('update:modelValue', false)
  wrapper
    .findComponent(MetricPanel)
    .vm.$emit('update:modelValue', [{ name: '能耗', mode: 'expr', expr: '20' }])
  await click('页面设置')
  wrapper.findComponent(PageDialog).vm.$emit('save', { header: '新页眉' })
  wrapper.findComponent(PageDialog).vm.$emit('update:modelValue', false)
  await click('插入图表、表格或条件文本')
  wrapper
    .findComponent(NodeDialog)
    .vm.$emit('insert', { type: 'metricRef', attrs: { expr: '{能耗}' } })
  wrapper.findComponent(NodeDialog).vm.$emit('update:modelValue', false)
  vi.mocked(api.saveReport).mockRejectedValue(
    new BizError(41302, '版本冲突', 409, 'trace'),
  )
  await click('保存模板')
  expect(wrapper.text()).toContain('版本冲突')
  expect(api.saveReport).toHaveBeenLastCalledWith(
    'r1',
    expect.objectContaining({
      expected_version: 2,
      granularity: 'year',
      page_json: { header: '新页眉' },
    }),
  )
  vi.mocked(api.previewReport).mockRejectedValue(
    new BizError(51301, '试算超时', 504, 'trace'),
  )
  await click('试算')
  expect(wrapper.text()).toContain('试算超时')
  vi.mocked(api.generateReport).mockRejectedValue(
    new BizError(41305, '队列繁忙', 429, 'trace'),
  )
  await click('生成已保存模板')
  expect(wrapper.text()).toContain('队列繁忙')
  wrapper.unmount()
})
