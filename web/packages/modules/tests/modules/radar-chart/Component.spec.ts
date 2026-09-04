/**
 * @fileoverview 守多维雷达整块的渲染：标题走共用面板、六根轴先接四根时只画那四根、
 * 逐轴状态落在图例与 series 名两处、三种空态各出各的话、值变只替换
 * series/legend/radar 三个键（轮子的轴数因此不会停在第一帧）、点某一条上抛它配置里的
 * 称呼，以及卸载时实例真的被释放。
 *
 * ⚠ 逐轴四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 在**本模块**上打桩，不去 mock echarts 包本身（testing-standard-typescript §5.2）。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AXIS_ITEMS_KEY,
  AXIS_NOTES,
  AXIS_SLOT_KEY,
  axisFieldKey,
  COMPARE_NOTES,
  RADAR_TOO_FEW_TEXT,
} from '../../../src/modules/radar-chart/axes'
import Component from '../../../src/modules/radar-chart/Component.vue'
import manifest from '../../../src/modules/radar-chart/manifest'
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

const FOUR = [
  { name: '能效', min: 0, max: 100, unit: '分' },
  { name: '达标率', min: 0, max: 100, unit: '分' },
  { name: '健康度', min: 0, max: 100, unit: '分' },
  { name: '清洁度', min: 0, max: 100, unit: '分' },
]

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 逐轴喂本组读数；`compare` 逐位补对比组。 */
function readings(
  own: readonly unknown[],
  compare: readonly unknown[] = [],
): Record<string, unknown> {
  return {
    [AXIS_SLOT_KEY]: own.map((value, index) => ({
      value,
      compare: compare[index],
    })),
  }
}

/** 逐轴的 ok 结论，`extra` 覆盖其中几条。 */
function okSlots(count: number, extra: Slots = {}): Slots {
  const slots: Slots = {}
  for (let index = 0; index < count; index += 1) {
    slots[axisFieldKey(index, 'value')] = { state: 'ok' }
  }
  return { ...slots, ...extra }
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

function axisNames(): unknown[] {
  return asArray(asRecord(lastOption().radar).indicator).map(
    (item) => asRecord(item).name,
  )
}

const BASE = { [AXIS_ITEMS_KEY]: FOUR }

beforeEach(() => {
  echarts.createChart.mockClear()
  echarts.handle.setOption.mockClear()
  echarts.handle.onClick.mockClear()
  echarts.handle.dispose.mockClear()
})

describe('骨架', () => {
  it('标题交给共用面板，留空则整条标题栏不出', async () => {
    const titled = await render(
      { ...BASE, title: '绿色工厂评价' },
      readings([80, 90, 70, 60]),
      okSlots(4),
    )

    expect(titled.text()).toContain('绿色工厂评价')

    const bare = await render(BASE, readings([80, 90, 70, 60]), okSlots(4))

    expect(bare.find('.module-title-bar').exists()).toBe(false)
    titled.unmount()
    bare.unmount()
  })

  it('一根轴都没绑时出空态，文案可换', async () => {
    const wrapper = await render({ ...BASE, emptyText: '未接点位' }, {})

    expect(wrapper.get('.dt-chart__empty').text()).toBe('未接点位')
    wrapper.unmount()
  })

  it('绑了但画不出三根轴时另说一句，并逐根列出原因', async () => {
    const wrapper = await render(
      { ...BASE, emptyText: '未接点位' },
      readings([80, 90, 70, 60]),
      okSlots(4, {
        [axisFieldKey(1, 'value')]: { state: 'error' },
        [axisFieldKey(2, 'value')]: { state: 'error' },
      }),
    )

    expect(wrapper.get('.dt-chart__empty').text()).toBe(
      `${RADAR_TOO_FEW_TEXT}：达标率（${AXIS_NOTES.error}）；健康度（${AXIS_NOTES.error}）`,
    )
    wrapper.unmount()
  })

  it('画得出三根就不算空态', async () => {
    const wrapper = await render(
      BASE,
      readings([80, 90, 70, 60]),
      okSlots(4, { [axisFieldKey(3, 'value')]: { state: 'error' } }),
    )

    expect(wrapper.find('.dt-chart__empty').exists()).toBe(false)
    wrapper.unmount()
  })

  it('图区挂着一段读屏摘要；一根轴都没配来源时连属性一起省掉', async () => {
    const drawn = await render(BASE, readings([80, 90, 70, 60]), okSlots(4))

    expect(drawn.get('.dt-chart__canvas').attributes('aria-label')).toContain(
      '共 4 根轴',
    )

    const blank = await render(BASE, {})

    expect(
      blank.get('.dt-chart__canvas').attributes('aria-label'),
    ).toBeUndefined()
    drawn.unmount()
    blank.unmount()
  })
})

describe('六根轴先接四根', () => {
  it('只画接到的那四根，没配来源的两根连图例都不列', async () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        ...FOUR,
        { name: '稳定性', min: 0, max: 100 },
        { name: '连续性', min: 0, max: 100 },
      ],
    }
    const wrapper = await render(
      config,
      readings([80, 90, 70, 60, 50, 40]),
      okSlots(4),
    )

    expect(axisNames()).toEqual(['能效', '达标率', '健康度', '清洁度'])
    expect(seriesNames()).toEqual(['本组'])
    wrapper.unmount()
  })

  it('取不到的那根轴不进轮子，改在图例上说明原因', async () => {
    const config = {
      [AXIS_ITEMS_KEY]: [...FOUR, { name: '稳定性', min: 0, max: 100 }],
    }
    const wrapper = await render(
      config,
      readings([80, 90, 70, 60, 50]),
      okSlots(5, { [axisFieldKey(1, 'value')]: { state: 'error' } }),
    )

    expect(axisNames()).toEqual(['能效', '健康度', '清洁度', '稳定性'])
    expect(seriesNames()).toEqual(['本组', `达标率（${AXIS_NOTES.error}）`])
    // 图例条的名字在 series 名里找不到就连图元都不会被创建，那一档状态因此静默消失
    expect(
      asArray(asRecord(lastOption().legend).data).map(
        (item) => asRecord(item).name,
      ),
    ).toEqual(['本组', `达标率（${AXIS_NOTES.error}）`])
    wrapper.unmount()
  })

  it('量程配错的那根轴同样被剔出轮子，读数没有被夹成一个假的 0', async () => {
    const config = {
      [AXIS_ITEMS_KEY]: [...FOUR, { name: '稳定性', min: 100, max: 0 }],
    }
    const wrapper = await render(
      config,
      readings([80, 90, 70, 60, 50]),
      okSlots(5),
    )
    const first = asRecord(asArray(lastOption().series)[0])

    expect(axisNames()).not.toContain('稳定性')
    expect(asRecord(asArray(first.data)[0]).value).toEqual([80, 90, 70, 60])
    expect(seriesNames()).toContain(`稳定性（${AXIS_NOTES.badRange}）`)
    wrapper.unmount()
  })

  it('对比组缺一根轴的读数就整条不画，图例上说明原因', async () => {
    const wrapper = await render(
      BASE,
      readings([80, 90, 70, 60], [70, 88, undefined, 61]),
      {
        ...okSlots(4),
        [axisFieldKey(0, 'compare')]: { state: 'ok' },
        [axisFieldKey(1, 'compare')]: { state: 'ok' },
        [axisFieldKey(2, 'compare')]: { state: 'ok' },
        [axisFieldKey(3, 'compare')]: { state: 'ok' },
      },
    )

    expect(seriesNames()).toEqual([
      '本组',
      `对比组（${COMPARE_NOTES.missing}）`,
    ])
    expect(asRecord(asArray(lastOption().series)[1]).data).toEqual([])
    wrapper.unmount()
  })
})

