/**
 * @fileoverview 点位表的行为契约：实时值的三档、写值的安全线、退订。
 *
 * ⚠ 这一页能真的往 PLC 写。最要紧的不是渲染，而是：
 * 1. 「没收到过 / 取不到 / 陈旧 / 现值」四种情形在界面上分得开。
 * 2. 写值走 `:write` 且带幂等键，失败**不自动重试**。
 * 3. 卸载时退订——不退的话，切走的页面还在收消息并更新已经不在的状态。
 * 4. 批量删除整批一次发出去，且被绑着时先给二次确认再强删。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import type { CollectPoint, CollectSource } from '@dt/contracts'

import * as collectApi from '@/api/collect'
import { BizError } from '@/api/client'
import NodeTable from '@/pages/Collect/Opcua/components/NodeTable.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/collect/opcua/s1/points', query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const confirmSpy = vi.fn<() => Promise<boolean>>()
const toastError = vi.fn()
const toastSuccess = vi.fn()
const toastWarning = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
      warning: toastWarning,
    }),
  }
})

/** WS 通道的假件：记下订过哪些主题，并能手工推一帧。 */
const subscribed: string[] = []
const unsubscribed: string[] = []
let pushFrame: (payload: Record<string, unknown>) => void = () => undefined
const isConnected = ref(true)

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    isConnected,
    subscribe: (
      topic: string,
      handler: (p: Record<string, unknown>) => void,
    ) => {
      subscribed.push(topic)
      pushFrame = handler
      return () => unsubscribed.push(topic)
    },
  }),
}))

