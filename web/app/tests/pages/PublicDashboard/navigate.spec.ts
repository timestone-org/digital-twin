/**
 * @fileoverview 契约：公开态的跨屏跳转句柄就是**目标屏的公开令牌**——服务端
 * 已经把大屏 id 改写掉了（ADR-0021），这一页只负责拼公开路由。
 * ⚠ 自跳同样挡在宿主里：`router.push` 到同一路由既不重载也不报错，
 * 表现正好是这套里最不想要的那种「点了没反应」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { __resetConfigControls, __resetModules } from '@dt/modules'
import { __resetProviders } from '@dt/datasources'
import type { PublicDashboardPayload } from '@dt/contracts'

import { __resetDashboardBootstrap } from '@/bootstrap/dashboard'
import PublicDashboard from '@/pages/PublicDashboard/index.vue'

const TOKEN = 'tok-self'
const push = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { publicToken: TOKEN },
    path: `/public/${TOKEN}`,
  }),
  useRouter: () => ({ push }),
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

// ⚠ 显式给出签名：`vi.fn()` 不带类型时返回 any，转手一层就成了 unsafe return
const getPublicDashboard =
  vi.fn<
    (token: string, signal?: AbortSignal) => Promise<PublicDashboardPayload>
  >()

vi.mock('@/api/dashboardShare', () => ({
  getPublicDashboard: (token: string, signal?: AbortSignal) =>
    getPublicDashboard(token, signal),
}))

/** 一张只摆了一块可点文字的公开屏，文字上挂一条跳转规则。 */
function payloadJumpingTo(target: string): PublicDashboardPayload {
  return {
    name: '总览屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    schemaVersion: 1,
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
        configJson: { text: '进能耗屏' },
        bindings: [],
      },
    ],
  }
}

beforeEach(() => {
  push.mockClear()
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
})

/** 挂上页面并点那块可点的模块。 */
async function clickTheModule(target: string) {
  getPublicDashboard.mockResolvedValue(payloadJumpingTo(target))
  const wrapper = mount(PublicDashboard)
  await flushPromises()
  await vi.waitFor(() =>
    expect(wrapper.find('.dt-module--clickable').exists()).toBe(true),
  )
  await wrapper.find('.dt-module--clickable').trigger('click')
  return wrapper
}

describe('公开态跨屏跳转', () => {
  it('点配了跳转规则的模块，跳到目标屏的公开路由', async () => {
    const wrapper = await clickTheModule('tok-other')

    expect(push).toHaveBeenCalledWith({
      name: 'public-dashboard',
      params: { publicToken: 'tok-other' },
    })
    wrapper.unmount()
  })

  it('目标就是当前这张屏时一次都不跳', async () => {
    const wrapper = await clickTheModule(TOKEN)

    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('跳不到的规则服务端压根不下发，这里不必再判一次', async () => {
    // 目标是空串（服务端只会在改写不出令牌时整条丢掉，不会留空目标），
    // 引擎照旧把空句柄当成「还没挑目标」——不叫宿主，也就不会跳去 404
    const wrapper = await clickTheModule('')

    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
