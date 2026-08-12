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
import { DtConfirmHost, DtToastHost, useConfirm } from '@dt/ui'

import * as hvac from '@/api/hvac'
import StartupsPage from '@/pages/Hvac/Startups/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/hvac/startups', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const STAMP = '2026-08-12T02:00:00.000Z'

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
    ...over,
  }
}

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
    // ⚠ 这颗键曾经只长在「已经算过」那条分支里，于是没抽取过的房间无从开始
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

  it('重算只入队：点一下就发 POST，不等它算完', async () => {
    const rebuild = vi
      .spyOn(hvac, 'rebuildStartupBatches')
      .mockResolvedValue({ batch_id: 'b2', status: 'running', shard_total: 8 })
    mount(DtToastHost)
    await open()
    await selectRoom()
    await click('重新抽取')
    expect(rebuild).toHaveBeenCalledWith('r1', {
      window_start: '2026-01-01T00:00:00.000Z',
      window_end: '2026-08-01T00:00:00.000Z',
    })
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

  it('加载更多把上一页的游标原样带回并追加', async () => {
    vi.mocked(hvac.listStartupEpisodes)
      .mockResolvedValueOnce(cursor([episode()], 'CURSOR-1'))
      .mockResolvedValueOnce(
        cursor([episode({ started_at: '2026-08-12T05:00:00.000Z' })]),
      )
    const wrapper = await open()
    await selectRoom()
    await click('加载更多')
    expect(vi.mocked(hvac.listStartupEpisodes).mock.calls[1]?.[1]?.after).toBe(
      'CURSOR-1',
    )
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
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
