/**
 * @fileoverview 运行态页必须**自己**装配模块与取数：直连 `/dashboards/:id` 时
 * 没有别的页面替它注册过任何东西。注册表清空后挂载，模块要照常渲染，
 * 且实时与历史两种 provider 都要在场——装配缺失时这两条必红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import {
  __resetConfigControls,
  __resetModules,
  SHOW_TITLE_CONFIG_KEY,
} from '@dt/modules'
import { __resetProviders, listProviders } from '@dt/datasources'
import type { DashboardPayload } from '@dt/contracts'

import { __resetDashboardBootstrap } from '@/bootstrap/dashboard'
import DashboardView from '@/pages/DashboardView/index.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { dashboardId: 'd-1' },
    path: '/dashboards/d-1',
  }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

// ⚠ 通道必须打桩：不桩的话挂载页面就真的开一条 WebSocket
vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    subscribe: vi.fn(() => () => undefined),
    onSystem: vi.fn(() => () => undefined),
  }),
}))

const PAYLOAD: DashboardPayload = {
  id: 'd-1',
  projectId: 'p-1',
  name: '运行屏',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  themeJson: {},
  chromeJson: {},
  rowVersion: 1,
  schemaVersion: 1,
  isPublic: false,
  publicToken: null,
  createdAt: '2026-08-14T00:00:00Z',
  updatedAt: '2026-08-14T00:00:00Z',
  nodes: [
    {
      id: 'n-1',
      dashboardId: 'd-1',
      parentId: null,
      clientKey: null,
      moduleType: 'header',
      x: 0,
      y: 0,
      w: 1920,
      h: 96,
      zIndex: 0,
      isVisible: true,
      configJson: { title: '运行大屏', [SHOW_TITLE_CONFIG_KEY]: true },
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-14T00:00:00Z',
      bindings: [],
    },
  ],
}

vi.mock('@/composables/useDashboardDoc', () => ({
  useDashboardDoc: () => ({
    dashboard: shallowRef(PAYLOAD),
    loading: ref(false),
    saving: ref(false),
    error: ref<string | null>(null),
    conflict: ref<string | null>(null),
    load: vi.fn(() => Promise.resolve(PAYLOAD)),
    save: vi.fn(),
    dispose: vi.fn(),
  }),
}))

beforeEach(() => {
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('自装配', () => {
  it('注册表清空后挂载，模块照常渲染而不是「未知模块」占位', async () => {
    const wrapper = mount(DashboardView)
    await flushPromises()

    await vi.waitFor(() => expect(wrapper.text()).toContain('运行大屏'))
    expect(wrapper.text()).not.toContain('未知')
    wrapper.unmount()
  })

  it('实时与历史 provider 都在场——archive 绑定不再一律拒绝取数', async () => {
    const wrapper = mount(DashboardView)
    await flushPromises()

    const kinds = listProviders().map((provider) => provider.kind)
    expect(kinds).toContain('opcua')
    expect(kinds).toContain('archive')
    expect(kinds).toContain('static')
    expect(kinds).toContain('computed')
    wrapper.unmount()
  })
})
