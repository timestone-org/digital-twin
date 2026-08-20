/**
 * @fileoverview 契约：跨屏跳转的「怎么跳」只有宿主页面这一份实现——
 * 联动引擎只算出目标句柄，路由由这一页拼；跳到当前这张屏一律不跳。
 * ⚠ 自跳不挡的话，`router.push` 到同一路由既不重载也不报错，
 * 表现正好是这套里最不想要的那种「点了没反应」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { __resetConfigControls, __resetModules } from '@dt/modules'
import { __resetProviders } from '@dt/datasources'
import type { DashboardPayload } from '@dt/contracts'

import { __resetDashboardBootstrap } from '@/bootstrap/dashboard'
import DashboardView from '@/pages/DashboardView/index.vue'

const push = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { dashboardId: 'd-1' }, path: '/dashboards/d-1' }),
  useRouter: () => ({ push, back: vi.fn() }),
}))

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    isConnected: ref(true),
    subscribe: vi.fn(() => () => undefined),
    onSystem: vi.fn(() => () => undefined),
  }),
}))

const dashboard = shallowRef<DashboardPayload | null>(null)

vi.mock('@/composables/useDashboardDoc', () => ({
  useDashboardDoc: () => ({
    dashboard,
    loading: ref(false),
    saving: ref(false),
    error: ref<string | null>(null),
    conflict: ref<string | null>(null),
    load: vi.fn(() => Promise.resolve(dashboard.value)),
    save: vi.fn(),
    dispose: vi.fn(),
  }),
}))

/** 一张只摆了一块可点文字的屏，文字上挂一条跳转规则。 */
function payloadJumpingTo(target: string): DashboardPayload {
  return {
    id: 'd-1',
    projectId: 'p-1',
    name: '总览屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {
      interactions: [
        {
          id: 'r-1',
          source: { nodeId: 'n-1', event: 'click' },
          action: { type: 'navigate', target },
        },
      ],
    },
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '2026-08-18T00:00:00Z',
    updatedAt: '2026-08-18T00:00:00Z',
    nodes: [
      {
        id: 'n-1',
        dashboardId: 'd-1',
        parentId: null,
        clientKey: null,
        moduleType: 'text-block',
        x: 0,
        y: 0,
        w: 400,
        h: 80,
        zIndex: 0,
        isVisible: true,
        configJson: { text: '进能耗屏' },
        createdAt: '2026-08-18T00:00:00Z',
        updatedAt: '2026-08-18T00:00:00Z',
        bindings: [],
      },
    ],
  }
}

beforeEach(() => {
  push.mockClear()
  dashboard.value = null
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
})

/** 挂上页面并点那块可点的模块。 */
async function clickTheModule(target: string) {
  dashboard.value = payloadJumpingTo(target)
  const wrapper = mount(DashboardView)
  await flushPromises()
  await vi.waitFor(() =>
    expect(wrapper.find('.dt-module--clickable').exists()).toBe(true),
  )
  await wrapper.find('.dt-module--clickable').trigger('click')
  return wrapper
}

describe('跨屏跳转', () => {
  it('点配了跳转规则的模块，跳到目标大屏的运行态路由', async () => {
    const wrapper = await clickTheModule('d-2')

    expect(push).toHaveBeenCalledWith({
      name: 'dashboard-view',
      params: { dashboardId: 'd-2' },
    })
    wrapper.unmount()
  })

  it('目标就是当前这张屏时一次都不跳', async () => {
    const wrapper = await clickTheModule('d-1')

    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
