/**
 * @fileoverview 守日历热力整块的渲染：标题走共用面板、四张先接一张时只画那一张而
 * 另几张的框照建、时区认不出时整块出一句说得出原因的空态、值变只替换标题与那几套
 * 坐标（跨度因此不会停在第一帧上）、点一格上抛那张日历配置里的名称，以及卸载时
 * 实例真的被释放。
 *
 * ⚠ 逐张状态在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 在**本模块**上打桩，不去 mock echarts 包本身（testing-standard-typescript §5.2）。
 * ⚠ 「这份 option 交给真 echarts 之后画不画得出来」是 ssr.spec.ts 那条的事，
 * 这里断言的只是 option 的形状。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/calendar-heat/Component.vue'
import {
  CALENDAR_BLANK_TEXT,
  DAY_SLOT_KEY,
  METRIC_ITEMS_KEY,
  metricFieldKey,
  timezoneFaultText,
} from '../../../src/modules/calendar-heat/days'
import manifest from '../../../src/modules/calendar-heat/manifest'
import { configDefaults } from '../../../src/shared/config'

const echarts = vi.hoisted(() => {
  const handle = {
    setOption: vi.fn(),
    onClick: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }
  return { handle, createChart: vi.fn(() => Promise.resolve(handle)) }
})

vi.mock('../../../src/shared/chart/echarts', () => ({
  createChart: echarts.createChart,
}))

const DEFAULTS = configDefaults(manifest.configSchema)

type Slots = Record<string, ModuleSlotMeta>

const TWO = [
  { name: '每日能耗', unit: 'kWh' },
  { name: '每日达标率', unit: '%' },
]

const JAN_5 = Date.UTC(2026, 0, 5)
const FEB_11 = Date.UTC(2026, 1, 11)

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function seriesRow(...samples: readonly (readonly [number, number])[]) {
  const last = samples[samples.length - 1]
  return {
    series: last === undefined ? null : last[1],
    seriesPoints: samples.map(([at, reading]) => ({ t: at, v: reading })),
  }
}

function readings(...rows: readonly unknown[]): Record<string, unknown> {
  return { [DAY_SLOT_KEY]: [...rows] }
}

async function render(
  config: Record<string, unknown> = {},
  values: Record<string, unknown> = {},
  slots?: Slots,
) {
  const wrapper = mount(Component, {
    props: {
      config: { ...DEFAULTS, timezone: 'UTC', ...config },
      values,
      ...(slots === undefined ? {} : { meta: { slots } }),
    },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

/** 最后画的那一帧的 option。 */
function lastOption(): Record<string, unknown> {
  const calls = echarts.handle.setOption.mock.calls
  return asRecord(calls[calls.length - 1]?.[0])
}

/** 最后画的那一帧的更新口径（全量重建还是只换那几个键）。 */
function lastUpdate(): Record<string, unknown> {
  const calls = echarts.handle.setOption.mock.calls
  return asRecord(calls[calls.length - 1]?.[1])
}

function titles(): unknown[] {
  return asArray(lastOption().title).map((item) => asRecord(item).text)
}

beforeEach(() => {
  echarts.createChart.mockClear()
  echarts.handle.setOption.mockClear()
  echarts.handle.onClick.mockClear()
  echarts.handle.dispose.mockClear()
})

describe('骨架', () => {
  it('标题交给共用面板，留空则整条标题栏不出', async () => {
    const values = readings(seriesRow([JAN_5, 12]))
    const titled = await render({ title: '每日能耗' }, values)

    expect(titled.text()).toContain('每日能耗')

    const bare = await render({}, values)

    expect(bare.find('.module-title-bar').exists()).toBe(false)
    titled.unmount()
    bare.unmount()
  })

  it('一张都没配来源时出空态，文案可换', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO, emptyText: '未接台账' },
      {},
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe('未接台账')
    wrapper.unmount()
  })

  it('配了却一天都没取到时逐张说明原因，而不是一句「暂无数据」', async () => {
    const wrapper = await render({ [METRIC_ITEMS_KEY]: TWO }, readings(), {
      [metricFieldKey(0)]: { state: 'error' },
      [metricFieldKey(1)]: { state: 'pending' },
    })
    const text = wrapper.get('.dt-chart__empty').text()

    expect(text).toContain(CALENDAR_BLANK_TEXT)
    expect(text).toContain('每日能耗（取不到）')
    expect(text).toContain('每日达标率（等首帧）')
    wrapper.unmount()
  })

  it('时区认不出时整块出一句说得出原因的空态，不悄悄按本地折日', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO, timezone: 'Mars/Olympus' },
      readings(seriesRow([JAN_5, 12])),
      { [metricFieldKey(0)]: { state: 'ok' } },
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe(
      timezoneFaultText('Mars/Olympus'),
    )
    wrapper.unmount()
  })

  it('接到一部分就不算空态', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO },
      readings(seriesRow([JAN_5, 12], [FEB_11, 30])),
      {
        [metricFieldKey(0)]: { state: 'ok' },
        [metricFieldKey(1)]: { state: 'pending' },
      },
    )

    expect(wrapper.find('.dt-chart__empty').exists()).toBe(false)
    wrapper.unmount()
  })

  it('图区挂着一段读屏摘要；一张都没配时连属性一起省掉', async () => {
    const drawn = await render(
      { [METRIC_ITEMS_KEY]: TWO },
      readings(seriesRow([JAN_5, 12], [FEB_11, 30])),
    )

    expect(drawn.get('.dt-chart__canvas').attributes('aria-label')).toContain(
      '共 1 张',
    )

    const blank = await render({ [METRIC_ITEMS_KEY]: TWO }, {})

    expect(
      blank.get('.dt-chart__canvas').attributes('aria-label'),
    ).toBeUndefined()
    drawn.unmount()
    blank.unmount()
  })
})

