/**
 * @fileoverview 开机事件页的行为契约：只列装了空调的房间、重算提醒与进度、
 * 排除保留不消失、游标翻页、三条取数路径各自防竞态。
 *
 * ⚠ 重算期间必须继续显示上一批次的完整数据（§5）：半份数据看起来是完整的，
 * 没有任何迹象说明它只抽到一半。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type {
  CursorPage,
  Page,
  Room,
  StartupBatch,
  StartupBatches,
  StartupEpisode,
  Workshop,
} from '@dt/contracts'
import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import StartupsPage from '@/pages/Hvac/Startups/index.vue'
import { EPISODE_PAGE_SIZE } from '@/pages/Hvac/Startups/scripts/startupView'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/hvac/startups', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const STAMP = '2026-08-12T02:00:00.000Z'
const SOURCE_START = '2023-01-01T00:00:00.000Z'
const SOURCE_END = '2026-08-01T00:00:00.000Z'

function workshop(): Workshop {
  return {
    id: 'w1',
    name: '东车间',
    room_count: 2,
    ac_unit_count: 2,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function room(id: string, name: string, units: number): Room {
  return {
    id,
    name,
    workshop: { id: 'w1', name: '东车间' },
    ac_unit_count: units,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function page<TItem>(items: TItem[]): Page<TItem> {
  return { items, page: 1, size: 200, total: items.length }
}

function episode(over: Partial<StartupEpisode> = {}): StartupEpisode {
  return {
    started_at: STAMP,
    running_set: ['K01'],
    complied_at: '2026-08-12T02:25:00.000Z',
    duration_minutes: 25,
    outcome: 'usable',
    readings: {},
    idle_minutes: 390,
    is_excluded: false,
    exclusion_reason: null,
    ...over,
  }
}

function cursor(
  items: StartupEpisode[],
  next: string | null = null,
): CursorPage<StartupEpisode> {
  return { items, next, has_more: next !== null }
}

function batch(over: Partial<StartupBatch> = {}): StartupBatch {
  return {
    id: 'b1',
    status: 'ready',
    is_current: true,
    params_fingerprint: 'abc',
    logic_version: 3,
    window_start: '2026-01-01T00:00:00.000Z',
    window_end: '2026-08-01T00:00:00.000Z',
    shard_total: 8,
    shard_done: 8,
    episode_count: 120,
    unmatched_exclusion_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function batches(over: Partial<StartupBatches> = {}): StartupBatches {
  return {
    items: [batch()],
    current: batch(),
    coverage: [{ running_set: ['K01'], usable_count: 42 }],
    expected_fingerprint: 'abc',
    is_stale: false,
    source_range: { start: SOURCE_START, end: SOURCE_END },
    ...over,
  }
}

const REBUILT = {
  batch_id: 'b2',
  status: 'running',
  shard_total: 44,
  window_start: SOURCE_START,
  window_end: SOURCE_END,
  is_clamped: false,
} as const

/** 手动结算的 promise，用来把两次取数的返回顺序倒过来。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<T>((done) => {
    settle = done
  })
  return { promise, resolve: (value) => settle?.(value) }
}

function buttonByName(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (node) =>
      node.textContent?.trim() === name ||
      node.getAttribute('aria-label') === name,
  )
}

async function click(name: string): Promise<void> {
  const target = buttonByName(name)
  if (target === undefined) throw new Error(`找不到叫「${name}」的按钮`)
  target.click()
  await flushPromises()
}

function twoCombinations(): StartupBatches {
  return batches({
    coverage: [
      { running_set: ['K01'], usable_count: 42 },
      { running_set: ['K02', 'K03'], usable_count: 3 },
    ],
  })
}

/** 点左栏「组合覆盖」里的某一条。 */
async function pickCombination(label: string): Promise<void> {
  const row = [...document.querySelectorAll('button[aria-pressed]')].find(
    (node) => node.textContent?.includes(label),
  )
  if (row === undefined) throw new Error(`左栏里没有「${label}」`)
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

/** 某个下拉当前显示的取值。 */
function selectValue(field: string): string {
  const id = [...document.querySelectorAll('label')]
    .find((node) => node.textContent?.trim().startsWith(field))
    ?.getAttribute('for')
  return (
    document
      .getElementById(id ?? '')
      ?.querySelector('.dt-select__value')
      ?.textContent?.trim() ?? ''
  )
}

/** 在某个下拉里点一项。 */
async function pick(field: string, label: string): Promise<void> {
  const trigger = [...document.querySelectorAll('label')]
    .find((node) => node.textContent?.trim().startsWith(field))
    ?.getAttribute('for')
  document
    .getElementById(trigger ?? '')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  )
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

/** 填抽取区间。⚠ TZ 钉成 UTC，本地时与 UTC 同值，断言才能写成字面量。 */
async function fillRange(from: string, to: string): Promise<void> {
  for (const [label, value] of [
    ['抽取起始', from],
    ['抽取结束', to],
  ]) {
    const id = [...document.querySelectorAll('label')]
      .find((node) => node.textContent?.trim().startsWith(label ?? ''))
      ?.getAttribute('for')
    const field = document.getElementById(id ?? '')
    if (!(field instanceof HTMLInputElement)) {
      throw new Error(`找不到叫「${label}」的输入框`)
    }
    field.value = value ?? ''
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await flushPromises()
}

async function selectRoom(): Promise<void> {
  await pick('车间', '东车间')
  await pick('房间', '注塑房')
}

/** ⚠ 页面进得来只要 ac:view，但三个写端点要 ac:manage，用例得说清是哪一档。 */
function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    role: { id: 'r1', name: 'admin', description: null, is_builtin: true },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  }
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  signIn(['ac:view', 'ac:manage'])
  document.body.innerHTML = ''
  // ⚠ toast 队列是模块级单例：只清 DOM 不清队列的话，上一条用例弹过的提示
  // 会随下一次挂载 DtToastHost 原样重现，断言「没提示过成功」必然假红/假绿
  useToast().clear()
  vi.spyOn(hvac, 'listWorkshops').mockResolvedValue(page([workshop()]))
  vi.spyOn(hvac, 'listRooms').mockResolvedValue(
    page([room('r1', '注塑房', 2), room('r2', '空房', 0)]),
  )
  vi.spyOn(hvac, 'listAcUnits').mockResolvedValue(page([]))
  vi.spyOn(hvac, 'listAcDatasets').mockResolvedValue([])
  vi.spyOn(hvac, 'getStartupBatches').mockResolvedValue(batches())
  vi.spyOn(hvac, 'listStartupEpisodes').mockResolvedValue(cursor([episode()]))
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// ⚠ 折线图打桩：DtLineChart 会动态 import 真 echarts，而 happy-dom 拿不到
// canvas 2d 上下文。图表自身由 @dt/ui 的用例守，这里只关心页面怎么编排。
const STUBS = { DtLineChart: { template: '<div data-test="chart" />' } }

async function open() {
  const wrapper = mount(StartupsPage, {
    attachTo: document.body,
    global: { stubs: STUBS },
  })
  await flushPromises()
  return wrapper
}

describe('房间筛选', () => {
  it('车间取不回来时说出原因，而不是给一串空下拉', async () => {
    vi.mocked(hvac.listWorkshops).mockRejectedValue(new Error('boom'))
    const wrapper = await open()
    expect(wrapper.text()).toContain('请求失败')
  })

  it('没选房间时先说清开机事件是房间级的', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('开机事件是房间级的')
    expect(hvac.getStartupBatches).not.toHaveBeenCalled()
  })

  it('只列装了空调的房间——没有空调的房间谈不上开机', async () => {
    await open()
    await pick('车间', '东车间')
    const options = [...document.querySelectorAll('[role="option"]')].map(
      (node) => node.textContent?.trim(),
    )
    expect(options).not.toContain('空房')
  })

  it('选定房间后按房间取批次与事件', async () => {
    await open()
    await selectRoom()
    expect(hvac.getStartupBatches).toHaveBeenCalledWith('r1')
    expect(vi.mocked(hvac.listStartupEpisodes).mock.calls[0]?.[0]).toBe('r1')
  })
})

