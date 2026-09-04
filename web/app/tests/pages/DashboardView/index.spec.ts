/**
 * @fileoverview 运行态页必须**自己**装配模块与取数：直连 `/dashboards/:id` 时
 * 没有别的页面替它注册过任何东西。注册表清空后挂载，模块要照常渲染，
 * 且实时与历史两种 provider 都要在场——装配缺失时这两条必红。
 * ⚠ 序列那一份还要带上刷新节拍：只在绑定变化时取一次的话，挂一天的大屏曲线
 * 会停在打开那一刻，而它与「设备停了」长得一模一样。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref, shallowRef } from 'vue'
import { __resetConfigControls, __resetModules } from '@dt/modules'
import { __resetProviders, listProviders } from '@dt/datasources'
import type { DashboardPayload, ModuleConnectionState } from '@dt/contracts'

import type * as DashboardBootstrap from '@/bootstrap/dashboard'
import {
  __resetDashboardBootstrap,
  installDashboardSeries,
} from '@/bootstrap/dashboard'
import { OFFLINE_GRACE_MS } from '@/composables/useRealtimeOffline'
import DashboardView from '@/pages/DashboardView/index.vue'

// ⚠ 只把装配那一支换成间谍、其余原样：这一页要验的是它**怎么装**，
// 而装出来的东西还得是真的
vi.mock('@/bootstrap/dashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof DashboardBootstrap>()
  return {
    ...actual,
    installDashboardSeries: vi.fn(actual.installDashboardSeries),
  }
})

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { dashboardId: 'd-1' },
    path: '/dashboards/d-1',
  }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

// ⚠ 通道必须打桩：不桩的话挂载页面就真的开一条 WebSocket。
// ⚠ 桩也照真通道那样只留一份判定：`isConnected` 从连接态派生，不许各写各的——
// 两份能各说各话的桩，能造出真通道造不出的状态组合
const connectionState = ref<ModuleConnectionState>('open')
const isConnected = computed(() => connectionState.value === 'open')
vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    isConnected,
    connectionState,
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
      configJson: {},
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
  connectionState.value = 'open'
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
  vi.mocked(installDashboardSeries).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('自装配', () => {
  it('注册表清空后挂载，模块照常渲染而不是「未知模块」占位', async () => {
    const wrapper = mount(DashboardView)
    await flushPromises()

    await vi.waitFor(() =>
      expect(wrapper.find('.dt-header').exists()).toBe(true),
    )
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

describe('序列取数与刷新节拍', () => {
  it('台账 provider 也在场——dataset 绑定不再是「这一种没登记过」', async () => {
    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(listProviders().map((provider) => provider.kind)).toContain(
      'dataset',
    )
    wrapper.unmount()
  })

  it('装序列取数时把快照读取器、连接态与节拍一起带上', async () => {
    const wrapper = mount(DashboardView)
    await flushPromises()

    const ports = vi.mocked(installDashboardSeries).mock.calls[0]?.[0]
    expect(ports?.readPoint).toBeTypeOf('function')
    expect(ports?.connectionState?.()).toBe('open')
    expect(ports?.seriesEpoch).toBeTypeOf('function')
    wrapper.unmount()
  })
})

describe('通道断了要说出来', () => {
  // ⚠ 这一页是挂在墙上的：数值停住而屏上一切如常，是这套系统最危险的失效。
  // 靠制作者记得摆一个 connection-status 模块，等于把它交给最容易忘的一环
  it('连着的时候不画任何角标', async () => {
    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.find('[data-test="realtime-offline"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('断够宽限期后角标出现，且说的是后果不是协议名', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(DashboardView)
      await flushPromises()

      connectionState.value = 'closed'
      await vi.advanceTimersByTimeAsync(OFFLINE_GRACE_MS)
      await flushPromises()

      const badge = wrapper.find('[data-test="realtime-offline"]')
      expect(badge.exists()).toBe(true)
      expect(badge.text()).toContain('数值停在断开前')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
