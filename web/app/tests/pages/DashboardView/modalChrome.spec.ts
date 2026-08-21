/**
 * @fileoverview 契约：联动弹窗与主舞台吃**同一份**大屏级卡片外观缺省——
 * 弹窗自起一棵 NodeTree，不透传的话弹窗里的模块整体落回平台默认，
 * 同一个模块在屏上和弹窗里长两个样。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { __resetConfigControls, __resetModules } from '@dt/modules'
import { __resetProviders } from '@dt/datasources'
import { NodeModal, NodeTree } from '@dt/runtime'
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
    subscribe: vi.fn(() => () => undefined),
    onSystem: vi.fn(() => () => undefined),
  }),
}))

const CARD = { titleColor: '#123456', corners: false }

/** 一块可点文字挂 openModal 规则，弹出的内容是另一块文字。 */
const PAYLOAD: DashboardPayload = {
  id: 'd-1',
  projectId: 'p-1',
  name: '总览屏',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  themeJson: {},
  chromeJson: {
    card: CARD,
    interactions: [
      {
        id: 'r-1',
        source: { nodeId: 'n-1', event: 'click' },
        action: { type: 'openModal', target: 'n-2' },
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
      configJson: { text: '看明细' },
      createdAt: '2026-08-18T00:00:00Z',
      updatedAt: '2026-08-18T00:00:00Z',
      bindings: [],
    },
    {
      id: 'n-2',
      dashboardId: 'd-1',
      parentId: null,
      clientKey: null,
      moduleType: 'text-block',
      x: 0,
      y: 200,
      w: 600,
      h: 400,
      zIndex: 1,
      isVisible: false,
      configJson: { text: '明细内容' },
      createdAt: '2026-08-18T00:00:00Z',
      updatedAt: '2026-08-18T00:00:00Z',
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

async function openTheModal() {
  const wrapper = mount(DashboardView)
  await flushPromises()
  await vi.waitFor(() =>
    expect(wrapper.find('.dt-module--clickable').exists()).toBe(true),
  )
  await wrapper.find('.dt-module--clickable').trigger('click')
  await vi.waitFor(() =>
    expect(wrapper.findComponent(NodeModal).exists()).toBe(true),
  )
  return wrapper
}

describe('弹窗吃大屏级外观缺省', () => {
  it('NodeModal 拿到的 cardChrome 与主 NodeTree 是同一份合成值', async () => {
    const wrapper = await openTheModal()

    const mainTree = wrapper.findAllComponents(NodeTree)[0]
    const modal = wrapper.getComponent(NodeModal)
    expect(modal.props('cardChrome')).toEqual(CARD)
    expect(modal.props('cardChrome')).toEqual(mainTree?.props('cardChrome'))
    wrapper.unmount()
  })
})