describe('批次状态', () => {
  it('指纹不符时说清屏幕上这份是按旧规则算的', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ is_stale: true }),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('旧规则')
    expect(buttonByName('重新抽取')).toBeDefined()
  })

  it('没算过的房间说「还没抽取过」，不是「该重算了」', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ current: null, is_stale: false }),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('还没有抽取过')
    expect(wrapper.text()).not.toContain('旧规则')
  })

  it('没算过的房间也给得出抽取入口，否则第一次永远开不了头', async () => {
    // ⚠ 这颗键与「有没有批次」无关：只长在「已经算过」那条分支里的话，
    // 没抽取过的房间就无从开始，而那正是最需要它的时候
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ current: null, is_stale: false }),
    )
    await open()
    await selectRoom()
    expect(buttonByName('开始抽取')).toBeDefined()
  })

  it('重算中显示分片进度，同时仍然展示上一批次的事件', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({
        current: batch({ status: 'running', shard_done: 3, shard_total: 8 }),
      }),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('3 / 8')
    expect(wrapper.text()).toContain('上一批次的完整结果')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  })

  it('对不上事件的人工排除要数出来——人的判断在悄悄流失', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ current: batch({ unmatched_exclusion_count: 4 }) }),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('4 条人工排除')
  })

  it('抽取用界面上填的区间，不再复用上一批次那个被钉死的窗口', async () => {
    vi.stubEnv('TZ', 'UTC')
    const rebuild = vi
      .spyOn(hvac, 'rebuildStartupBatches')
      .mockResolvedValue(REBUILT)
    mount(DtConfirmHost)
    mount(DtToastHost)
    await open()
    await selectRoom()
    await fillRange('2023-01-01T00:00', '2026-08-01T00:00')
    await click('重新抽取')
    useConfirm().resolve(true)
    await flushPromises()
    expect(rebuild).toHaveBeenCalledWith('r1', {
      window_start: '2023-01-01T00:00:00.000Z',
      window_end: '2026-08-01T00:00:00.000Z',
    })
  })

  it('还没抽取过的房间也能发起第一次抽取', async () => {
    vi.stubEnv('TZ', 'UTC')
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ current: null }),
    )
    const rebuild = vi
      .spyOn(hvac, 'rebuildStartupBatches')
      .mockResolvedValue(REBUILT)
    mount(DtConfirmHost)
    mount(DtToastHost)
    await open()
    await selectRoom()
    await fillRange('2023-01-01T00:00', '2026-08-01T00:00')
    await click('开始抽取')
    useConfirm().resolve(true)
    await flushPromises()
    expect(rebuild).toHaveBeenCalledWith('r1', {
      window_start: '2023-01-01T00:00:00.000Z',
      window_end: '2026-08-01T00:00:00.000Z',
    })
  })

  it('抽取前要确认，说清这次跨多大；点取消就什么都不发', async () => {
    vi.stubEnv('TZ', 'UTC')
    const rebuild = vi.spyOn(hvac, 'rebuildStartupBatches')
    mount(DtConfirmHost)
    await open()
    await selectRoom()
    await fillRange('2023-01-01T00:00', '2026-08-01T00:00')
    await click('重新抽取')
    expect(document.body.textContent).toContain('个月度分片')
    useConfirm().resolve(false)
    await flushPromises()
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('不填区间就是全部历史：一个 window 字段都不发，也不发上一批次那个', async () => {
    const rebuild = vi
      .spyOn(hvac, 'rebuildStartupBatches')
      .mockResolvedValue(REBUILT)
    mount(DtConfirmHost)
    mount(DtToastHost)
    await open()
    await selectRoom()
    await click('重新抽取')
    useConfirm().resolve(true)
    await flushPromises()
    expect(rebuild).toHaveBeenCalledWith('r1', {})
  })

  it('只填一端时另一端不发，交给后端按数据源算', async () => {
    vi.stubEnv('TZ', 'UTC')
    const rebuild = vi
      .spyOn(hvac, 'rebuildStartupBatches')
      .mockResolvedValue(REBUILT)
    mount(DtConfirmHost)
    mount(DtToastHost)
    await open()
    await selectRoom()
    await fillRange('2025-01-01T00:00', '')
    await click('重新抽取')
    useConfirm().resolve(true)
    await flushPromises()
    expect(rebuild).toHaveBeenCalledWith('r1', {
      window_start: '2025-01-01T00:00:00.000Z',
    })
  })

  it('入队失败时说出原因，不谎报「已排队」', async () => {
    vi.spyOn(hvac, 'rebuildStartupBatches').mockRejectedValue(new Error('boom'))
    mount(DtConfirmHost)
    mount(DtToastHost)
    const wrapper = await open()
    await selectRoom()
    await click('重新抽取')
    useConfirm().resolve(true)
    await flushPromises()
    expect(wrapper.text()).toContain('请求失败')
    expect(document.body.textContent).not.toContain('已排队抽取')
  })

  it('区间被数据源实际范围夹过时要说出来，不能让人以为抽全了', async () => {
    vi.stubEnv('TZ', 'UTC')
    vi.spyOn(hvac, 'rebuildStartupBatches').mockResolvedValue({
      ...REBUILT,
      is_clamped: true,
    })
    mount(DtConfirmHost)
    mount(DtToastHost)
    await open()
    await selectRoom()
    await click('重新抽取')
    useConfirm().resolve(true)
    await flushPromises()
    expect(document.body.textContent).toContain('收窄')
  })

  it('上一次抽取失败时说清屏幕上的数据可能不完整', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ current: batch({ status: 'failed' }) }),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('可能不完整')
  })

  it('房间没绑数据源时给去处，而不是一个填了就报错的空 picker', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ source_range: null }),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('数据与达标')
    expect(buttonByName('重新抽取')?.disabled).toBe(true)
  })

  it('可用区间说给用户听，「全部历史」到底是多长才有着落', async () => {
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('数据源现有')
    expect(wrapper.text()).toContain('当前：全部历史')
  })
})

