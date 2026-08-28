/**
 * @fileoverview 公开页必须**自己**装配模块与取数：直连它时没有别的页面替它注册
 * 过任何东西。这里还守三条只在公开面成立的口径——取数走公开票据换来的**别名**
 * 主题（真主题不出门，ADR-0014/0021）、右下角那条状态必须说实话，以及通道断了
 * 之后屏上每一格都要把「数据可能过期」标出来。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { __resetConfigControls, __resetModules } from '@dt/modules'
import { __resetProviders, listProviders } from '@dt/datasources'
import type {
  DashboardNodeView,
  ModuleConnectionState,
  PublicDashboardPayload,
} from '@dt/contracts'

import { __resetDashboardBootstrap } from '@/bootstrap/dashboard'
import PublicDashboard from '@/pages/PublicDashboard/index.vue'

const TOKEN = 'tok-1'

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { publicToken: TOKEN },
    path: `/public/${TOKEN}`,
  }),
  useRouter: () => ({ push: vi.fn() }),
}))

// ⚠ 桩照真通道那样只留一份判定：`isConnected` 从连接态派生，不许各写各的——
// 两份能各说各话的桩，能造出真通道造不出的状态组合
const connectionState = ref<ModuleConnectionState>('open')
const isConnected = computed(() => connectionState.value === 'open')
const isRejected = ref(false)
// ⚠ 显式给出签名：不带类型的 `vi.fn()` 记不下入参，`calls[0][0]` 取不到主题
const subscribe = vi.fn<
  (
    topic: string,
    handler: (payload: Record<string, unknown>) => void,
  ) => () => void
>(() => () => undefined)
const closeChannel = vi.fn()

/** 一条桩通道；两个入口给的是同一条，跟真实现一样。 */
function channel() {
  return { isConnected, connectionState, isRejected, subscribe }
}

vi.mock('@/composables/useRealtimeChannel', () => ({
  usePublicRealtimeChannel: () => channel(),
  useRealtimeChannel: () => channel(),
  closeRealtimeChannel: () => {
    closeChannel()
  },
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

const HEADER: DashboardNodeView = {
  id: 'n-1',
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
  bindings: [],
}

/** 一块挂了实时绑定的文字。绑定槽名不参与断言，取数只看来源与点位身份。 */
const LIVE_TEXT: DashboardNodeView = {
  ...HEADER,
  id: 'n-2',
  moduleType: 'text-block',
  configJson: { text: '实时' },
  bindings: [
    {
      id: 'b-1',
      fieldKey: 'text',
      sourceKind: 'opcua',
      nodeKey: 'ns=2;s=Temp',
      staticValueJson: null,
      computeJson: null,
      detailJson: null,
      transformJson: null,
    },
  ],
}

function payload(
  nodes: DashboardNodeView[] = [HEADER],
): PublicDashboardPayload {
  return {
    name: '公开屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    schemaVersion: 1,
    themeJson: {},
    chromeJson: {},
    updatedAt: '2026-08-14T10:00:00Z',
    nodes,
  }
}

beforeEach(() => {
  // 模拟「直连本路由」：全局注册表一片空白，页面不自装就什么都画不出
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
  connectionState.value = 'open'
  isRejected.value = false
  subscribe.mockClear()
  closeChannel.mockClear()
  getPublicDashboard.mockReset()
  getPublicDashboard.mockResolvedValue(payload())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('自装配', () => {
  it('注册表清空后挂载，模块照常渲染而不是「未知模块」占位', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    // 模块渲染组件是真实的动态 import，微任务冲不平，等它落地
    await vi.waitFor(() =>
      expect(wrapper.find('.dt-header').exists()).toBe(true),
    )
    expect(wrapper.text()).not.toContain('未知')
    wrapper.unmount()
  })

  it('装上实时取数——公开页现在也吃 WS 推来的值（ADR-0021）', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    const kinds = listProviders().map((provider) => provider.kind)
    expect(kinds).toContain('opcua')
    expect(kinds).toContain('static')
    expect(kinds).toContain('computed')
    wrapper.unmount()
  })

  it('仍不装历史取数：公开面没有历史端点，假曲线比没有曲线更糟', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    expect(listProviders().map((item) => item.kind)).not.toContain('archive')
    wrapper.unmount()
  })
})

describe('订阅', () => {
  it('订的是公开令牌换来的别名，不是大屏主题', async () => {
    getPublicDashboard.mockResolvedValue(payload([HEADER, LIVE_TEXT]))
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled())
    const topic = subscribe.mock.calls[0]?.[0]
    // ⚠ 真主题（dashboard:{id}）一个字都不出门：公开面拿不到大屏 id
    expect(topic).toBe(`public:${TOKEN}`)
    expect(String(topic)).not.toContain('dashboard:')
    wrapper.unmount()
  })

  it('一条实时绑定都没有时不订任何主题', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    expect(subscribe).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('离开这一页把通道连同票据一起收掉', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    wrapper.unmount()

    // 不收的话回到登录态之后，下一次握手仍会报公开那条子协议，一律被拒
    expect(closeChannel).toHaveBeenCalled()
  })
})

describe('状态角标', () => {
  it('没有实时绑定就说静态快照与数据截止（ADR-0014 四）', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    const status = wrapper.get('[data-test="public-status"]').text()
    expect(status).toContain('静态快照')
    expect(status).toContain('数据截止')
    wrapper.unmount()
  })

  it('有实时绑定且通道连着才说实时', async () => {
    getPublicDashboard.mockResolvedValue(payload([HEADER, LIVE_TEXT]))
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    expect(wrapper.get('[data-test="public-status"]').text()).toBe('实时数据')
    wrapper.unmount()
  })

  it('通道没连上时不许说实时——那是一张停住的屏', async () => {
    getPublicDashboard.mockResolvedValue(payload([HEADER, LIVE_TEXT]))
    connectionState.value = 'closed'
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    expect(wrapper.get('[data-test="public-status"]').text()).toContain(
      '静态快照',
    )
    wrapper.unmount()
  })
})

