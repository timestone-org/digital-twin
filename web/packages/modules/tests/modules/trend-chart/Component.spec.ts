/**
 * @fileoverview 守趋势曲线整块的渲染：标题走共用面板、六条先接两条时另外几条照常
 * 进 option 只是没线、三种空态各出各的文案、值变只替换 series/legend 两个键、
 * 点某一条线上抛它配置里的名称，以及卸载时实例真的被释放。
 *
 * ⚠ 逐条四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 在**本模块**上打桩，不去 mock echarts 包本身（testing-standard-typescript §5.2）。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/trend-chart/Component.vue'
import manifest from '../../../src/modules/trend-chart/manifest'
import {
  historyFieldKey,
  SERIES_ITEMS_KEY,
  SERIES_SLOT_KEY,
  TREND_NO_HISTORY_TEXT,
  TREND_NO_POINTS_TEXT,
} from '../../../src/modules/trend-chart/series'
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
  { name: '进水', unit: '℃' },
  { name: '回水', unit: '℃' },
]

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 一行的注入值：末值标量 + 同一行的伴生序列键。 */
function line(...numbers: number[]): Record<string, unknown> {
  return {
    series: numbers.at(-1),
    seriesPoints: numbers.map((v, index) => ({
      t: 1_700_000_000_000 + index * 60_000,
      v,
    })),
  }
}

function rows(...items: Record<string, unknown>[]): Record<string, unknown> {
  return { [SERIES_SLOT_KEY]: items }
}

