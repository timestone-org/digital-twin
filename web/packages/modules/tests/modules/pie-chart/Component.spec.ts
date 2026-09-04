/**
 * @fileoverview 守构成环图整块的渲染：标题走共用面板、六片先接两片时只画那两片且
 * 分母只算它们、逐片状态落在图例与扇区数据两处（名字对不上那一条图例就不会被创建）、
 * 一片都画不出来与读数全是 0 各出各的空态、值变只替换 series/legend/title 三个键
 * （环心读数因此不会停在第一帧）、点某一片上抛它配置里的名称，以及卸载时实例真的被释放。
 *
 * ⚠ 逐片四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 在**本模块**上打桩，不去 mock echarts 包本身（testing-standard-typescript §5.2）。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/pie-chart/Component.vue'
import manifest from '../../../src/modules/pie-chart/manifest'
import {
  PIE_ZERO_TEXT,
  SLICE_ITEMS_KEY,
  SLICE_SLOT_KEY,
  sliceFieldKey,
} from '../../../src/modules/pie-chart/slices'
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

const THREE = [
  { name: '光伏', unit: 'kWh' },
  { name: '市电', unit: 'kWh' },
  { name: '储能', unit: 'kWh' },
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
  return { [SLICE_SLOT_KEY]: numbers.map((value) => ({ value })) }
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

function sliceNames(): unknown[] {
  const series = asRecord(asArray(lastOption().series)[0])
  return asArray(series.data).map((item) => asRecord(item).name)
}

beforeEach(() => {
  echarts.createChart.mockClear()
  echarts.handle.setOption.mockClear()
  echarts.handle.onClick.mockClear()
  echarts.handle.dispose.mockClear()
})

describe('骨架', () => {
  it('标题交给共用面板，留空则整条标题栏不出', async () => {
    const titled = await render({ title: '能源构成' }, readings(1))

    expect(titled.text()).toContain('能源构成')

    const bare = await render({}, readings(1))

    expect(bare.find('.module-title-bar').exists()).toBe(false)
    titled.unmount()
    bare.unmount()
  })

  it('一片都画不出来时出空态，文案可换', async () => {
    const wrapper = await render(
      { [SLICE_ITEMS_KEY]: THREE, emptyText: '未接点位' },
      readings(1, 2, 3),
      {
        [sliceFieldKey(0)]: { state: 'pending' },
        [sliceFieldKey(1)]: { state: 'error' },
        [sliceFieldKey(2)]: { state: 'pending' },
      },
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe('未接点位')
    wrapper.unmount()
  })

  it('空态文案被清空时回落一句现成的话，不留一条空白', async () => {
    const wrapper = await render(
      { [SLICE_ITEMS_KEY]: THREE, emptyText: '   ' },
      {},
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe('暂无数据')
    wrapper.unmount()
  })

  it('接到一部分就不算空态', async () => {
    const wrapper = await render({ [SLICE_ITEMS_KEY]: THREE }, readings(1), {
      [sliceFieldKey(0)]: { state: 'ok' },
      [sliceFieldKey(1)]: { state: 'pending' },
    })

    expect(wrapper.find('.dt-chart__empty').exists()).toBe(false)
    wrapper.unmount()
  })

  it('图区挂着一段读屏摘要；画不出东西时连属性一起省掉', async () => {
    const drawn = await render({ [SLICE_ITEMS_KEY]: THREE }, readings(75, 25))

    expect(drawn.get('.dt-chart__canvas').attributes('aria-label')).toContain(
      '共 2 片',
    )

    const blank = await render({ [SLICE_ITEMS_KEY]: THREE }, {})

    expect(
      blank.get('.dt-chart__canvas').attributes('aria-label'),
    ).toBeUndefined()
    drawn.unmount()
    blank.unmount()
  })
})

describe('六片先接两片', () => {
  it('只画接到的那两片，分母也只算它们', async () => {
    const wrapper = await render(
      { [SLICE_ITEMS_KEY]: THREE, showValueLabel: true },
      readings(30, 10, undefined),
      {
        [sliceFieldKey(0)]: { state: 'ok' },
        [sliceFieldKey(1)]: { state: 'ok' },
      },
    )
    const series = asRecord(asArray(lastOption().series)[0])
    const formatter = asRecord(series.label).formatter

    expect(sliceNames()).toEqual(['光伏', '市电'])
    expect(
      typeof formatter === 'function'
        ? String((formatter as (raw: unknown) => unknown)({ dataIndex: 0 }))
        : '',
    ).toContain('75%')
    wrapper.unmount()
  })

  it('没配来源的那几片连图例都不列，配了没数的仍列着', async () => {
    const wrapper = await render(
      { [SLICE_ITEMS_KEY]: THREE, showLegend: true },
      readings(30),
      {
        [sliceFieldKey(0)]: { state: 'ok' },
        [sliceFieldKey(1)]: { state: 'error' },
      },
    )
    const legend = asRecord(lastOption().legend)

    expect(asArray(legend.data).map((item) => asRecord(item).name)).toEqual([
      '光伏',
      '市电（取不到）',
    ])
    // 图例条的名字在扇区数据里找不到就连图元都不会被创建，那一档状态因此静默消失
    expect(sliceNames()).toEqual(['光伏', '市电（取不到）'])
    wrapper.unmount()
  })

  it('读数全是 0 时另说一句：占比没有分母，一片也画不出来', async () => {
    const wrapper = await render(
      { [SLICE_ITEMS_KEY]: THREE, emptyText: '未接点位' },
      readings(0, 0),
      {
        [sliceFieldKey(0)]: { state: 'ok' },
        [sliceFieldKey(1)]: { state: 'ok' },
      },
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe(PIE_ZERO_TEXT)
    wrapper.unmount()
  })

  it('负值那一片不进扇区，图例上说明原因', async () => {
    const wrapper = await render(
      { [SLICE_ITEMS_KEY]: THREE, showLegend: true },
      readings(60, -40, 40),
    )

    expect(sliceNames()).toEqual(['光伏', '市电（负值不计）', '储能'])
    expect(
      asArray(asRecord(lastOption().legend).data).map(
        (item) => asRecord(item).name,
      ),
    ).toContain('市电（负值不计）')
    wrapper.unmount()
  })
})

describe('刷新口径', () => {
  it('值变只替换 series / legend / title 三个键', async () => {
    const wrapper = await render({ [SLICE_ITEMS_KEY]: THREE }, readings(30, 10))

    await wrapper.setProps({ values: readings(20, 20) })
    await flushPromises()

    expect(lastUpdate().replaceMerge).toEqual(['series', 'legend', 'title'])
    expect(lastUpdate().notMerge).toBeUndefined()
    wrapper.unmount()
  })

  it('环心读数跟着值走，不停在第一帧上', async () => {
    const config = {
      [SLICE_ITEMS_KEY]: THREE,
      chartStyle: 'donut',
      centerText: 'sum',
      precision: 0,
    }
    const wrapper = await render(config, readings(30, 10))

    expect(asRecord(lastOption().title).text).toBe('40')

    await wrapper.setProps({ values: readings(50, 20) })
    await flushPromises()

    expect(asRecord(lastOption().title).text).toBe('70')
    wrapper.unmount()
  })

  it('配置变走全量重建：换肤与轴、图例的颜色只能整图重算', async () => {
    const wrapper = await render({ [SLICE_ITEMS_KEY]: THREE }, readings(30, 10))

    await wrapper.setProps({
      config: { ...DEFAULTS, [SLICE_ITEMS_KEY]: THREE, chartStyle: 'rose' },
    })
    await flushPromises()

    expect(lastUpdate().notMerge).toBe(true)
    wrapper.unmount()
  })
})

describe('交互与释放', () => {
  it('点某一片上抛它配置里的名称，不是带后缀的图例名', async () => {
    const wrapper = await render(
      { [SLICE_ITEMS_KEY]: [{ name: '光伏' }, { name: '光伏' }] },
      readings(30, 10),
    )
    const handler: unknown = echarts.handle.onClick.mock.calls[0]?.[0]
    const stopPropagation = vi.fn()

    if (typeof handler === 'function') {
      ;(handler as (raw: unknown) => void)({
        dataIndex: 1,
        name: '光伏#1',
        event: { event: { stopPropagation } },
      })
    }

    expect(wrapper.emitted('interaction')?.[0]).toEqual([
      { event: 'click', value: '光伏' },
    ])
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('卸载时实例真的被释放，大屏开几天才不会越用越卡', async () => {
    const wrapper = await render({ [SLICE_ITEMS_KEY]: THREE }, readings(30, 10))

    wrapper.unmount()

    expect(echarts.handle.dispose).toHaveBeenCalled()
  })
})