function source(over: Partial<CollectSource> = {}): CollectSource {
  return {
    id: 's1',
    name: '一号车间 PLC',
    code: 'plant1',
    protocol: 'opcua',
    description: null,
    endpoint: 'opc.tcp://10.0.0.2:4840',
    username: null,
    has_credential: false,
    options_json: {},
    read_mode: 'subscribe',
    poll_interval_ms: 1000,
    is_enabled: true,
    point_count: 1,
    live_point_limit: 1000,
    runtime: {
      state: 'online',
      point_count: 1,
      error_category: null,
      error_detail: null,
      leader_instance: 'c1',
      updated_at: null,
    },
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function point(over: Partial<CollectPoint> = {}): CollectPoint {
  return {
    id: 'p1',
    source_id: 's1',
    node_key: 's1:outlet_temp',
    code: 'outlet_temp',
    name: '出口温度',
    address: 'ns=2;s=Plant1.OutletTemp',
    data_type: 'float',
    unit: '℃',
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60_000,
    archive_retention_days: null,
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

async function render(
  rows: CollectPoint[] = [point()],
  over: Partial<CollectSource> = {},
): Promise<VueWrapper> {
  vi.spyOn(collectApi, 'listPoints').mockResolvedValue({
    items: rows,
    page: 1,
    size: 20,
    total: rows.length,
  })
  const wrapper = mount(NodeTable, {
    props: { source: source(over) },
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

function modalInput(): HTMLInputElement {
  const found = document.body
    .querySelector('.dt-modal')
    ?.querySelector<HTMLInputElement>('input[type="text"]')
  if (found === null || found === undefined) throw new Error('弹窗里没有输入框')
  return found
}

async function typeAndSubmit(value: string): Promise<void> {
  const input = modalInput()
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
  bodyButton('下发').click()
  await flushPromises()
}

async function push(item: Record<string, unknown>): Promise<void> {
  pushFrame({ items: [item] })
  await flushPromises()
}

/** 勾中一行——多选是批量删除唯一的入口。 */
async function selectRow(wrapper: VueWrapper, name: string): Promise<void> {
  await wrapper.find(`input[aria-label="选择 ${name}"]`).setValue(true)
  await flushPromises()
}

/** 在工具栏的搜索框里打字。 */
async function search(wrapper: VueWrapper, text: string): Promise<void> {
  const input = wrapper.find('input[placeholder="搜索名称或编码"]')
  await input.setValue(text)
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  subscribed.length = 0
  unsubscribed.length = 0
  isConnected.value = true
  confirmSpy.mockReset().mockResolvedValue(true)
  toastError.mockReset()
  toastSuccess.mockReset()
  toastWarning.mockReset()
  document.body.innerHTML = ''
  signIn(['collect:view', 'collect:operate', 'collect:manage'])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('实时订阅', () => {
  it('订的是这个数据源的主题', async () => {
    await render()
    expect(subscribed).toEqual(['collect:s1'])
  })

  it('⚠ 卸载时退订——不退就是在更新一个已经不在的页面', async () => {
    const wrapper = await render()
    wrapper.unmount()
    expect(unsubscribed).toEqual(['collect:s1'])
  })

  it('通道断了要说出来，不让上一批值冒充现值', async () => {
    isConnected.value = false
    expect((await render()).text()).toContain('实时通道未连接')
  })
})

describe('当前值的四种情形', () => {
  it('还没收到过时说「未上报」，不摆一个 0', async () => {
    const text = (await render()).text()
    expect(text).toContain('未上报')
    expect(text).not.toContain('0 ℃')
  })

  it('收到现值时带单位显示，小数补齐两位', async () => {
    const wrapper = await render()
    await push({
      nodeKey: 's1:outlet_temp',
      state: 'ok',
      value: 36.5,
      timestampMs: Date.UTC(2026, 7, 16, 2, 0),
      quality: 'good',
    })
    expect(wrapper.text()).toContain('36.50 ℃')
  })

  it('⚠ 0 是合法读数，不当成「没有值」', async () => {
    const wrapper = await render()
    await push({
      nodeKey: 's1:outlet_temp',
      state: 'ok',
      value: 0,
      timestampMs: Date.UTC(2026, 7, 16, 2, 0),
      quality: 'good',
    })
    expect(wrapper.text()).toContain('0 ℃')
    expect(wrapper.text()).not.toContain('未上报')
  })

  it('很久没变的值照显示，不因为时刻旧就标出来', async () => {
    const wrapper = await render()
    await push({
      nodeKey: 's1:outlet_temp',
      state: 'ok',
      value: 36.5,
      timestampMs: Date.UTC(2026, 7, 15, 2, 0),
      quality: 'good',
    })
    expect(wrapper.text()).toContain('36.5')
    expect(wrapper.text()).not.toContain('陈旧')
  })

  it('取不到时标「取不到」，不留着上一个值', async () => {
    const wrapper = await render()
    await push({
      nodeKey: 's1:outlet_temp',
      state: 'error',
      errorMessage: '点位暂无快照值',
    })
    expect(wrapper.text()).toContain('取不到')
  })

  it('别的点位的推送不会串到这一行上', async () => {
    const wrapper = await render()
    await push({
      nodeKey: 's1:other',
      state: 'ok',
      value: 99,
      timestampMs: Date.UTC(2026, 7, 16, 2, 0),
      quality: 'good',
    })
    expect(wrapper.text()).not.toContain('99')
  })
})

describe('实时值的覆盖范围', () => {
  it('⚠ 点位比上限多时如实说明，否则那些行看起来像坏了', async () => {
    const text = (
      await render([point()], { point_count: 1500, live_point_limit: 1000 })
    ).text()
    expect(text).toContain('实时值只覆盖')
  })

  it('没超上限时不出这条', async () => {
    expect((await render()).text()).not.toContain('实时值只覆盖')
  })
})

/**
 * ⚠ 这一组守的是「一屏能看几行」。寻址串没有空格，一旦允许换行就只能按字符断，
 * 一条 76 字符的串会把行撑到 200px 以上——一屏只剩两三行，而这不会报任何错。
 * ⚠ 只能断言到类名与属性：happy-dom 不做布局，量不到盒高与列宽。
 */
describe('寻址串那一列', () => {
  const LONG = 'ns=2;s=DLS01.IFIX.Server.Tags.Analog Input.K01_X.Value.F_CV'

  function addressCell(wrapper: VueWrapper) {
    return wrapper.find('tbody tr td:nth-child(8) span')
  }

  it('⚠ 单行截断，绝不按字符换行', async () => {
    const cell = addressCell(await render([point({ address: LONG })]))

    expect(cell.classes()).toContain('truncate')
    // block 不能少：truncate 那三件套对行内盒不生效
    expect(cell.classes()).toContain('block')
    expect(cell.classes()).not.toContain('break-all')
  })

  it('截断了也要够得着完整值——鼠标悬停看 title', async () => {
    const cell = addressCell(await render([point({ address: LONG })]))

    expect(cell.attributes('title')).toBe(LONG)
  })

  it('⚠ 表格必须开固定列宽，否则列宽只是建议、这一列会被挤没', async () => {
    const table = (await render()).find('table')

    expect(table.classes()).toContain('is-fixed')
  })
})

describe('下发写值', () => {
  async function openWriteDialog(): Promise<VueWrapper> {
    const wrapper = await render()
    await clickByText(wrapper, '写值')
    await flushPromises()
    return wrapper
  }

  it('弹窗里摆出寻址串，核对是下发前唯一的人工防线', async () => {
    await openWriteDialog()
    expect(document.body.textContent).toContain('ns=2;s=Plant1.OutletTemp')
  })

  it('写值打动作端点并带幂等键', async () => {
    const write = vi.spyOn(collectApi, 'writePoint').mockResolvedValue({
      point_id: 'p1',
      node_key: 's1:outlet_temp',
      is_written: true,
    })
    await openWriteDialog()
    await typeAndSubmit('42')

    const [pointId, value, key] = write.mock.calls[0] ?? []
    expect([pointId, value]).toEqual(['p1', 42])
    expect(key).toBeTruthy()
  })

  it('⚠ 填了非数字就拒绝，绝不当成 0 写下去', async () => {
    const write = vi.spyOn(collectApi, 'writePoint')
    await openWriteDialog()
    await typeAndSubmit('abc')

    expect(write).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('不是一个数字')
  })

  it('⚠ 采集侧没确认写入时报错，不显示成成功', async () => {
    vi.spyOn(collectApi, 'writePoint').mockResolvedValue({
      point_id: 'p1',
      node_key: 's1:outlet_temp',
      is_written: false,
    })
    await openWriteDialog()
    await typeAndSubmit('42')

    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
  })

  it('⚠ 失败之后不自动重发——写超时不代表没写成功', async () => {
    const write = vi
      .spyOn(collectApi, 'writePoint')
      .mockRejectedValue(new Error('超时'))
    await openWriteDialog()
    await typeAndSubmit('42')

    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('权限', () => {
  it('只读账号看不到写入口', async () => {
    signIn(['collect:view'])
    const labels = (await render()).findAll('button').map((one) => one.text())
    expect(labels).not.toContain('写值')
    expect(labels).not.toContain('新建点位')
  })

  it('⚠ 下发写值单包 operate，不跟着 manage 一起放行', async () => {
    signIn(['collect:view', 'collect:manage'])
    const wrapper = await render()
    const ariaLabels = wrapper
      .findAll('button')
      .map((one) => one.attributes('aria-label') ?? '')
    expect(ariaLabels.some((label) => label.startsWith('点位设置'))).toBe(true)
    const labels = wrapper.findAll('button').map((one) => one.text())
    expect(labels).not.toContain('写值')
  })

  it('导出不需要写权限——它只是把配置读出来', async () => {
    signIn(['collect:view'])
    const labels = (await render()).findAll('button').map((one) => one.text())
    expect(labels).toContain('导出 CSV')
  })
})

describe('两种空态', () => {
  it('一个点位都没导过时，引导去浏览树里勾选', async () => {
    const wrapper = await render([])

    expect(wrapper.text()).toContain('尚未导入点位')
  })

  it('⚠ 搜不到时不许说「尚未导入」：那会让人把同一批点位再导一遍', async () => {
    const wrapper = await render([])

    await search(wrapper, 'zzz')

    expect(wrapper.text()).toContain('没有匹配的点位')
    expect(wrapper.text()).not.toContain('尚未导入点位')
    expect(wrapper.text()).not.toContain('CSV 批量导入')
  })
})

describe('批量开关记录历史', () => {
  const SAVED = { point: point(), address_check: null }

  async function selectBoth(): Promise<VueWrapper> {
    const wrapper = await render([
      point(),
      point({ id: 'p2', name: '进口温度' }),
    ])
    await selectRow(wrapper, '出口温度')
    await selectRow(wrapper, '进口温度')
    return wrapper
  }

  it('勾中的每一行都改过去，并把改了几个说出来', async () => {
    const update = vi.spyOn(collectApi, 'updatePoint').mockResolvedValue(SAVED)
    await clickByText(await selectBoth(), '批量开启记录历史')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('p1', { archive_enabled: true })
    expect(update).toHaveBeenCalledWith('p2', { archive_enabled: true })
    expect(toastSuccess).toHaveBeenCalledWith('已开启记录历史：2 个点位')
  })

  it('⚠ 部分失败要报出失败个数，静默吞掉会让人以为整批都改成了', async () => {
    vi.spyOn(collectApi, 'updatePoint')
      .mockResolvedValueOnce(SAVED)
      .mockRejectedValueOnce(new Error('冲突'))
    await clickByText(await selectBoth(), '批量关闭记录历史')
    await flushPromises()

    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('1 个成功，1 个失败')
  })
})

describe('批量删除', () => {
  const BOUND = new BizError(41105, '这批里有 1 个点位还被大屏绑着', 409, 't')

  async function askToDelete(rows: CollectPoint[]): Promise<VueWrapper> {
    const wrapper = await render(rows)
    for (const row of rows) await selectRow(wrapper, row.name)
    await clickByText(wrapper, '批量删除')
    await flushPromises()
    return wrapper
  }

  it('勾中之后才出现批量条，没勾时不占位', async () => {
    const wrapper = await render()
    expect(wrapper.text()).not.toContain('批量删除')

    await selectRow(wrapper, '出口温度')
    expect(wrapper.text()).toContain('已选 1 项')
    expect(wrapper.text()).toContain('批量删除')
  })

  it('⚠ 整批一次发出去，不是勾几个就打几次接口', async () => {
    const remove = vi
      .spyOn(collectApi, 'deletePoints')
      .mockResolvedValue(undefined)
    await askToDelete([point(), point({ id: 'p2', name: '进口温度' })])
    bodyButton('删除').click()
    await flushPromises()

    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(['p1', 'p2'], false)
  })

  it('确认框里说清删的是几个点位，以及历史仍然留着', async () => {
    vi.spyOn(collectApi, 'deletePoints').mockResolvedValue(undefined)
    await askToDelete([point(), point({ id: 'p2', name: '进口温度' })])

    expect(document.body.textContent).toContain('2 个点位')
    expect(document.body.textContent).toContain('已归档的历史会保留')
  })

  it('删完把删掉几个说出来，并重拉当前页', async () => {
    vi.spyOn(collectApi, 'deletePoints').mockResolvedValue(undefined)
    await askToDelete([point()])
    // ⚠ 读 render 装上去的那个桩，不再 spyOn 一次：重复 spyOn 会换出一个
    // 调用记录空着的新桩，断言于是永远看不到这次重拉
    const listed = vi.mocked(collectApi.listPoints)
    const before = listed.mock.calls.length
    bodyButton('删除').click()
    await flushPromises()

    expect(toastSuccess).toHaveBeenCalledWith('已删除 1 个点位')
    expect(listed.mock.calls.length).toBeGreaterThan(before)
  })

  it('⚠ 被大屏绑着时先摆二次确认，绝不直接强删', async () => {
    const remove = vi
      .spyOn(collectApi, 'deletePoints')
      .mockRejectedValueOnce(BOUND)
    await askToDelete([point()])
    bodyButton('删除').click()
    await flushPromises()

    expect(remove).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('还被大屏绑着')
    expect(document.body.textContent).toContain('绑定就此失效')
  })

  it('二次确认按下去才带 force，后果已经在文案里说过了', async () => {
    const remove = vi
      .spyOn(collectApi, 'deletePoints')
      .mockRejectedValueOnce(BOUND)
      .mockResolvedValueOnce(undefined)
    await askToDelete([point()])
    bodyButton('删除').click()
    await flushPromises()
    bodyButton('强制删除').click()
    await flushPromises()

    expect(remove).toHaveBeenLastCalledWith(['p1'], true)
  })

  it('⚠ 网络错误不许升级成强删——那会诱导人删掉还被绑着的点位', async () => {
    vi.spyOn(collectApi, 'deletePoints').mockRejectedValue(new Error('超时'))
    await askToDelete([point()])
    bodyButton('删除').click()
    await flushPromises()

    expect(toastError).toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('强制删除')
  })

  it('只读账号连勾选框都没有，也就点不到批量删除', async () => {
    signIn(['collect:view'])
    const wrapper = await render()

    expect(wrapper.find('input[aria-label="选择 出口温度"]').exists()).toBe(
      false,
    )
  })
})
