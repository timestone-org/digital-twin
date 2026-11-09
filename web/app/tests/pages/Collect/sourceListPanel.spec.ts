/** @fileoverview 数据源列表头上的计数与分页器说的是同一个总数。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import type { CollectSource } from '@dt/contracts'
import { DtTag } from '@dt/ui'
import SourceListPanel from '@/pages/Collect/components/SourceListPanel.vue'

enableAutoUnmount(afterEach)
beforeEach(() => setActivePinia(createPinia()))

function source(index: number): CollectSource {
  return {
    id: `s${index}`,
    name: `源 ${index}`,
    code: `src_${index}`,
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
}

it('计数徽标给总数，不是本页条数', () => {
  const wrapper = mount(SourceListPanel, {
    props: {
      protocol: 'opcua',
      sources: Array.from({ length: 100 }, (_, index) => source(index)),
      total: 230,
      size: 100,
      page: 1,
      loading: false,
      error: null,
      activeId: null,
    },
  })
  expect(wrapper.findAllComponents(DtTag)[0]?.text()).toBe('230')
})
