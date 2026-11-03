/** @fileoverview 流水线行操作保持设计权限、忙碌保护和事件转发。 */
import { PERMISSION_CODES } from '@dt/contracts'
import type { ModelingPipelineSummary } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
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
    created_at: '2026-11-02T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
    role: { id: 'role', name: 'analyst', description: '', is_builtin: false },
    permissions: codes,
    role_permissions: codes,
    direct_permissions: [],
  }
}
beforeEach(() => {
  setActivePinia(createPinia())
})

it('只读用户只能打开流程图，设计操作不存在', async () => {
  permissions([PERMISSION_CODES.modelingView])
  const wrapper = mount(PipelineActions, {
    props: { row, isSaving: false, exportingId: null },
  })
  expect(wrapper.findAll('button')).toHaveLength(1)
  await wrapper.get('button').trigger('click')
  expect(wrapper.emitted('open')).toEqual([[row]])
  wrapper.unmount()
})

it('设计操作转发同一条流水线，并在忙碌时禁止复制和重复导出', async () => {
  permissions([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])
  const wrapper = mount(PipelineActions, {
    props: { row, isSaving: false, exportingId: null },
  })
  for (const [label, event] of [
    ['导出已保存的流水线 JSON', 'export'],
    ['复制流水线', 'copy'],
    ['编辑信息', 'edit'],
    ['删除流水线', 'remove'],
  ] as const) {
    await wrapper.get(`button[aria-label="${label}"]`).trigger('click')
    expect(wrapper.emitted(event)).toEqual([[row]])
  }
  await wrapper.setProps({ isSaving: true, exportingId: row.id })
  expect(
    wrapper.get('button[aria-label="复制流水线"]').attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper
      .get('button[aria-label="导出已保存的流水线 JSON"]')
      .attributes('disabled'),
  ).toBeDefined()
  wrapper.unmount()
})