describe('组合覆盖度', () => {
  it('列出每个组合攒了多少可用事件', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({
        coverage: [
          { running_set: ['K01'], usable_count: 42 },
          { running_set: ['K02', 'K03'], usable_count: 3 },
        ],
      }),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('42 条')
    // 条数少的照样列出来，且标出来提醒别拿它训练
    expect(wrapper.text()).toContain('3 条')
    expect(wrapper.text()).toContain('样本太少')
  })

  it('点左栏一条就把事件筛到它，走的还是工具条那个筛选器', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(twoCombinations())
    await open()
    await selectRoom()
    await pickCombination('K02、K03')
    const last = vi.mocked(hvac.listStartupEpisodes).mock.calls.at(-1)
    expect(last?.[1]?.running_set).toBe('K02,K03')
    // ⚠ 同一个筛选器：工具条那个下拉必须跟着显示同一条，不能各记各的
    expect(selectValue('运行组合')).toBe('K02、K03（3）')
  })

  it('再点一次选中的那条就回到全部组合', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(twoCombinations())
    await open()
    await selectRoom()
    await pickCombination('K02、K03')
    await pickCombination('K02、K03')
    const last = vi.mocked(hvac.listStartupEpisodes).mock.calls.at(-1)
    expect(last?.[1]?.running_set).toBeUndefined()
    expect(selectValue('运行组合')).toBe('全部组合')
  })
})