async function render(
  config: Record<string, unknown> = {},
  values: Record<string, unknown> = {},
  slots?: Slots,
) {
  const wrapper = mount(Component, {
    props: {
      config: { ...DEFAULTS, ...config },
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

function seriesNames(): unknown[] {
  return asArray(lastOption().series).map((item) => asRecord(item).name)
}

beforeEach(() => {
  echarts.createChart.mockClear()
  echarts.handle.setOption.mockClear()
  echarts.handle.onClick.mockClear()
  echarts.handle.dispose.mockClear()
})

describe('骨架', () => {
  it('标题交给共用面板，留空则整条标题栏不出', async () => {
    const titled = await render({ title: '换热站温度' }, rows(line(1, 2)), {
      [historyFieldKey(0)]: { state: 'ok' },
    })

    expect(titled.text()).toContain('换热站温度')

    const bare = await render({}, rows(line(1, 2)), {
      [historyFieldKey(0)]: { state: 'ok' },
    })

    expect(bare.find('.module-title-bar').exists()).toBe(false)
    titled.unmount()
    bare.unmount()
  })

  it('图区挂着一段读屏摘要；画不出东西时连属性一起省掉', async () => {
    const drawn = await render({ [SERIES_ITEMS_KEY]: TWO }, rows(line(1, 2)), {
      [historyFieldKey(0)]: { state: 'ok' },
    })

    expect(drawn.get('.dt-chart__canvas').attributes('aria-label')).toContain(
      '共 1 条',
    )

    const blank = await render({ [SERIES_ITEMS_KEY]: TWO }, {})

    expect(
      blank.get('.dt-chart__canvas').attributes('aria-label'),
    ).toBeUndefined()
    drawn.unmount()
    blank.unmount()
  })
})

describe('三种空态各出各的文案', () => {
  it('还没接上时出可换的那一句', async () => {
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: TWO, emptyText: '未接点位' },
      rows(line(1), line(2)),
      {
        [historyFieldKey(0)]: { state: 'pending' },
        [historyFieldKey(1)]: { state: 'pending' },
      },
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe('未接点位')
    wrapper.unmount()
  })

  it('这一页没装历史取数时另说一句，不用通用的暂无数据', async () => {
    const refusal = '序列要异步取数，画布上不展开'
    const wrapper = await render({ [SERIES_ITEMS_KEY]: TWO }, rows({}, {}), {
      [historyFieldKey(0)]: { state: 'error', message: refusal },
      [historyFieldKey(1)]: { state: 'error', message: refusal },
    })

    expect(wrapper.get('.dt-chart__empty').text()).toBe(TREND_NO_HISTORY_TEXT)
    wrapper.unmount()
  })

  it('取到了但窗内没有点，再说一句不一样的', async () => {
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: TWO },
      rows({ series: null, seriesPoints: [] }),
      { [historyFieldKey(0)]: { state: 'ok' } },
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe(TREND_NO_POINTS_TEXT)
    wrapper.unmount()
  })

  it('接到一部分就不算空态', async () => {
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: TWO },
      rows(line(1, 2), {}),
      {
        [historyFieldKey(0)]: { state: 'ok' },
        [historyFieldKey(1)]: { state: 'pending' },
      },
    )

    expect(wrapper.find('.dt-chart__empty').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('六条先接两条', () => {
  it('没数的那几条照常进 option，图例才认得出它们', async () => {
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: TWO, showLegend: true },
      rows(line(1, 2), {}),
      {
        [historyFieldKey(0)]: { state: 'ok' },
        [historyFieldKey(1)]: { state: 'error' },
      },
    )

    expect(seriesNames()).toEqual(['进水', '回水（取不到）'])
    expect(
      asArray(asRecord(lastOption().legend).data).map(
        (item) => asRecord(item).name,
      ),
    ).toEqual(seriesNames())
    wrapper.unmount()
  })

  it('没配来源的那几条连图例都不列', async () => {
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: TWO, showLegend: true },
      rows(line(1, 2)),
      { [historyFieldKey(0)]: { state: 'ok' } },
    )

    expect(seriesNames()).toEqual(['进水'])
    wrapper.unmount()
  })
})

describe('刷新口径', () => {
  it('值变只替换 series / legend 两个键', async () => {
    const slots = { [historyFieldKey(0)]: { state: 'ok' as const } }
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: TWO },
      rows(line(1, 2)),
      slots,
    )

    await wrapper.setProps({ values: rows(line(1, 2, 3)) })
    await flushPromises()

    expect(lastUpdate().replaceMerge).toEqual(['series', 'legend'])
    expect(lastUpdate().notMerge).toBeUndefined()
    wrapper.unmount()
  })

  it('末点一变签名就变，曲线跟着重画', async () => {
    const slots = { [historyFieldKey(0)]: { state: 'ok' as const } }
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: TWO },
      rows(line(1, 2)),
      slots,
    )
    const before = echarts.handle.setOption.mock.calls.length

    await wrapper.setProps({ values: rows(line(1, 9)) })
    await flushPromises()

    expect(echarts.handle.setOption.mock.calls.length).toBeGreaterThan(before)
    expect(
      asArray(asRecord(asArray(lastOption().series)[0]).data).at(-1),
    ).toEqual([1_700_000_060_000, 9])
    wrapper.unmount()
  })

  it('配置变走全量重建：换肤与轴、图例的颜色只能整图重算', async () => {
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: TWO },
      rows(line(1, 2)),
      { [historyFieldKey(0)]: { state: 'ok' } },
    )

    await wrapper.setProps({
      config: { ...DEFAULTS, [SERIES_ITEMS_KEY]: TWO, chartStyle: 'area' },
    })
    await flushPromises()

    expect(lastUpdate().notMerge).toBe(true)
    wrapper.unmount()
  })
})

describe('交互与释放', () => {
  it('点某一条线上抛它配置里的名称，不是带去重后缀的图例名', async () => {
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: [{ name: '进水' }, { name: '进水' }] },
      rows(line(1, 2), line(3, 4)),
      {
        [historyFieldKey(0)]: { state: 'ok' },
        [historyFieldKey(1)]: { state: 'ok' },
      },
    )
    const handler: unknown = echarts.handle.onClick.mock.calls[0]?.[0]
    const stopPropagation = vi.fn()

    if (typeof handler === 'function') {
      ;(handler as (raw: unknown) => void)({
        seriesIndex: 1,
        seriesName: '进水#1',
        event: { event: { stopPropagation } },
      })
    }

    expect(wrapper.emitted('interaction')?.[0]).toEqual([
      { event: 'click', value: '进水' },
    ])
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('卸载时实例真的被释放，大屏开几天才不会越用越卡', async () => {
    const wrapper = await render(
      { [SERIES_ITEMS_KEY]: TWO },
      rows(line(1, 2)),
      { [historyFieldKey(0)]: { state: 'ok' } },
    )

    wrapper.unmount()

    expect(echarts.handle.dispose).toHaveBeenCalled()
  })
})
