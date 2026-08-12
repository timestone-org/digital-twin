/**
 * @fileoverview 空调原始数据页的行为契约：表格列来自目录、游标翻页只带回
 * `next`、三类失败各有各的出路、两条取数路径各自防竞态。
 *
 * ⚠ 「外库不可用」绝不能渲染成「暂无数据」，也绝不能留着上一段的旧值：
 * 后端刻意不给陈旧兜底，前端跟着不给才算一致。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { AcDataset, CursorPage, RawSample, RawSeries } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as hvac from '@/api/hvac'
import AcDataPage from '@/pages/Hvac/AcData/index.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({
    path: '/hvac/ac-units/a1/data',
    params: { acUnitId: 'a1' },
    query: {},
  }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function catalog(key = 'raw_minute', name = '原始数据'): AcDataset {
  return {
    key,
    name,
    description: '逐分钟记录',
    metrics: [
      {
        key: 'workshop_temp_avg',
        name: '车间温度',
        unit: '℃',
        group: 'temperature',
        is_limitable: true,
        is_charted_by_default: true,
      },
      {
        key: 'workshop_humidity_avg',
        name: '车间湿度',
        unit: '%',
        group: 'humidity',
        is_limitable: true,
        is_charted_by_default: true,
      },
      {
        key: 'fan_frequency',
        name: '送风机频率',
        unit: 'Hz',
        group: 'frequency',
        is_limitable: false,
        is_charted_by_default: false,
      },
    ],
  }
}

const BLANK = {
  workshop_humidity_avg: null,
  ac_temp_setpoint: null,
  ac_humidity_setpoint: null,
  fresh_air_temp: null,
  fresh_air_humidity: null,
  supply_air_temp: null,
  supply_air_humidity: null,
  return_air_temp: null,
  return_air_humidity: null,
  mixed_air_temp: null,
  mixed_air_humidity: null,
  chilled_water_supply_temp: null,
  chilled_water_supply_pressure: null,
  heat_steam_temp: null,
  heat_steam_pressure: null,
  humidify_steam_temp: null,
  humidify_steam_pressure: null,
  fan_frequency: null,
}

function sample(ts: string, temp: number | null): RawSample {
  return { ts, ...BLANK, workshop_temp_avg: temp }
}

function page(
  items: RawSample[],
  next: string | null = null,
): CursorPage<RawSample> {
  return { items, next, has_more: next !== null }
}

function series(values: (number | null)[]): RawSeries {
  return {
    interval_minutes: 5,
    metrics: ['workshop_temp_avg'],
    points: values.map((value, index) => ({
      ts: `2026-08-12T0${index}:00:00.000Z`,
      values: { workshop_temp_avg: value },
    })),
  }
}

function bizError(code: number, message: string): BizError {
  return new BizError(code, message, 400, 'trace')
}

/** 手动结算的 promise，用来把两次取数的返回顺序倒过来。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<T>((done) => {
    settle = done
  })
  return { promise, resolve: (value) => settle?.(value) }
}

// ⚠ 页面挂到 document.body 上：不挂的话 @vue/test-utils 渲染在游离节点里，
// 所有 document.querySelector 都空手而回，而断言「某个东西不存在」会假绿。
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

/** 勾选框由 label 承载可读名，点的是它里面那个原生 input。 */
async function toggleCheckbox(name: string): Promise<void> {
  const label = [...document.querySelectorAll('label')].find((node) =>
    node.textContent?.trim().includes(name),
  )
  const box = label?.querySelector('input[type="checkbox"]')
  if (!(box instanceof HTMLInputElement)) {
    throw new Error(`找不到叫「${name}」的勾选框`)
  }
  box.checked = !box.checked
  box.dispatchEvent(new Event('change', { bubbles: true }))
  await flushPromises()
}

function headers(): string[] {
  return [...document.querySelectorAll('th')].map(
    (node) => node.textContent?.trim() ?? '',
  )
}

