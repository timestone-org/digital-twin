/**
 * @fileoverview 契约：跨屏跳转时上一屏的画面留在原地，只摆一条「正在切换」，
 * 整屏的加载态只留给「手上一张都没有」的首次进入。
 * ⚠ 切屏就整屏换成加载态的话，墙上每跳一次先白一下；而**不声不响**地留着上一屏
 * 同样不行——那就成了「看起来在跑、实际停在上一张」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { __resetConfigControls, __resetModules } from '@dt/modules'
import { __resetProviders } from '@dt/datasources'
import type { DashboardPayload } from '@dt/contracts'

import { __resetDashboardBootstrap } from '@/bootstrap/dashboard'
import DashboardView from '@/pages/DashboardView/index.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { dashboardId: 'd-1' }, path: '/dashboards/d-1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    isConnected: ref(true),
    connectionState: ref('open'),
    subscribe: vi.fn(() => () => undefined),
    onSystem: vi.fn(() => () => undefined),
  }),
}))

function payload(id: string, title: string): DashboardPayload {
  return {
    id,
    projectId: 'p-1',
    name: title,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {},
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '2026-08-18T00:00:00Z',
    updatedAt: '2026-08-18T00:00:00Z',
    nodes: [
      {
        id: `n-${id}`,
        dashboardId: id,
        parentId: null,
        clientKey: null,
        moduleType: 'text-block',
        x: 0,
        y: 0,
        w: 400,
        h: 80,
        zIndex: 0,
        isVisible: true,
        configJson: { text: title },
        createdAt: '2026-08-18T00:00:00Z',
        updatedAt: '2026-08-18T00:00:00Z',
        bindings: [],
      },
    ],
  }
}

const dashboard = shallowRef<DashboardPayload | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

vi.mock('@/composables/useDashboardDoc', () => ({
  useDashboardDoc: () => ({
    dashboard,
    loading,
    saving: ref(false),
    error,
    conflict: ref<string | null>(null),
    load: vi.fn(() => Promise.resolve(dashboard.value)),
    save: vi.fn(),
    dispose: vi.fn(),
  }),
}))

beforeEach(() => {
  dashboard.value = null
  loading.value = false
  error.value = null
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
})

describe('切屏时的画面', () => {
  it('手上一张都没有时是整屏加载态', async () => {
    loading.value = true
    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.find('[data-test="dashboard-stage"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="dashboard-switching"]').exists()).toBe(
      false,
    )
    wrapper.unmount()
  })

  it('已经开着一张再去加载另一张时，上一屏还在，并且说明自己正在切换', async () => {
    dashboard.value = payload('d-1', '总览屏')
    const wrapper = mount(DashboardView)
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('总览屏'))

    loading.value = true
    await flushPromises()

    expect(wrapper.find('[data-test="dashboard-stage"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('总览屏')
    expect(wrapper.find('[data-test="dashboard-switching"]').exists()).toBe(
      true,
    )
    wrapper.unmount()
  })

  it('新的那张加载失败时回到整屏错误态，而不是继续摆着上一屏', async () => {
    dashboard.value = payload('d-1', '总览屏')
    const wrapper = mount(DashboardView)
    await flushPromises()

    // 加载失败时 docIo 会把文档置空，界面据此翻到错误态
    dashboard.value = null
    error.value = '加载失败'
    await flushPromises()

    expect(wrapper.find('[data-test="dashboard-stage"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('加载失败')
    wrapper.unmount()
  })
})
