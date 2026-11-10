/** @fileoverview 训练历史：已发布的那次不再给「发布版本」，不论版本列表翻没翻到它。 */
import type { ModelingRunSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'

import InstanceHistory from '@/pages/Modeling/Instance/components/InstanceHistory.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
}))

const STAMP = '2026-10-27T00:00:00.000Z'

function run(over: Partial<ModelingRunSummary> = {}): ModelingRunSummary {
  return {
    id: 'r1',
    pipeline_id: 'i1',
    status: 'succeeded',
    trigger: 'manual',
    started_at: STAMP,
    finished_at: STAMP,
    duration_ms: 10,
    row_count: 1,
    is_source_truncated: false,
    is_keeping_frames: false,
    error_text: null,
    created_by_name: null,
    created_at: STAMP,
    ...over,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  const permissions = [
    PERMISSION_CODES.modelingView,
    PERMISSION_CODES.modelingPublish,
  ]
  auth.user = {
    username: 'u',
    permissions,
    role_permissions: permissions,
    direct_permissions: [],
    role: { name: 'r', description: '' },
  } as never
  auth.accessToken = 'token'
})

function publishButtons(runs: ModelingRunSummary[]) {
  const wrapper = mount(InstanceHistory, {
    props: {
      id: 'i1',
      runs,
      versions: [],
      totals: { runs: runs.length, versions: 30 },
      busy: false,
    },
  })
  return wrapper.findAll('button').filter((b) => b.text() === '发布版本')
}

it('运行记录上带着已发布版本时不再给发布', () => {
  expect(publishButtons([run({ published_version_id: 'v-old' })])).toHaveLength(
    0,
  )
})

it('还没发布的成功运行照常给发布', () => {
  expect(publishButtons([run({ published_version_id: null })])).toHaveLength(1)
})
