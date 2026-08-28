/**
 * @fileoverview 契约：公开态的联动弹窗同样吃大屏级卡片外观缺省——
 * 弹窗与主舞台是同一份合成值，不透传就是「屏上一个样、弹窗一个样」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { __resetConfigControls, __resetModules } from '@dt/modules'
import { __resetProviders } from '@dt/datasources'
import { NodeModal, NodeTree } from '@dt/runtime'
import type { PublicDashboardPayload } from '@dt/contracts'

import { __resetDashboardBootstrap } from '@/bootstrap/dashboard'
import PublicDashboard from '@/pages/PublicDashboard/index.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { publicToken: 'tok-1' },
    path: '/public/tok-1',
  }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/composables/useRealtimeChannel', () => ({
  usePublicRealtimeChannel: () => ({
    isConnected: ref(true),
    connectionState: ref('open'),
    isRejected: ref(false),
    subscribe: vi.fn(() => () => undefined),
  }),
  useRealtimeChannel: () => ({
    isConnected: ref(true),
    connectionState: ref('open'),
    isRejected: ref(false),
    subscribe: vi.fn(() => () => undefined),
  }),
  closeRealtimeChannel: vi.fn(),
}))

const CARD = { titleColor: '#123456' }

const PAYLOAD: PublicDashboardPayload = {
  name: '公开屏',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  schemaVersion: 1,
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
  updatedAt: '2026-08-18T00:00:00Z',
  nodes: [
    {
      id: 'n-1',
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
      bindings: [],
    },
    {
      id: 'n-2',
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
      bindings: [],
    },
  ],
}

const getPublicDashboard =
  vi.fn<
    (token: string, signal?: AbortSignal) => Promise<PublicDashboardPayload>
  >()

vi.mock('@/api/dashboardShare', () => ({
  getPublicDashboard: (token: string, signal?: AbortSignal) =>
    getPublicDashboard(token, signal),
}))

beforeEach(() => {
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
})

describe('公开态弹窗吃大屏级外观缺省', () => {
  it('NodeModal 拿到的 cardChrome 与主 NodeTree 是同一份合成值', async () => {
    getPublicDashboard.mockResolvedValue(PAYLOAD)
    const wrapper = mount(PublicDashboard)
    await flushPromises()
    await vi.waitFor(() =>
      expect(wrapper.find('.dt-module--clickable').exists()).toBe(true),
    )

    await wrapper.find('.dt-module--clickable').trigger('click')
    await vi.waitFor(() =>
      expect(wrapper.findComponent(NodeModal).exists()).toBe(true),
    )

    const mainTree = wrapper.findAllComponents(NodeTree)[0]
    const modal = wrapper.getComponent(NodeModal)
    expect(modal.props('cardChrome')).toEqual(CARD)
    expect(modal.props('cardChrome')).toEqual(mainTree?.props('cardChrome'))
    wrapper.unmount()
  })
})
