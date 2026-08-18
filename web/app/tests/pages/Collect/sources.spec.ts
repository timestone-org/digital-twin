/**
 * @fileoverview OPC UA 采集主从单页的行为契约。
 *
 * ⚠ 这一页最要紧的不是渲染对不对，而是四条口径：
 * 1. 「配置启用」与「此刻真在采」是两件事，不许合成一个状态灯。
 * 2. 「连接 / 断开」按钮改的是 `is_enabled`——本架构没有手动会话动作，
 *    采集器按计划自动收敛。
 * 3. 连通性测试连不上时也是成功返回，结论在 `is_reachable` 里。
 * 4. 删除走「引用守卫」两级弹窗：409 时给出强制删除入口并说清后果。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { CollectSource, CollectSourceRuntime } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as collectApi from '@/api/collect'
import CollectOpcuaPage from '@/pages/Collect/Opcua/index.vue'
import { useAuthStore } from '@/stores/auth'

// ⚠ 共用一份 spy 而不是每次 useRouter() 现造一个：现造的那个拿不到手，
// 「选中要写进地址栏」这条接线就没人守——而模板上的事件名写错，
// typecheck 与 lint 双双放行
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock('vue-router', () => ({
  useRouter: () => router,
  useRoute: () => ({ path: '/collect/opcua', query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  }
})

// 右栏的浏览树与点位表各有自己的 spec，这里桩掉免得整页测试被它们的请求淹没
vi.mock('@/pages/Collect/Opcua/components/BrowsePanel.vue', () => ({
  default: {
    name: 'BrowsePanel',
    props: ['source'],
    template: '<div data-test="browse-panel-stub" />',
  },
}))
vi.mock('@/pages/Collect/Opcua/components/NodeTable.vue', () => ({
  default: {
    name: 'NodeTable',
    props: ['source'],
    template: '<div data-test="node-table-stub" />',
  },
}))

function runtime(
  over: Partial<CollectSourceRuntime> = {},
): CollectSourceRuntime {
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
    description: null,
    protocol: 'opcua',
    endpoint: 'opc.tcp://10.0.0.2:4840',
    username: null,
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
    size: 100,
    total: rows.length,
  })
  const wrapper = mount(CollectOpcuaPage, {
    attachTo: document.body,
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

/** 弹窗 teleport 在 body 上，`wrapper.findAll` 看不见它。 */
function bodyButton(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (one) => one.textContent?.trim() === label,
  )
  if (found === undefined) throw new Error(`弹窗里没有按钮「${label}」`)
  return found
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  toastError.mockReset()
  toastSuccess.mockReset()
  router.replace.mockReset()
  router.push.mockReset()
  document.body.innerHTML = ''
  signIn(['collect:view', 'collect:operate', 'collect:manage'])
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('主从布局', () => {
  it('左栏列出名称与端点，右栏详情头带编码', async () => {
    const text = (await render([source()])).text()
    expect(text).toContain('一号车间 PLC')
    expect(text).toContain('plant1')
    expect(text).toContain('opc.tcp://10.0.0.2:4840')
  })

  it('默认选中第一个源，右栏直接是它的详情', async () => {
    const wrapper = await render([
      source(),
      source({ id: 's2', name: '二号车间 PLC', code: 'plant2' }),
    ])
    expect(wrapper.find('[data-test="active-source-name"]').text()).toBe(
      '一号车间 PLC',
    )
  })

  it('点左栏条目切换右栏详情', async () => {
    const wrapper = await render([
      source(),
      source({ id: 's2', name: '二号车间 PLC', code: 'plant2' }),
    ])
    const item = wrapper
      .findAll('button')
      .find((one) => one.text().includes('二号车间 PLC'))
    await item?.trigger('click')
    expect(wrapper.find('[data-test="active-source-name"]').text()).toBe(
      '二号车间 PLC',
    )
  })

  it('选中哪个源写进地址栏：刷新回得来，链接发得出去', async () => {
    const wrapper = await render([
      source(),
      source({ id: 's2', name: '二号车间 PLC', code: 'plant2' }),
    ])
    router.replace.mockClear()

    const item = wrapper
      .findAll('button')
      .find((one) => one.text().includes('二号车间 PLC'))
    await item?.trigger('click')

    expect(router.replace).toHaveBeenCalledWith({ query: { source: 's2' } })
  })

  it('空列表给引导语而不是空白', async () => {
    expect((await render([])).text()).toContain('还没有数据源')
  })

  it('描述与账户展示在详情头里', async () => {
    const text = (
      await render([
        source({ description: '车间主 PLC', username: 'operator' }),
      ])
    ).text()
    expect(text).toContain('车间主 PLC')
    expect(text).toContain('operator')
  })
})

