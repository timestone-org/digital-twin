/** @fileoverview 解绑图标保留发布权限、原绑定与启停开关。 */
import type { ModelingBinding } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtIconButton, DtSwitch } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BindingTable from '@/pages/Modeling/Models/components/BindingTable.vue'
import { useAuthStore } from '@/stores/auth'

const BINDING: ModelingBinding = {
  id: 'b1',
  fx_code: 'predict_energy',
  model_version_id: 'v1',
  param_map: [{ param: 'temperature', feature: 'temp' }],
  is_enabled: true,
  is_orphaned: false,
  created_by_name: '分析员',
  created_at: '2026-11-03T00:00:00Z',
  updated_at: '2026-11-03T00:00:00Z',
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockImplementation((codes) =>
    codes.includes(PERMISSION_CODES.modelingPublish),
  )
})
afterEach(() => vi.restoreAllMocks())

function open() {
  return mount(BindingTable, {
    props: {
      rows: [BINDING],
      versionLabels: new Map([['v1', '能耗模型 v1']]),
      isLoading: false,
      error: null,
      pagination: { page: 1, size: 20, total: 1 },
      view: 'table',
    },
  })
}

it('解绑有图标名称和说明，点击传回原绑定且不改变启停事件', async () => {
  const wrapper = open()
  expect(wrapper.getComponent(DtIconButton).props()).toMatchObject({
    label: '解绑',
    tooltip: '解除公式绑定',
    icon: 'trash',
    intent: 'danger',
  })
  await wrapper.get('button[aria-label="解绑"]').trigger('click')
  expect(wrapper.emitted('unbind')).toEqual([[BINDING]])
  wrapper.getComponent(DtSwitch).vm.$emit('update:modelValue', false)
  expect(wrapper.emitted('toggle')).toEqual([[BINDING, false]])
  wrapper.unmount()
})

it('只读用户不显示解绑和启停交互', () => {
  vi.mocked(useAuthStore().can).mockReturnValue(false)
  const wrapper = open()
  expect(wrapper.find('button[aria-label="解绑"]').exists()).toBe(false)
  expect(wrapper.findComponent(DtSwitch).exists()).toBe(false)
  expect(wrapper.text()).toContain('启用')
  wrapper.unmount()
})