function firstRowCells(): string[] {
  const row = document.querySelector('tbody tr')
  return [...(row?.querySelectorAll('td') ?? [])].map(
    (node) => node.textContent?.trim() ?? '',
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  document.body.innerHTML = ''
  vi.spyOn(hvac, 'listAcDatasets').mockResolvedValue([catalog()])
  vi.spyOn(hvac, 'listRawSamples').mockResolvedValue(page([]))
  vi.spyOn(hvac, 'getRawSeries').mockResolvedValue(series([]))
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

// ⚠ 折线图打桩：DtLineChart 会动态 import 真 echarts，而 happy-dom 拿不到
// canvas 2d 上下文。图表自身的行为由 @dt/ui 的用例守，这里只关心页面怎么编排。
const STUBS = { DtLineChart: { template: '<div data-test="chart" />' } }

function render() {
  return mount(AcDataPage, {
    attachTo: document.body,
    global: { stubs: STUBS },
  })
}

async function open() {
  const wrapper = render()
  await flushPromises()
  return wrapper
}

describe('表格', () => {
  it('列来自目录：时刻 + 每个指标一列，加一个指标不用改页面', async () => {
    vi.mocked(hvac.listRawSamples).mockResolvedValue(
      page([sample('2026-08-12T02:55:00.000Z', 21.5)]),
    )
    await open()
    expect(headers()).toEqual([
      '时刻',
      '车间温度（℃）',
      '车间湿度（%）',
      '送风机频率（Hz）',
    ])
  })

  it('null 渲染成破折号，不是 0', async () => {
    vi.mocked(hvac.listRawSamples).mockResolvedValue(
      page([sample('2026-08-12T02:55:00.000Z', 21.5)]),
    )
    await open()
    const cells = firstRowCells()
    expect(cells[1]).toBe('21.5')
    expect(cells[2]).toBe('—')
    expect(cells).not.toContain('0')
  })

  it('进页面就按默认区间取一页', async () => {
    await open()
    const query = vi.mocked(hvac.listRawSamples).mock.calls[0]?.[1]
    expect(query?.from).toMatch(/Z$/)
    expect(query?.to).toMatch(/Z$/)
    expect(query?.after).toBeUndefined()
  })
})

describe('游标翻页', () => {
  it('有下一页才出「加载更多」', async () => {
    await open()
    expect(buttonByName('加载更多')).toBeUndefined()
  })

  it('加载更多把上一页的 next 原样当 after 带回去，并把结果追加而不是替换', async () => {
    vi.mocked(hvac.listRawSamples)
      .mockResolvedValueOnce(
        page([sample('2026-08-12T02:55:00.000Z', 1)], 'CURSOR-1'),
      )
      .mockResolvedValueOnce(page([sample('2026-08-12T02:56:00.000Z', 2)]))
    await open()
    await click('加载更多')
    expect(vi.mocked(hvac.listRawSamples).mock.calls[1]?.[1]?.after).toBe(
      'CURSOR-1',
    )
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('取完最后一页就收起「加载更多」', async () => {
    vi.mocked(hvac.listRawSamples)
      .mockResolvedValueOnce(
        page([sample('2026-08-12T02:55:00.000Z', 1)], 'CURSOR-1'),
      )
      .mockResolvedValueOnce(page([sample('2026-08-12T02:56:00.000Z', 2)]))
    await open()
    await click('加载更多')
    expect(buttonByName('加载更多')).toBeUndefined()
  })
})

describe('失败的三条出路', () => {
  it('还没绑数据源时给的是「去绑一个」，不是泛泛的「暂无数据」', async () => {
    vi.mocked(hvac.listRawSamples).mockRejectedValue(
      bizError(ERROR_CODES.bindingNotFound, '尚未绑定'),
    )
    await open()
    expect(document.body.textContent).toContain('还没有绑定数据源')
    expect(document.body.textContent).toContain('数据与达标')
  })

  it('外库不可用时明说取不到，既不叫「暂无数据」也不留旧值', async () => {
    vi.mocked(hvac.listRawSamples).mockResolvedValueOnce(
      page([sample('2026-08-12T02:55:00.000Z', 21.5)]),
    )
    const wrapper = await open()
    expect(document.body.textContent).toContain('21.5')

    vi.mocked(hvac.listRawSamples).mockRejectedValue(
      bizError(ERROR_CODES.sourceUnavailable, '外部数据源不可用'),
    )
    await click('近 1 小时')
    await flushPromises()
    expect(wrapper.text()).toContain('数据源暂时不可用')
    expect(wrapper.text()).not.toContain('21.5')
    expect(wrapper.text()).not.toContain('暂无数据')
  })

  it('区间不合法时说在区间控件上——那是用户唯一改得动的地方', async () => {
    vi.mocked(hvac.listRawSamples).mockRejectedValue(
      bizError(ERROR_CODES.timeRangeInvalid, '查询跨度超过 31 天'),
    )
    const wrapper = await open()
    const alerts = wrapper.findAll('[role="alert"]').map((node) => node.text())
    expect(alerts.join(' ')).toContain('查询跨度超过 31 天')
  })

  it('目录取不回来时页面自己说清，不是空白一片', async () => {
    vi.mocked(hvac.listAcDatasets).mockRejectedValue(new Error('boom'))
    const wrapper = await open()
    expect(wrapper.text()).toContain('请求失败')
  })
})

describe('折线', () => {
  it('切到折线视图后按目录里的默认指标取序列', async () => {
    await open()
    await click('折线')
    const query = vi.mocked(hvac.getRawSeries).mock.calls[0]?.[1]
    expect(query?.metrics).toEqual([
      'workshop_temp_avg',
      'workshop_humidity_avg',
    ])
  })

  it('桶宽要显示出来，否则图上的疏密无从解释', async () => {
    vi.mocked(hvac.getRawSeries).mockResolvedValue(series([1, null, 2]))
    const wrapper = await open()
    await click('折线')
    expect(wrapper.text()).toContain('5 分钟')
  })

  it('序列取不回来时说出原因，不留着空图假装没数据', async () => {
    vi.mocked(hvac.getRawSeries).mockRejectedValue(
      bizError(ERROR_CODES.sourceUnavailable, '外部数据源不可用'),
    )
    const wrapper = await open()
    await click('折线')
    expect(wrapper.text()).toContain('数据源暂时不可用')
  })

  it('桶宽还没回来时不显示一句「每点聚合 0 分钟」', async () => {
    vi.mocked(hvac.getRawSeries).mockReturnValue(new Promise(() => undefined))
    const wrapper = await open()
    await click('折线')
    expect(wrapper.text()).not.toContain('每点聚合')
  })

  it('取消勾选到一条不剩时不再发请求，界面提示去勾选', async () => {
    const wrapper = await open()
    await click('折线')
    const before = vi.mocked(hvac.getRawSeries).mock.calls.length
    await toggleCheckbox('车间温度')
    await toggleCheckbox('车间湿度')
    expect(wrapper.text()).toContain('勾选上面的指标')
    expect(vi.mocked(hvac.getRawSeries).mock.calls.length).toBe(before + 1)
  })
})

describe('竞态', () => {
  it('连着换两次区间时，先发起那次的表格数据不许盖掉后一次的', async () => {
    const slow = deferred<CursorPage<RawSample>>()
    const fast = deferred<CursorPage<RawSample>>()
    vi.mocked(hvac.listRawSamples)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const wrapper = render()
    await flushPromises()
    await click('近 1 小时')

    fast.resolve(page([sample('2026-08-12T05:00:00.000Z', 88.25)]))
    await flushPromises()
    slow.resolve(page([sample('2026-08-12T00:00:00.000Z', 11.75)]))
    await flushPromises()

    // 断言落在那一格上：整页文本里混着顶栏的时钟，数字随便撞
    expect(firstRowCells()[1]).toBe('88.25')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  })

  it('折线那条同样各算各的序号，慢的一次不许盖掉新曲线', async () => {
    const slow = deferred<RawSeries>()
    const fast = deferred<RawSeries>()
    vi.mocked(hvac.getRawSeries)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const wrapper = render()
    await flushPromises()
    await click('折线')
    await click('近 1 小时')

    fast.resolve({ ...series([1]), interval_minutes: 7 })
    await flushPromises()
    slow.resolve({ ...series([2]), interval_minutes: 60 })
    await flushPromises()

    expect(wrapper.text()).toContain('7 分钟')
    expect(wrapper.text()).not.toContain('60 分钟')
  })
})

describe('呈现方式', () => {
  it('记在本地，下次进页面还是上次那个', async () => {
    await open()
    await click('折线')
    expect(localStorage.getItem('dt.view-mode.hvac-ac-data')).toBe('chart')
  })

  it('只有一个数据集时不出数据集选择器——一个选项的下拉是噪声', async () => {
    const wrapper = await open()
    expect(wrapper.text()).not.toContain('数据集')
  })

  it('有第二个数据集时才出选择器，页面不用改', async () => {
    vi.mocked(hvac.listAcDatasets).mockResolvedValue([
      catalog(),
      catalog('hourly', '小时数据'),
    ])
    const wrapper = await open()
    expect(wrapper.text()).toContain('数据集')
  })
})