describe('联动', () => {
  it('公开页也跑本屏联动：点一下开出节点弹窗', async () => {
    // ⚠ 公开页以前连显隐与弹窗都不跑（整段 interactions 不下发）。现在规则照常
    // 下发，引擎也装上了（ADR-0021）
    const clickable: DashboardNodeView = {
      ...HEADER,
      id: 'n-3',
      moduleType: 'text-block',
      configJson: { text: '看明细' },
    }
    const panel: DashboardNodeView = {
      ...HEADER,
      id: 'n-4',
      moduleType: 'header',
      configJson: {},
    }
    getPublicDashboard.mockResolvedValue({
      ...payload([clickable, panel]),
      chromeJson: {
        interactions: [
          {
            id: 'r-1',
            source: { nodeId: 'n-3', event: 'click' },
            action: { type: 'openModal', target: 'n-4', title: '明细' },
          },
        ],
      },
    })
    const wrapper = mount(PublicDashboard)
    await flushPromises()
    await vi.waitFor(() =>
      expect(wrapper.find('.dt-module--clickable').exists()).toBe(true),
    )

    await wrapper.find('.dt-module--clickable').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('明细')
    wrapper.unmount()
  })
})

describe('通道断了的角标', () => {
  it('有实时绑定时，断够久就报出来', async () => {
    vi.useFakeTimers()
    getPublicDashboard.mockResolvedValue(payload([HEADER, LIVE_TEXT]))
    connectionState.value = 'closed'
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    await vi.advanceTimersByTimeAsync(4000)

    expect(wrapper.find('[data-test="realtime-offline"]').exists()).toBe(true)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('⚠ 一张纯静态的屏不报——那是一件与画面无关的事', async () => {
    vi.useFakeTimers()
    connectionState.value = 'closed'
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    await vi.advanceTimersByTimeAsync(4000)

    expect(wrapper.find('[data-test="realtime-offline"]').exists()).toBe(false)
    wrapper.unmount()
    vi.useRealTimers()
  })
})

describe('撤回', () => {
  it('通道被拒时回头再问一次这张屏还公开吗', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()
    expect(getPublicDashboard).toHaveBeenCalledTimes(1)

    // hub 在链接被撤回后会断掉已经连着的匿名连接；页面只闷头重连的话，
    // 看的人会以为只是网断了
    isRejected.value = true
    await flushPromises()

    expect(getPublicDashboard).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('撤回之后落到错误态，而不是把停住的画面继续摆着', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()
    getPublicDashboard.mockRejectedValue(new Error('公开链接无效或已被撤回'))

    isRejected.value = true
    await flushPromises()

    expect(wrapper.find('[data-test="public-stage"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('加载失败')
    wrapper.unmount()
  })
})

describe('通道断了：屏上的值标成可能过期', () => {
  /** 推一帧真读数进来，让屏上确实挂着一个通道推来的值。 */
  function pushSample(): void {
    const handler = subscribe.mock.calls[0]?.[1]
    handler?.({
      items: [
        {
          nodeKey: 'ns=2;s=Temp',
          state: 'ok',
          value: 42,
          timestampMs: 1_700_000_000_000,
          quality: 'good',
        },
      ],
    })
  }

  it('断了以后旧值照常显示，另挂一枚角标', async () => {
    getPublicDashboard.mockResolvedValue(payload([HEADER, LIVE_TEXT]))
    const wrapper = mount(PublicDashboard)
    await flushPromises()
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled())
    pushSample()
    await flushPromises()
    expect(wrapper.find('.dt-module-status--badge').exists()).toBe(false)

    connectionState.value = 'reconnecting'
    await flushPromises()

    expect(wrapper.get('.dt-module-status--badge').text()).toBe('数据可能过期')
    // 整格没被盖住，模块照常在画自己的内容——「可能过期」不是「没有数据」
    expect(wrapper.find('.dt-module-status--cover').exists()).toBe(false)
    expect(wrapper.findAll('.dt-module')).toHaveLength(2)
    wrapper.unmount()
  })

  it('⚠ 纯静态的一格不标：常量不会因为通道断了就过期', async () => {
    getPublicDashboard.mockResolvedValue(payload([HEADER]))
    connectionState.value = 'closed'
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    expect(wrapper.find('.dt-module-status--badge').exists()).toBe(false)
    wrapper.unmount()
  })
})
