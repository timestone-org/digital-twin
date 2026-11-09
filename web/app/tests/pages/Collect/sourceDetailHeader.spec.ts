/** @fileoverview 数据源头部：只有在跑的那个动作转圈，删除是危险色。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import type { CollectSource } from '@dt/contracts'
import { DtButton } from '@dt/ui'
import SourceDetailHeader from '@/pages/Collect/components/SourceDetailHeader.vue'
import { useAuthStore } from '@/stores/auth'

enableAutoUnmount(afterEach)
beforeEach(() => {
  setActivePinia(createPinia())
  const codes = ['collect:view', 'collect:operate', 'collect:manage']
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    role: { name: 'admin' },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  } as never
  auth.accessToken = 'token'
})

const SOURCE: CollectSource = {
  id: 's1',
  name: '一号车间 PLC',
  code: 'plant1',
  description: null,
  protocol: 'opcua',
  endpoint: 'opc.tcp://10.0.0.2:4840',
  username: null,
  has_credential: false,
  options_json: {},
  read_mode: 'subscribe',
  poll_interval_ms: 1000,
  is_enabled: true,
  point_count: 0,
  live_point_limit: 0,
  runtime: {
    state: 'online',
    point_count: 0,
    error_category: null,
    error_detail: null,
    leader_instance: null,
    updated_at: null,
  },
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
}

function button(wrapper: ReturnType<typeof mount>, text: string) {
  const found = wrapper
    .findAll('button')
    .find((one) => one.text() === text || one.attributes('aria-label') === text)
  if (found === undefined) throw new Error(`没有按钮 ${text}`)
  return found
}

it('连通性测试在跑时只有它转圈，断开按钮只是暂不可点', () => {
  const wrapper = mount(SourceDetailHeader, {
    props: { source: SOURCE, busy: 'test', refreshing: false },
  })
  expect(button(wrapper, '连通性测试').attributes('aria-busy')).toBe('true')
  expect(button(wrapper, '断开').attributes('aria-busy')).toBeUndefined()
  expect(button(wrapper, '断开').attributes('disabled')).toBeDefined()
})

it('删除数据源按钮用危险色', () => {
  const wrapper = mount(SourceDetailHeader, {
    props: { source: SOURCE, busy: null, refreshing: false },
  })
  const remove = wrapper
    .findAllComponents(DtButton)
    .find((one) => one.attributes('aria-label') === '删除')
  expect(remove?.props('intent')).toBe('danger')
})
