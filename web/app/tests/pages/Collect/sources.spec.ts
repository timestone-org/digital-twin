/**
 * @fileoverview 采集数据源列表页的行为契约。
 *
 * ⚠ 这一页最要紧的不是渲染对不对，而是三条口径：
 * 1. 「配置启用」与「此刻真在采」是两件事，不许合成一个状态灯。
 * 2. 连通性测试连不上时也是成功返回，结论在 `is_reachable` 里——把它当成
 *    「测试成功」会让人以为设备是通的。
 * 3. 删除前的确认文案要说清「点位不级联删」，否则用户会以为删源就干净了。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { CollectSource, CollectSourceRuntime } from '@dt/contracts'

import * as collectApi from '@/api/collect'
import CollectSourcesPage from '@/pages/Collect/OpcuaSources/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/collect/opcua', query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

interface ConfirmAsk {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}
const confirmSpy = vi.fn<(request: ConfirmAsk) => Promise<boolean>>()
const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  }
})

function runtime(over: Partial<CollectSourceRuntime> = {}): CollectSourceRuntime {
  return {
    state: 'online',
    point_count: 3,
    error_category: null,
    error_detail: null,
    leader_instance: 'collector-1',
    updated_at: '2026-08-16T02:00:00.000Z',
    ...over,
  }
}

function source(over: Partial<CollectSource> = {}): CollectSource {
  return {
    id: 's1',
    name: '一号车间 PLC',
    code: 'plant1',
    protocol: 'opcua',
    endpoint: 'opc.tcp://10.0.0.2:4840',
    has_credential: false,
    options_json: {},
    read_mode: 'subscribe',
    poll_interval_ms: 1000,
    is_enabled: true,
    point_count: 3,
    live_point_limit: 1000,
    runtime: runtime(),
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function signIn(permissions: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    role: { name: 'admin' },
    role_permissions: permissions,
    direct_permissions: [],
    permissions,
  } as never
  auth.accessToken = 'token'
}

async function render(rows: CollectSource[]): Promise<VueWrapper> {
  vi.spyOn(collectApi, 'listSources').mockResolvedValue({
    items: rows,
    page: 1,
    size: 20,
    total: rows.length,
  })
  const wrapper = mount(CollectSourcesPage, {
    global: {
      stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

function clickByText(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('button').find((one) => one.text() === label)
  return button === undefined
    ? Promise.reject(new Error(`没有按钮「${label}」`))
    : button.trigger('click').then(() => undefined)
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  confirmSpy.mockReset().mockResolvedValue(true)
  toastError.mockReset()
  toastSuccess.mockReset()
  signIn(['collect:view', 'collect:operate', 'collect:manage'])
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('列表', () => {
  it('列出名称、编码与端点', async () => {
    const text = (await render([source()])).text()
    expect(text).toContain('一号车间 PLC')
    expect(text).toContain('plant1')
    expect(text).toContain('opc.tcp://10.0.0.2:4840')
  })

  it('采集中与已断开分别成一档', async () => {
    expect((await render([source()])).text()).toContain('采集中')
    const offline = await render([
      source({ runtime: runtime({ state: 'offline' }) }),
    ])
    expect(offline.text()).toContain('已断开')
  })

  it('⚠ 未接管与已断开不是一档——前者去查采集器，后者去查现场', async () => {
    const text = (
      await render([source({ runtime: runtime({ state: 'unknown' }) })])
    ).text()
    expect(text).toContain('未接管')
    expect(text).not.toContain('已断开')
  })

  it('⚠ 停用与断开各标各的：停用是我们自己关的', async () => {
    const text = (
      await render([
        source({ is_enabled: false, runtime: runtime({ state: 'unknown' }) }),
      ])
    ).text()
    expect(text).toContain('已停用')
  })

  it('配了点位却没在采时，页顶给一条汇总提醒', async () => {
    const text = (
      await render([source({ runtime: runtime({ state: 'offline' }) })])
    ).text()
    expect(text).toContain('不在采集')
  })

  it('都在采时不出那条提醒', async () => {
    expect((await render([source()])).text()).not.toContain('不在采集')
  })

  it('⚠ 配了 10 个只订上 8 个时，差额要写在界面上', async () => {
    const text = (
      await render([
        source({ point_count: 10, runtime: runtime({ point_count: 8 }) }),
      ])
    ).text()
    expect(text).toContain('2 个没订上')
  })

  it('空列表给条目数而不是空白', async () => {
    expect((await render([])).text()).toContain('共 0 个数据源')
  })
})

describe('连通性测试', () => {
  it('连得上时报成功', async () => {
    vi.spyOn(collectApi, 'testSource').mockResolvedValue({
      source_id: 's1',
      is_reachable: true,
      detail: null,
    })
    const wrapper = await render([source()])
    await clickByText(wrapper, '测试')
    await flushPromises()
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('⚠ 连不上也是 200——必须按结论报错，不能当成测试成功', async () => {
    vi.spyOn(collectApi, 'testSource').mockResolvedValue({
      source_id: 's1',
      is_reachable: false,
      detail: '端点无响应',
    })
    const wrapper = await render([source()])
    await clickByText(wrapper, '测试')
    await flushPromises()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('端点无响应')
  })
})

describe('删除', () => {
  it('⚠ 下面还有点位时，确认文案要说清点位不级联删', async () => {
    vi.spyOn(collectApi, 'deleteSource').mockResolvedValue()
    const wrapper = await render([source({ point_count: 12 })])
    await clickByText(wrapper, '删除')
    await flushPromises()
    const asked = confirmSpy.mock.calls[0]?.[0]
    expect(asked?.message).toContain('12')
    expect(asked?.message).toContain('先把点位删干净')
  })

  it('取消确认时什么都不做', async () => {
    confirmSpy.mockResolvedValue(false)
    const remove = vi.spyOn(collectApi, 'deleteSource').mockResolvedValue()
    const wrapper = await render([source()])
    await clickByText(wrapper, '删除')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('权限', () => {
  it('只读账号看不到写入口', async () => {
    signIn(['collect:view'])
    const wrapper = await render([source()])
    const labels = wrapper.findAll('button').map((one) => one.text())
    expect(labels).not.toContain('删除')
    expect(labels).not.toContain('新建数据源')
  })

  it('⚠ 触碰设备的动作单包 operate 码，不跟着 manage 一起放行', async () => {
    signIn(['collect:view', 'collect:manage'])
    const wrapper = await render([source()])
    const labels = wrapper.findAll('button').map((one) => one.text())
    expect(labels).toContain('编辑')
    expect(labels).not.toContain('测试')
  })
})

describe('运行态刷新', () => {
  it('⚠ 卸载后不再打接口——不清定时器就是在更新一个已经不在的页面', async () => {
    const wrapper = await render([source()])
    const list = vi.mocked(collectApi.listSources)
    const before = list.mock.calls.length
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(list.mock.calls.length).toBe(before)
  })
})