describe('四张先接一张', () => {
  it('取不到的那张框照建、格子给空，标题上说清原因', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO },
      readings(seriesRow([JAN_5, 12], [FEB_11, 30])),
      {
        [metricFieldKey(0)]: { state: 'ok' },
        [metricFieldKey(1)]: { state: 'error' },
      },
    )

    expect(titles()).toEqual(['每日能耗 · kWh', '每日达标率 · %（取不到）'])
    expect(asArray(lastOption().calendar)).toHaveLength(2)
    expect(asArray(asRecord(asArray(lastOption().series)[1]).data)).toEqual([])
    wrapper.unmount()
  })

  it('没配来源的那张连标题都不列', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO },
      readings(seriesRow([JAN_5, 12], [FEB_11, 30])),
      { [metricFieldKey(0)]: { state: 'ok' } },
    )

    expect(titles()).toEqual(['每日能耗 · kWh'])
    wrapper.unmount()
  })

  it('触顶那张的标题上写清取回的是哪一段', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO },
      readings(seriesRow([JAN_5, 12], [FEB_11, 30])),
      { [metricFieldKey(0)]: { state: 'ok', isTruncated: true } },
    )

    expect(String(titles()[0])).toContain('只到 2026-01-05 至 2026-02-11')
    wrapper.unmount()
  })
})

describe('刷新口径', () => {
  it('值变把标题与那几套坐标一起替换，跨度因此不会停在第一帧', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO },
      readings(seriesRow([JAN_5, 12])),
      { [metricFieldKey(0)]: { state: 'ok' } },
    )

    await wrapper.setProps({
      values: readings(seriesRow([JAN_5, 12], [FEB_11, 30])),
    })
    await flushPromises()

    expect(lastUpdate().replaceMerge).toEqual([
      'series',
      'title',
      'calendar',
      'visualMap',
      'grid',
      'xAxis',
      'yAxis',
    ])
    expect(asRecord(asArray(lastOption().calendar)[0]).range).toEqual([
      '2026-01-05',
      '2026-02-11',
    ])
    wrapper.unmount()
  })

  it('配置变走全量重建：换肤与坐标、色标的颜色只能整图重算', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO },
      readings(seriesRow([JAN_5, 12])),
    )

    await wrapper.setProps({
      config: {
        ...DEFAULTS,
        timezone: 'UTC',
        [METRIC_ITEMS_KEY]: TWO,
        chartStyle: 'matrix',
      },
    })
    await flushPromises()

    expect(lastUpdate().notMerge).toBe(true)
    expect(asArray(lastOption().grid)).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('交互与释放', () => {
  it('点某一格上抛那张日历配置里的名称', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO },
      readings(seriesRow([JAN_5, 12]), seriesRow([FEB_11, 30])),
    )
    const handler: unknown = echarts.handle.onClick.mock.calls[0]?.[0]
    const stopPropagation = vi.fn()

    if (typeof handler === 'function') {
      ;(handler as (raw: unknown) => void)({
        seriesIndex: 1,
        value: ['2026-02-11', 30],
        event: { event: { stopPropagation } },
      })
    }

    expect(wrapper.emitted('interaction')?.[0]).toEqual([
      { event: 'click', value: '每日达标率' },
    ])
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('卸载时实例真的被释放，大屏开几天才不会越用越卡', async () => {
    const wrapper = await render(
      { [METRIC_ITEMS_KEY]: TWO },
      readings(seriesRow([JAN_5, 12])),
    )

    wrapper.unmount()

    expect(echarts.handle.dispose).toHaveBeenCalled()
  })
})
