/**
 * @fileoverview 运行态页必须**自己**装配模块与取数：直连 `/dashboards/:id` 时
 * 没有别的页面替它注册过任何东西。注册表清空后挂载，模块要照常渲染，
 * 且实时与历史两种 provider 都要在场——装配缺失时这两条必红。
 * ⚠ 序列那一份还要带上刷新节拍：只在绑定变化时取一次的话，挂一天的大屏曲线
 * 会停在打开那一刻，而它与「设备停了」长得一模一样。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { computed, ref, shallowRef } from 'vue'
import { __resetConfigControls, __resetModules } from '@dt/modules'
import { __resetProviders, listProviders } from '@dt/datasources'
import { applyTheme } from '@dt/tokens'
import type { DashboardPayload, ModuleConnectionState } from '@dt/contracts'

import type * as DashboardBootstrap from '@/bootstrap/dashboard'
import {
  __resetDashboardBootstrap,
  installDashboardSeries,
} from '@/bootstrap/dashboard'
import { OFFLINE_GRACE_MS } from '@/composables/useRealtimeOffline'
import { activateEmbed, resetEmbedContext } from '@/features/embed/context'
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

const routeDashboardId = ref('d-1')
vi.mock('vue-router', () => ({
  useRoute: () => ({
    get params() {
      return { dashboardId: routeDashboardId.value }
    },
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

const dashboard = shallowRef<DashboardPayload | null>(PAYLOAD)
vi.mock('@/composables/useDashboardDoc', () => ({
  useDashboardDoc: () => ({
    dashboard,
    loading: ref(false),
    saving: ref(false),
    error: ref<string | null>(null),
    conflict: ref<string | null>(null),
    load: vi.fn(() => Promise.resolve(PAYLOAD)),
    save: vi.fn(),
    dispose: vi.fn(),
  }),
}))

enableAutoUnmount(afterEach)

let originalRootStyle = ''

beforeEach(() => {
  originalRootStyle = document.documentElement.style.cssText
  dashboard.value = PAYLOAD
  routeDashboardId.value = 'd-1'
  resetEmbedContext()
  connectionState.value = 'open'
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
  vi.mocked(installDashboardSeries).mockClear()
})

afterEach(() => {
  document.documentElement.style.cssText = originalRootStyle
  vi.restoreAllMocks()
  resetEmbedContext()
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

describe('嵌入外壳', () => {
  it('普通运行态保留返回工作台入口，嵌入态不显示', async () => {
    const normal = mount(DashboardView)
    await flushPromises()
    expect(normal.text()).toContain('返回工作台')

    activateEmbed('emerald')
    await flushPromises()
    expect(normal.text()).not.toContain('返回工作台')
    normal.unmount()
  })
})

describe('大屏主题', () => {
  it('未单独设置时继承系统主题，并跟随系统换色', async () => {
    applyTheme(document.documentElement, 'light')
    const wrapper = mount(DashboardView, { attachTo: document.body })
    await flushPromises()
    const host = wrapper.get<HTMLElement>('.h-screen').element
    expect(host.classList.contains('text-text-primary')).toBe(true)
    host.style.color = 'var(--accent-primary)'

    expect(host.style.getPropertyValue('--accent-primary')).toBe('')
    expect(getComputedStyle(host).color).toBe('#0098c8')
    applyTheme(document.documentElement, 'emerald')
    expect(getComputedStyle(host).color).toBe('#2ee6a6')
    wrapper.unmount()
  })

  it('已保存的深色主题优先于嵌入浅色主题，且不改全局', async () => {
    activateEmbed('light')
    applyTheme(document.documentElement, 'light')
    const globalStyle = document.documentElement.style.cssText
    dashboard.value = { ...PAYLOAD, themeJson: { __base: 'dark-tech' } }
    const wrapper = mount(DashboardView, { attachTo: document.body })
    await flushPromises()
    const host = wrapper.get<HTMLElement>('.h-screen').element
    host.style.color = 'var(--accent-primary)'

    expect(getComputedStyle(host).getPropertyValue('--surface-base')).toBe(
      '#010d1e',
    )
    expect(host.style.colorScheme).toBe('dark')
    expect(document.documentElement.style.cssText).toBe(globalStyle)
    wrapper.unmount()
    expect(document.documentElement.style.cssText).toBe(globalStyle)
  })

  it('跨屏期间沿用已加载主题，新屏清除覆盖后恢复系统主题', async () => {
    applyTheme(document.documentElement, 'light')
    const globalStyle = document.documentElement.style.cssText
    dashboard.value = { ...PAYLOAD, themeJson: { __base: 'emerald' } }
    const wrapper = mount(DashboardView, { attachTo: document.body })
    await flushPromises()
    const host = wrapper.get<HTMLElement>('.h-screen').element
    host.style.color = 'var(--accent-primary)'
    expect(getComputedStyle(host).color).toBe('#2ee6a6')

    routeDashboardId.value = 'd-2'
    await flushPromises()
    expect(getComputedStyle(host).color).toBe('#2ee6a6')
    dashboard.value = { ...PAYLOAD, id: 'd-2', themeJson: {} }
    await flushPromises()

    expect(host.style.getPropertyValue('--accent-primary')).toBe('')
    expect(getComputedStyle(host).color).toBe('#0098c8')
    expect(document.documentElement.style.cssText).toBe(globalStyle)
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
