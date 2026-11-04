/** @fileoverview 工作流主操作、更多菜单的权限与事件契约。 */
import { PERMISSION_CODES } from '@dt/contracts'
import type { ModelingPipelineSummary } from '@dt/contracts'
import { DtDropdownMenu, DtIconButton, DtTooltip } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import PipelineActions from '@/pages/Modeling/Pipelines/components/PipelineActions.vue'
import { useAuthStore } from '@/stores/auth'

const row: ModelingPipelineSummary = {
  id: 'pipeline',
  code: 'energy',
  name: '能耗',
  description: null,
  node_count: 0,
  source_table_codes: [],
  created_at: '2026-11-02T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
  created_by_name: null,
}
const wrappers: VueWrapper[] = []
function permissions(codes: string[]): void {
  useAuthStore().user = {
    id: 'account',
    username: 'analyst',
    email: 'analyst@example.test',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    role: { id: 'role', name: 'analyst', description: '', is_builtin: false },
    permissions: codes,
    role_permissions: codes,
    direct_permissions: [],
  }
}
function open() {
  const wrapper = mount(PipelineActions, {
    attachTo: document.body,
    global: {
      stubs: {
        teleport: true,
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
    props: { row, isSaving: false, exportingId: null },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function clickMore(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('button[aria-label="工作流更多操作"]').trigger('click')
  await flushPromises()
}
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
})

it('主操作保留文字，训练记录图标仍有名称与提示', async () => {
  permissions([PERMISSION_CODES.modelingView])
  const wrapper = open()
  expect(wrapper.findAll('button').map((item) => item.text())).toEqual([
    '打开工作流',
    '训练记录',
  ])
  const history = wrapper.getComponent(DtIconButton)
  expect(history.props()).toMatchObject({
    icon: 'list-checks',
    label: '训练记录',
    tooltip: '查看此工作流的训练记录',
  })
  expect(history.get('button').classes()).toContain('dt-btn--icon-only')
  expect(history.get('button').attributes('aria-label')).toBe('训练记录')
  expect(wrapper.get('a').attributes('href')).toBe(
    '/modeling/runs?pipeline_id=pipeline',
  )
  await wrapper.findAll('button')[0]?.trigger('click')
  expect(wrapper.emitted('open')).toEqual([[row]])
  expect(wrapper.findComponent(DtDropdownMenu).exists()).toBe(false)
})
it('更多使用省略号图标触发，菜单文字与危险删除保持可读', async () => {
  permissions([
    PERMISSION_CODES.modelingView,
    PERMISSION_CODES.modelingManage,
    PERMISSION_CODES.modelingRun,
  ])
  const wrapper = open()
  expect(
    wrapper
      .findAll('button')
      .map((item) => item.attributes('aria-label') ?? item.text()),
  ).toEqual(['打开工作流', '训练记录', '工作流更多操作'])
  const trigger = wrapper.get('button[aria-label="工作流更多操作"]')
  expect(trigger.classes()).toContain('dt-btn--icon-only')
  expect(trigger.attributes('aria-haspopup')).toBe('menu')
  expect(trigger.attributes('aria-expanded')).toBe('false')
  expect(trigger.attributes('aria-controls')).toBeTruthy()
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  await clickMore(wrapper)
  expect(wrapper.get('[role="dialog"]').attributes('id')).toBe(
    trigger.attributes('aria-controls'),
  )
  const items = wrapper.findAll('[role="menuitem"]')
  expect(items.map((item) => item.text())).toEqual([
    '定时训练',
    '保存为模板',
    '复制工作流',
    '导出 JSON',
    '编辑信息',
    '删除工作流',
  ])
  expect(items.at(-1)?.classes()).toContain('dt-menu__item--danger')
  expect(
    wrapper
      .get('button[aria-label="工作流更多操作"]')
      .attributes('aria-expanded'),
  ).toBe('true')
})
it('更多图标有中文提示，提示说明关联到触发按钮', async () => {
  permissions([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
  const wrapper = open()
  const tip = wrapper
    .findAllComponents(DtTooltip)
    .find((item) => item.props('content') === '工作流更多操作')
  if (!tip) throw new Error('缺少更多操作提示')
  await tip.trigger('mouseenter')
  const content = document.querySelector('[role="tooltip"]')
  expect(content?.textContent).toBe('工作流更多操作')
  expect(
    wrapper
      .get('button[aria-label="工作流更多操作"]')
      .attributes('aria-describedby'),
  ).toBe(content?.id)
})
it.each([
  ['定时训练', 'schedule'],
  ['保存为模板', 'saveTemplate'],
  ['复制工作流', 'copy'],
  ['导出 JSON', 'export'],
  ['编辑信息', 'edit'],
  ['删除工作流', 'remove'],
])('%s 菜单操作转发同一工作流并关闭菜单', async (label, event) => {
  permissions([
    PERMISSION_CODES.modelingView,
    PERMISSION_CODES.modelingManage,
    PERMISSION_CODES.modelingRun,
  ])
  const wrapper = open()
  await clickMore(wrapper)
  await wrapper
    .findAll('[role="menuitem"]')
    .find((item) => item.text() === label)
    ?.trigger('click')
  expect(wrapper.emitted(event)).toEqual([[row]])
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
})
it('只有训练权限时更多菜单仅包含定时训练', async () => {
  permissions([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingRun])
  const wrapper = open()
  await clickMore(wrapper)
  expect(
    wrapper.findAll('[role="menuitem"]').map((item) => item.text()),
  ).toEqual(['定时训练'])
})
it('保存或导出进行中禁止重复提交管理操作', async () => {
  permissions([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
  const wrapper = open()
  await wrapper.setProps({ isSaving: true, exportingId: row.id })
  await clickMore(wrapper)
  const items = wrapper.findAll('[role="menuitem"]')
  expect(items).toHaveLength(5)
  expect(items.every((item) => item.attributes('disabled') !== undefined)).toBe(
    true,
  )
  await items.find((item) => item.text() === '复制工作流')?.trigger('click')
  expect(wrapper.emitted('copy')).toBeUndefined()
})