describe('左右分栏', () => {
  it('组合在左、事件在右，两栏各自在自己那格里滚', async () => {
    const wrapper = await open()
    await selectRoom()
    const split = wrapper
      .findAll('div')
      .find((node) => node.classes().includes('lg:flex-row'))
    expect(split?.classes()).toEqual(
      expect.arrayContaining(['flex', 'min-h-0', 'flex-1']),
    )
    // 左栏自己滚
    expect(wrapper.find('aside ul').classes()).toEqual(
      expect.arrayContaining(['overflow-y-auto', 'min-h-0']),
    )
    // 右栏的表体由 DtDataView 内部滚，这里锁住它拿得到有界高度
    expect(wrapper.find('.dt-data-view').classes()).toEqual(
      expect.arrayContaining(['min-h-0', 'flex-1']),
    )
  })

  it('页面根节点吃满高度，滚动不外溢到整页', async () => {
    const wrapper = await open()
    const root = wrapper
      .findAll('div')
      .find((node) => node.classes().includes('h-full'))
    expect(root?.classes()).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'min-h-0']),
    )
  })
})

describe('事件列表', () => {
  it('达标时长 0 显示成 0 分钟，不是空也不是破折号', async () => {
    vi.mocked(hvac.listStartupEpisodes).mockResolvedValue(
      cursor([episode({ duration_minutes: 0, complied_at: STAMP })]),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('0 分钟')
  })

  it('不可用的结局默认也列出来——丢弃原因说明数据为什么少', async () => {
    vi.mocked(hvac.listStartupEpisodes).mockResolvedValue(
      cursor([
        episode({
          outcome: 'timeout',
          complied_at: null,
          duration_minutes: null,
        }),
      ]),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.text()).toContain('超时未达标')
  })

  it('被排除的事件留在列表里并标出原因，不会消失', async () => {
    vi.mocked(hvac.listStartupEpisodes).mockResolvedValue(
      cursor([episode({ is_excluded: true, exclusion_reason: '现场检修' })]),
    )
    const wrapper = await open()
    await selectRoom()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('已排除')
    expect(wrapper.text()).toContain('现场检修')
  })

  it('换筛选会带上参数重取', async () => {
    await open()
    await selectRoom()
    await pick('结果', '可用')
    const last = vi.mocked(hvac.listStartupEpisodes).mock.calls.at(-1)
    expect(last?.[1]?.outcome).toBe('usable')
  })

  it('只取一页，不把整段历史一次性拉下来', async () => {
    await open()
    await selectRoom()
    expect(vi.mocked(hvac.listStartupEpisodes).mock.calls[0]?.[1]?.limit).toBe(
      EPISODE_PAGE_SIZE,
    )
  })
})

describe('翻页', () => {
  it('下一页把游标原样带回，并**替换**当前页——DOM 里始终只有一页', async () => {
    vi.mocked(hvac.listStartupEpisodes)
      .mockResolvedValueOnce(cursor([episode()], 'CURSOR-1'))
      .mockResolvedValueOnce(
        cursor([episode({ started_at: '2026-08-12T05:00:00.000Z' })]),
      )
    const wrapper = await open()
    await selectRoom()
    await click('下一页')
    expect(vi.mocked(hvac.listStartupEpisodes).mock.calls[1]?.[1]?.after).toBe(
      'CURSOR-1',
    )
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('第 2 页')
  })

  it('翻过去再翻回来，回到第一页那几条', async () => {
    vi.mocked(hvac.listStartupEpisodes)
      .mockResolvedValueOnce(cursor([episode()], 'CURSOR-1'))
      .mockResolvedValueOnce(
        cursor([
          episode({
            started_at: '2026-08-12T05:00:00.000Z',
            duration_minutes: 88,
          }),
        ]),
      )
      .mockResolvedValueOnce(
        cursor([episode({ duration_minutes: 11 })], 'CURSOR-1'),
      )
    const wrapper = await open()
    await selectRoom()
    await click('下一页')
    expect(wrapper.text()).toContain('88 分钟')
    await click('上一页')
    // 第一页不带 after，不是拿某个自己算出来的游标去猜
    expect(
      vi.mocked(hvac.listStartupEpisodes).mock.calls[2]?.[1]?.after,
    ).toBeUndefined()
    expect(wrapper.text()).toContain('11 分钟')
    expect(wrapper.text()).not.toContain('88 分钟')
    expect(wrapper.text()).toContain('第 1 页')
  })

  it('第一页上翻不出「上一页」的请求', async () => {
    await open()
    await selectRoom()
    await click('上一页')
    expect(hvac.listStartupEpisodes).toHaveBeenCalledTimes(1)
  })

  it('换筛选把游标栈清空，重新从第一页取——不会翻进上一串结果的中间', async () => {
    vi.mocked(hvac.listStartupEpisodes)
      .mockResolvedValueOnce(cursor([episode()], 'CURSOR-1'))
      .mockResolvedValueOnce(cursor([episode()], 'CURSOR-2'))
    const wrapper = await open()
    await selectRoom()
    await click('下一页')
    await pick('结果', '可用')
    const last = vi.mocked(hvac.listStartupEpisodes).mock.calls.at(-1)
    expect(last?.[1]?.outcome).toBe('usable')
    expect(last?.[1]?.after).toBeUndefined()
    expect(wrapper.text()).toContain('第 1 页')
  })

  it('换房间同样从第一页起，不接着上一个房间的游标翻', async () => {
    vi.mocked(hvac.listRooms).mockResolvedValue(
      page([room('r1', '注塑房', 2), room('r3', '装配房', 4)]),
    )
    vi.mocked(hvac.listStartupEpisodes)
      .mockResolvedValueOnce(cursor([episode()], 'CURSOR-1'))
      .mockResolvedValueOnce(cursor([episode()], 'CURSOR-2'))
    await open()
    await selectRoom()
    await click('下一页')
    await pick('房间', '装配房')
    const last = vi.mocked(hvac.listStartupEpisodes).mock.calls.at(-1)
    expect(last?.[0]).toBe('r3')
    expect(last?.[1]?.after).toBeUndefined()
  })
})

describe('人工排除', () => {
  it('只读账号看不到写入口——那三个端点要 ac:manage', async () => {
    setActivePinia(createPinia())
    signIn(['ac:view'])
    await open()
    await selectRoom()
    expect(buttonByName('排除')).toBeUndefined()
    expect(buttonByName('重新抽取')).toBeUndefined()
    // 看曲线是读操作，只读账号照样进得去
    expect(buttonByName('曲线')).toBeDefined()
  })

  it('排除要填原因，提交后重取列表', async () => {
    const put = vi.spyOn(hvac, 'putStartupExclusion').mockResolvedValue({
      started_at: STAMP,
      reason: '现场检修',
      excluded_by: 'alice',
      created_at: STAMP,
    })
    mount(DtToastHost)
    await open()
    await selectRoom()
    await click('排除')
    const box = document.querySelector('textarea')
    if (box === null) throw new Error('没有填原因的输入框')
    box.value = '现场检修'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    await click('确认排除')
    expect(put).toHaveBeenCalledWith('r1', STAMP, '现场检修')
  })

  it('在第二页上排除后留在第二页，不把人甩回第一页', async () => {
    vi.mocked(hvac.listStartupEpisodes)
      .mockResolvedValueOnce(cursor([episode()], 'CURSOR-1'))
      .mockResolvedValue(
        cursor([episode({ started_at: '2026-08-12T05:00:00.000Z' })], 'C2'),
      )
    vi.spyOn(hvac, 'putStartupExclusion').mockResolvedValue({
      started_at: STAMP,
      reason: '现场检修',
      excluded_by: 'alice',
      created_at: STAMP,
    })
    mount(DtToastHost)
    const wrapper = await open()
    await selectRoom()
    await click('下一页')
    await click('排除')
    const box = document.querySelector('textarea')
    if (box === null) throw new Error('没有填原因的输入框')
    box.value = '现场检修'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    await click('确认排除')
    // 重取的是第二页那个游标，不是回到第一页
    expect(
      vi.mocked(hvac.listStartupEpisodes).mock.calls.at(-1)?.[1]?.after,
    ).toBe('CURSOR-1')
    expect(wrapper.text()).toContain('第 2 页')
  })

  it('排除失败时把原因显示在弹窗里，不静默关掉', async () => {
    vi.spyOn(hvac, 'putStartupExclusion').mockRejectedValue(new Error('boom'))
    await open()
    await selectRoom()
    await click('排除')
    const box = document.querySelector('textarea')
    if (box === null) throw new Error('没有填原因的输入框')
    box.value = '现场检修'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    await click('确认排除')
    expect(document.body.textContent).toContain('请求失败')
  })

  it('确认后才真的撤销，并重取列表', async () => {
    vi.mocked(hvac.listStartupEpisodes).mockResolvedValue(
      cursor([episode({ is_excluded: true, exclusion_reason: '检修' })]),
    )
    const remove = vi
      .spyOn(hvac, 'deleteStartupExclusion')
      .mockResolvedValue(undefined)
    mount(DtConfirmHost)
    mount(DtToastHost)
    await open()
    await selectRoom()
    await click('撤销排除')
    useConfirm().resolve(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('r1', STAMP)
  })

  it('撤销失败时提示出来，列表不假装已经撤销了', async () => {
    vi.mocked(hvac.listStartupEpisodes).mockResolvedValue(
      cursor([episode({ is_excluded: true, exclusion_reason: '检修' })]),
    )
    vi.spyOn(hvac, 'deleteStartupExclusion').mockRejectedValue(
      new Error('boom'),
    )
    mount(DtConfirmHost)
    mount(DtToastHost)
    const wrapper = await open()
    await selectRoom()
    await click('撤销排除')
    useConfirm().resolve(true)
    await flushPromises()
    expect(document.body.textContent).toContain('请求失败')
    expect(wrapper.text()).toContain('已排除')
  })

  it('撤销排除要先二次确认，点掉就什么都不做', async () => {
    vi.mocked(hvac.listStartupEpisodes).mockResolvedValue(
      cursor([episode({ is_excluded: true, exclusion_reason: '检修' })]),
    )
    const remove = vi.spyOn(hvac, 'deleteStartupExclusion')
    mount(DtConfirmHost)
    await open()
    await selectRoom()
    await click('撤销排除')
    useConfirm().resolve(false)
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('下钻曲线', () => {
  it('点「曲线」按运行组合里那台取起始前后的采样', async () => {
    vi.mocked(hvac.listAcUnits).mockResolvedValue(
      page([
        {
          id: 'a1',
          serial: 'K01',
          name: '东侧机',
          room: { id: 'r1', name: '注塑房' },
          workshop: { id: 'w1', name: '东车间' },
          created_at: STAMP,
          updated_at: STAMP,
        },
      ]),
    )
    const samples = vi
      .spyOn(hvac, 'listRawSamples')
      .mockResolvedValue({ items: [], next: null, has_more: false })
    await open()
    await selectRoom()
    await click('曲线')
    expect(samples).toHaveBeenCalled()
    expect(vi.mocked(samples).mock.calls[0]?.[0]).toBe('a1')
  })

  it('运行组合里没有台账认得的空调时说清画不出来，而不是给一张空图', async () => {
    vi.mocked(hvac.listAcUnits).mockResolvedValue(page([]))
    await open()
    await selectRoom()
    await click('曲线')
    // 弹窗 teleport 到 body 上，wrapper.text() 看不到它
    expect(document.body.textContent).toContain('画不出曲线')
  })
})

describe('竞态', () => {
  it('连着换两个房间时，先发起那次的事件不许盖掉后一次的', async () => {
    const slow = deferred<CursorPage<StartupEpisode>>()
    const fast = deferred<CursorPage<StartupEpisode>>()
    vi.mocked(hvac.listStartupEpisodes)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const wrapper = await open()
    await selectRoom()
    await pick('结果', '可用')

    fast.resolve(cursor([episode({ duration_minutes: 88 })]))
    await flushPromises()
    slow.resolve(cursor([episode({ duration_minutes: 11 })]))
    await flushPromises()

    expect(wrapper.text()).toContain('88 分钟')
    expect(wrapper.text()).not.toContain('11 分钟')
  })

  it('批次那条也各算各的序号，慢的一次不许盖掉新房间的批次', async () => {
    vi.mocked(hvac.listRooms).mockResolvedValue(
      page([room('r1', '注塑房', 2), room('r3', '装配房', 4)]),
    )
    const slow = deferred<StartupBatches>()
    const fast = deferred<StartupBatches>()
    vi.mocked(hvac.getStartupBatches)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const wrapper = await open()
    await selectRoom()
    await pick('房间', '装配房')

    fast.resolve(batches({ current: batch({ episode_count: 777 }) }))
    await flushPromises()
    slow.resolve(batches({ current: batch({ episode_count: 111 }) }))
    await flushPromises()

    expect(wrapper.text()).toContain('777 条事件')
    expect(wrapper.text()).not.toContain('111 条事件')
  })
})