describe('状态口径', () => {
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

  it('⚠ 配了 10 个只订上 8 个时，差额要写在界面上', async () => {
    const text = (
      await render([
        source({ point_count: 10, runtime: runtime({ point_count: 8 }) }),
      ])
    ).text()
    expect(text).toContain('2 个没订上')
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
})

describe('连接与断开（= 启停采集）', () => {
  it('已停用的源给「连接」，点下去把 is_enabled 拨成 true', async () => {
    const update = vi
      .spyOn(collectApi, 'updateSource')
      .mockResolvedValue(source({ is_enabled: true }))
    const wrapper = await render([source({ is_enabled: false })])
    await clickByText(wrapper, '连接')
    await flushPromises()
    expect(update).toHaveBeenCalledWith('s1', { is_enabled: true })
  })

  it('启用中的源给「断开」，点下去把 is_enabled 拨成 false', async () => {
    const update = vi
      .spyOn(collectApi, 'updateSource')
      .mockResolvedValue(source({ is_enabled: false }))
    const wrapper = await render([source()])
    await clickByText(wrapper, '断开')
    await flushPromises()
    expect(update).toHaveBeenCalledWith('s1', { is_enabled: false })
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
    await clickByText(wrapper, '连通性测试')
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
    await clickByText(wrapper, '连通性测试')
    await flushPromises()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('端点无响应')
  })
})

describe('删除（引用守卫 + 强删）', () => {
  async function openDelete(rows: CollectSource[]): Promise<VueWrapper> {
    const wrapper = await render(rows)
    const trash = wrapper
      .findAll('button')
      .find((one) => one.attributes('aria-label') === '删除')
    if (trash === undefined) throw new Error('没有删除按钮')
    await trash.trigger('click')
    await flushPromises()
    return wrapper
  }

  it('一级确认说清「点位一起删」，确认后带 force=false', async () => {
    const remove = vi.spyOn(collectApi, 'deleteSource').mockResolvedValue()
    await openDelete([source()])
    expect(document.body.textContent).toContain('已导入点位')
    bodyButton('删除').click()
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('s1', false)
  })

  it('⚠ 409 时升级为强制删除，文案要说清点位数与绑定失效', async () => {
    const remove = vi
      .spyOn(collectApi, 'deleteSource')
      .mockRejectedValueOnce(
        new BizError(41104, '这个数据源下还有点位，请先删除点位', 409, 't1'),
      )
      .mockResolvedValueOnce()
    await openDelete([source({ point_count: 12 })])
    bodyButton('删除').click()
    await flushPromises()

    expect(document.body.textContent).toContain('12 个点位')
    expect(document.body.textContent).toContain('失效')
    bodyButton('强制删除').click()
    await flushPromises()
    expect(remove).toHaveBeenLastCalledWith('s1', true)
  })

  it('取消时什么都不删', async () => {
    const remove = vi.spyOn(collectApi, 'deleteSource').mockResolvedValue()
    await openDelete([source()])
    bodyButton('取消').click()
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('权限', () => {
  it('只读账号看不到写入口，但能看到运行参数入口', async () => {
    signIn(['collect:view'])
    const wrapper = await render([source()])
    const labels = wrapper.findAll('button').map((one) => one.text())
    expect(labels).not.toContain('新增数据源')
    expect(labels).not.toContain('断开')
    expect(labels).toContain('采集参数')
    expect(labels).toContain('归档参数')
  })

  it('⚠ 触碰设备的动作单包 operate 码，不跟着 manage 一起放行', async () => {
    signIn(['collect:view', 'collect:manage'])
    const wrapper = await render([source()])
    const labels = wrapper.findAll('button').map((one) => one.text())
    expect(labels).toContain('断开')
    expect(labels).not.toContain('连通性测试')
  })
})

describe('页面自己要能滚', () => {
  /**
   * ⚠ 这条不是样式洁癖，守的是一次真实故障：窄屏（<xl）时左栏 15rem + 在线浏览
   * 20rem + 点位表 30rem 是竖着堆的，加起来必然高过视口，而 AppShell 的
   * `<main>` 是 `overflow-hidden`、自己不滚。这一页要是不自己滚，多出来的部分
   * 既看不见也够不着；更要命的是 `overflow-hidden` **能被程序滚动**——点一下
   * 裁切线以下的勾选框，浏览器会滚 `<main>` 去露出焦点元素，而它没有滚动条，
   * 用户看到的就是整页内容凭空消失、再也回不来。
   *
   * ⚠ 只能断言到 class：happy-dom 不做布局，量不到盒高。
   */
  it('⚠ 页面根节点必须是自己的滚动容器，否则窄屏时内容会被焦点滚出视野且回不来', async () => {
    const wrapper = await render([source()])
    const root = wrapper.find('main > div')

    expect(root.exists()).toBe(true)
    expect(root.classes()).toContain('overflow-y-auto')
  })

  it('⚠ 主栅格的 `flex-1` 只能在 ≥xl 给：窄屏要按内容撑开交给外层滚', async () => {
    const wrapper = await render([source()])
    const grid = wrapper.find('main > div > div.grid')

    expect(grid.classes()).not.toContain('flex-1')
    expect(grid.classes()).toContain('xl:flex-1')
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
