/**
 * @fileoverview 守对比柱图整块的渲染：标题走共用面板、六组先接两组时只画那两组、
 * 逐行状态落在图例与 series 两处、实时档与历史档铺出两套不同形状的类目轴、
 * 一格都画不出来时的两句空态、值变只替换 series/legend 两个键、
 * 点某一根柱上抛它那一组的名称，以及卸载时实例真的被释放。
 *
 * ⚠ 逐行四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 在**本模块**上打桩，不去 mock echarts 包本身（testing-standard-typescript §5.2）。
 * ⚠ 本文件断言的是 option 的形状；「这份合法的 option 交给真 echarts 之后画得出来没有」
 * 由 legendSsr.spec.ts 那一条拿真 echarts 跑 SSR 的用例守。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BAR_HISTORY_EMPTY_TEXT,
  BAR_ITEMS_KEY,
  BAR_SERIES_FIELD,
  BAR_SLOT_KEY,
  BAR_VALUE_FIELD,
  barFieldKey,
} from '../../../src/modules/bar-chart/bars'
import Component from '../../../src/modules/bar-chart/Component.vue'
import manifest from '../../../src/modules/bar-chart/manifest'
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

const HOUR = 3_600_000
const BASE = new Date(2026, 2, 4, 9, 0, 0).getTime()

type Slots = Record<string, ModuleSlotMeta>

const THREE = [
  { name: '1# 线', unit: 't' },
  { name: '2# 线', unit: 't' },
  { name: '3# 线', unit: 't' },
]

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readings(...numbers: unknown[]): Record<string, unknown> {
  return { [BAR_SLOT_KEY]: numbers.map((value) => ({ value })) }
}

function series(
  ...rows: (readonly { t: number; v: unknown }[])[]
): Record<string, unknown> {
  return {
    [BAR_SLOT_KEY]: rows.map((points) => ({
      [`${BAR_SERIES_FIELD}Points`]: points,
    })),
  }
}

/** 逐行都绑上某个子槽的 slots 表。 */
function bound(field: string, ...states: ModuleSlotMeta['state'][]): Slots {
  const slots: Slots = {}
  states.forEach((state, index) => {
    slots[barFieldKey(index, field)] = { state }
  })
  return slots
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

function categories(): unknown[] {
  return asArray(asRecord(asArray(lastOption().xAxis)[0]).data)
}

beforeEach(() => {
  echarts.createChart.mockClear()
  echarts.handle.setOption.mockClear()
  echarts.handle.onClick.mockClear()
  echarts.handle.dispose.mockClear()
})

describe('骨架', () => {
  it('标题交给共用面板，留空则整条标题栏不出', async () => {
    const titled = await render({ title: '产量对比' }, readings(1))

    expect(titled.text()).toContain('产量对比')

    const bare = await render({}, readings(1))

    expect(bare.find('.module-title-bar').exists()).toBe(false)
    titled.unmount()
    bare.unmount()
  })

  it('一格都画不出来时出空态，文案可换', async () => {
    const wrapper = await render(
      { [BAR_ITEMS_KEY]: THREE, emptyText: '未接点位' },
      readings(1, 2, 3),
      bound(BAR_VALUE_FIELD, 'pending', 'error', 'pending'),
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe('未接点位')
    wrapper.unmount()
  })

  it('历史档整块取不到时另说一句：公开大屏本来就不提供历史数据', async () => {
    const wrapper = await render(
      { [BAR_ITEMS_KEY]: THREE, valueSource: 'history', emptyText: '' },
      series([], []),
      bound(BAR_SERIES_FIELD, 'error', 'error'),
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe(BAR_HISTORY_EMPTY_TEXT)
    wrapper.unmount()
  })

  it('接到一部分就不算空态', async () => {
    const wrapper = await render(
      { [BAR_ITEMS_KEY]: THREE },
      readings(1),
      bound(BAR_VALUE_FIELD, 'ok', 'pending'),
    )

    expect(wrapper.find('.dt-chart__empty').exists()).toBe(false)
    wrapper.unmount()
  })

  it('图区挂着一段读屏摘要；画不出东西时连属性一起省掉', async () => {
    const drawn = await render({ [BAR_ITEMS_KEY]: THREE }, readings(75, 25))

    expect(drawn.get('.dt-chart__canvas').attributes('aria-label')).toContain(
      '共 2 组',
    )

    const blank = await render({ [BAR_ITEMS_KEY]: THREE }, {})

    expect(
      blank.get('.dt-chart__canvas').attributes('aria-label'),
    ).toBeUndefined()
    drawn.unmount()
    blank.unmount()
  })
})

describe('六组先接两组', () => {
  it('实时档：类目是接到的那两组的名字，一组只在自己那一格上有读数', async () => {
    const wrapper = await render(
      { [BAR_ITEMS_KEY]: THREE },
      readings(30, 10, undefined),
      bound(BAR_VALUE_FIELD, 'ok', 'ok'),
    )

    expect(categories()).toEqual(['1# 线', '2# 线'])
    expect(
      asArray(lastOption().series).map((item) => asRecord(item).data),
    ).toEqual([
      [30, null],
      [null, 10],
    ])
    wrapper.unmount()
  })

  it('没配来源的那几组连图例都不列，配了没数的仍列着且名字对得上 series', async () => {
    const wrapper = await render(
      { [BAR_ITEMS_KEY]: THREE, showLegend: true },
      readings(30),
      bound(BAR_VALUE_FIELD, 'ok', 'error'),
    )
    const legend = asArray(asRecord(lastOption().legend).data).map(
      (item) => asRecord(item).name,
    )

    expect(legend).toEqual(['1# 线', '2# 线（取不到）'])
    // 图例条的名字对不上任何一个 series.name 就连图元都不会被创建，那一档状态因此静默消失
    expect(seriesNames()).toEqual(legend)
    wrapper.unmount()
  })
})

describe('两档铺出两套不同形状的类目轴', () => {
  it('历史档：类目是几组时刻的并集，不是各组的名字', async () => {
    const wrapper = await render(
      { [BAR_ITEMS_KEY]: THREE, valueSource: 'history' },
      series(
        [
          { t: BASE, v: 1 },
          { t: BASE + HOUR, v: 2 },
        ],
        [{ t: BASE + HOUR, v: 3 }],
      ),
      bound(BAR_SERIES_FIELD, 'ok', 'ok'),
    )

    expect(categories()).toEqual(['09:00', '10:00'])
    expect(
      asArray(lastOption().series).map((item) => asRecord(item).data),
    ).toEqual([
      [1, 2],
      [null, 3],
    ])
    wrapper.unmount()
  })

  it('换一档取数来源要整图重建：两档的轴与系列根本不是同一个形状', async () => {
    const wrapper = await render(
      { [BAR_ITEMS_KEY]: THREE },
      readings(30, 10),
      bound(BAR_VALUE_FIELD, 'ok', 'ok'),
    )

    await wrapper.setProps({
      config: { ...DEFAULTS, [BAR_ITEMS_KEY]: THREE, valueSource: 'history' },
    })
    await flushPromises()

    expect(lastUpdate().notMerge).toBe(true)
    wrapper.unmount()
  })
})

describe('刷新口径', () => {
  it('值变只替换 series / legend 两个键', async () => {
    const wrapper = await render({ [BAR_ITEMS_KEY]: THREE }, readings(30, 10))

    await wrapper.setProps({ values: readings(20, 20) })
    await flushPromises()

    expect(lastUpdate().replaceMerge).toEqual(['series', 'legend'])
    expect(lastUpdate().notMerge).toBeUndefined()
    wrapper.unmount()
  })

  it('从等首帧变成有数时图例后缀跟着变，不停在第一帧上', async () => {
    const wrapper = await render(
      { [BAR_ITEMS_KEY]: THREE, showLegend: true },
      readings(30),
      bound(BAR_VALUE_FIELD, 'pending'),
    )

    expect(seriesNames()).toEqual(['1# 线（等首帧）'])

    await wrapper.setProps({ meta: { slots: bound(BAR_VALUE_FIELD, 'ok') } })
    await flushPromises()

    expect(seriesNames()).toEqual(['1# 线'])
    wrapper.unmount()
  })
})

describe('交互与释放', () => {
  it('点某一根柱上抛它那一组配置里的名称，不是带后缀的图例名', async () => {
    const wrapper = await render(
      { [BAR_ITEMS_KEY]: [{ name: '甲' }, { name: '甲' }] },
      readings(30, 10),
    )
    const handler: unknown = echarts.handle.onClick.mock.calls[0]?.[0]
    const stopPropagation = vi.fn()

    if (typeof handler === 'function') {
      ;(handler as (raw: unknown) => void)({
        seriesIndex: 1,
        dataIndex: 1,
        name: '甲#1',
        event: { event: { stopPropagation } },
      })
    }

    expect(wrapper.emitted('interaction')?.[0]).toEqual([
      { event: 'click', value: '甲' },
    ])
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('卸载时实例真的被释放，大屏开几天才不会越用越卡', async () => {
    const wrapper = await render({ [BAR_ITEMS_KEY]: THREE }, readings(30, 10))

    wrapper.unmount()

    expect(echarts.handle.dispose).toHaveBeenCalled()
  })
})