describe('刷新口径', () => {
  it('值变只替换 series / legend / radar 三个键', async () => {
    const wrapper = await render(BASE, readings([80, 90, 70, 60]), okSlots(4))

    await wrapper.setProps({ values: readings([81, 90, 70, 60]) })
    await flushPromises()

    expect(lastUpdate().replaceMerge).toEqual(['series', 'legend', 'radar'])
    expect(lastUpdate().notMerge).toBeUndefined()
    wrapper.unmount()
  })

  it('某根轴取不到时轮子跟着少一根，不停在第一帧上', async () => {
    const config = {
      [AXIS_ITEMS_KEY]: [...FOUR, { name: '稳定性', min: 0, max: 100 }],
    }
    const wrapper = await render(
      config,
      readings([80, 90, 70, 60, 50]),
      okSlots(5),
    )

    expect(axisNames().length).toBe(5)

    await wrapper.setProps({
      meta: {
        slots: okSlots(5, {
          [axisFieldKey(4, 'value')]: { state: 'error' },
        }),
      },
    })
    await flushPromises()

    expect(axisNames().length).toBe(4)
    wrapper.unmount()
  })

  it('配置变走全量重建：换肤与轴、图例的颜色只能整图重算', async () => {
    const wrapper = await render(BASE, readings([80, 90, 70, 60]), okSlots(4))

    await wrapper.setProps({
      config: { ...DEFAULTS, ...BASE, shape: 'circle' },
    })
    await flushPromises()

    expect(lastUpdate().notMerge).toBe(true)
    wrapper.unmount()
  })
})

describe('交互与释放', () => {
  it('点某一条上抛它配置里的称呼，不是带原因后缀的图例名', async () => {
    const wrapper = await render(
      { ...BASE, seriesName: '本月', compareName: '去年同期' },
      readings([80, 90, 70, 60], [70, 88, 76, 61]),
      {
        ...okSlots(4),
        [axisFieldKey(0, 'compare')]: { state: 'error' },
      },
    )
    const handler: unknown = echarts.handle.onClick.mock.calls[0]?.[0]
    const stopPropagation = vi.fn()

    if (typeof handler === 'function') {
      ;(handler as (raw: unknown) => void)({
        seriesIndex: 1,
        seriesName: `去年同期（${COMPARE_NOTES.error}）`,
        event: { event: { stopPropagation } },
      })
    }

    expect(wrapper.emitted('interaction')?.[0]).toEqual([
      { event: 'click', value: '去年同期' },
    ])
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('点被剔掉的那根轴对应的空 series 不上抛任何东西', async () => {
    const config = {
      [AXIS_ITEMS_KEY]: [...FOUR, { name: '稳定性', min: 0, max: 100 }],
    }
    const wrapper = await render(
      config,
      readings([80, 90, 70, 60, 50]),
      okSlots(5, { [axisFieldKey(4, 'value')]: { state: 'error' } }),
    )
    const handler: unknown = echarts.handle.onClick.mock.calls[0]?.[0]

    if (typeof handler === 'function') {
      ;(handler as (raw: unknown) => void)({
        seriesIndex: 1,
        event: { event: { stopPropagation: vi.fn() } },
      })
    }

    expect(wrapper.emitted('interaction')).toBeUndefined()
    wrapper.unmount()
  })

  it('卸载时实例真的被释放，大屏开几天才不会越用越卡', async () => {
    const wrapper = await render(BASE, readings([80, 90, 70, 60]), okSlots(4))

    wrapper.unmount()

    expect(echarts.handle.dispose).toHaveBeenCalled()
  })
})
