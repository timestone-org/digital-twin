/**
 * @fileoverview 守图表挂载的生命周期：结构变全量重建、值变只换 series、换肤整图重绘、
 * 容器出现/消失跟着建与放（不泄漏实例），以及点击上抛的是联动契约里的那个事件。
 * ⚠ 打桩打在装配点 `shared/chart/echarts` 上，不 mock echarts 包本身。
 */
import type { InteractionEvent } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref, type PropType } from 'vue'

import type { ECOption } from '../../../src/shared/chart/echarts'
import {
  useEChart,
  type UseEChartOptions,
} from '../../../src/shared/chart/useEChart'

const echarts = vi.hoisted(() => {
  const newHandle = (host: HTMLElement) => ({
    host,
    setOption: vi.fn((option: unknown, update: unknown) => [option, update]),
    onClick: vi.fn((handler: (params: unknown) => void) => handler),
    resize: vi.fn(),
    dispose: vi.fn(),
  })
  const handles: ReturnType<typeof newHandle>[] = []
  const createChart = vi.fn((host: HTMLElement) => {
    const handle = newHandle(host)
    handles.push(handle)
    return Promise.resolve(handle)
  })
  return { createChart, handles, newHandle }
})

vi.mock('../../../src/shared/chart/echarts', () => ({
  createChart: echarts.createChart,
}))

/** 最近一次建出来的实例；一个都没有就是没建。 */
function lastHandle() {
  const handle = echarts.handles.at(-1)
  if (!handle) throw new Error('还没有建出实例')
  return handle
}

/** 最近一次 setOption 的口径。 */
function lastUpdate(handle = lastHandle()): unknown {
  return handle.setOption.mock.calls.at(-1)?.[1]
}

interface ChartHooks {
  build?: (full: boolean) => ECOption
  partialMerge?: string[]
  valuesDeep?: boolean
  onItemClick?: (event: InteractionEvent) => void
  itemValueOf?: (params: unknown) => string
}

const Host = defineComponent({
  props: {
    config: {
      type: Object as PropType<Record<string, unknown>>,
      default: () => ({}),
    },
    values: {
      type: Object as PropType<Record<string, unknown>>,
      default: () => ({}),
    },
    hasChart: { type: Boolean, default: true },
    hooks: { type: Object as PropType<ChartHooks>, default: () => ({}) },
  },
  setup(props) {
    const rootRef = ref<HTMLElement | null>(null)
    const chartRef = ref<HTMLElement | null>(null)
    // 与 ChartShell 一样，钩子只在挂载时读一次
    const options = (): UseEChartOptions => ({
      rootRef,
      chartRef,
      build: props.hooks.build ?? (() => ({ series: [] })),
      watchConfig: () => props.config,
      watchValues: () => props.values,
      partialMerge: props.hooks.partialMerge,
      valuesDeep: props.hooks.valuesDeep,
      onItemClick: props.hooks.onItemClick,
      itemValueOf: props.hooks.itemValueOf,
    })
    useEChart(options())
    return { rootRef, chartRef }
  },
  template:
    '<div ref="rootRef"><div v-if="hasChart" ref="chartRef" class="canvas" /></div>',
})

async function mountChart(props: Record<string, unknown> = {}) {
  const wrapper = mount(Host, { props, attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  echarts.handles.length = 0
  echarts.createChart.mockClear()
})

afterEach(() => {
  document.body.removeAttribute('style')
})

describe('挂载与释放', () => {
  it('挂载后在图区元素上建实例并画首帧全量', async () => {
    const wrapper = await mountChart()

    expect(echarts.createChart).toHaveBeenCalledTimes(1)
    expect(echarts.createChart.mock.calls[0]?.[0]).toBe(
      wrapper.get('.canvas').element,
    )
    expect(lastUpdate()).toEqual({ notMerge: true })

    wrapper.unmount()
  })

  it('卸载后释放实例——大屏一开就是几天，留一个就是一次泄漏', async () => {
    const wrapper = await mountChart()
    const handle = lastHandle()

    wrapper.unmount()

    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })

  it('图区容器缺席时不建实例', async () => {
    const wrapper = await mountChart({ hasChart: false })

    expect(echarts.createChart).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('容器后来才出现也补得上——否则之后的变更全是静默 no-op', async () => {
    const wrapper = await mountChart({ hasChart: false })

    await wrapper.setProps({ hasChart: true })
    await flushPromises()

    expect(echarts.createChart).toHaveBeenCalledTimes(1)
    expect(lastUpdate()).toEqual({ notMerge: true })

    wrapper.unmount()
  })

  it('容器消失时释放实例', async () => {
    const wrapper = await mountChart()
    const handle = lastHandle()

    await wrapper.setProps({ hasChart: false })
    await flushPromises()

    expect(handle.dispose).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('建实例期间被卸载时，回来的实例当场扔掉', async () => {
    const handle = echarts.newHandle(document.createElement('div'))
    let settle: () => void = () => {}
    echarts.createChart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = () => resolve(handle)
        }),
    )

    const wrapper = mount(Host, { attachTo: document.body })
    wrapper.unmount()
    settle()
    await flushPromises()

    expect(handle.dispose).toHaveBeenCalledTimes(1)
    expect(handle.setOption).not.toHaveBeenCalled()
  })
})

describe('刷新口径', () => {
  it('配置变了全量重建——结构与配色都要重算', async () => {
    const wrapper = await mountChart({ config: { title: '甲' } })

    await wrapper.setProps({ config: { title: '乙' } })

    expect(lastUpdate()).toEqual({ notMerge: true })

    wrapper.unmount()
  })

  it('值变了只换 series，保住数值过渡动画', async () => {
    const wrapper = await mountChart({ values: { a: 1 } })

    await wrapper.setProps({ values: { a: 2 } })

    expect(lastUpdate()).toEqual({ replaceMerge: ['series'] })

    wrapper.unmount()
  })

  it('要换的键可以由族指定', async () => {
    const wrapper = await mountChart({
      values: { a: 1 },
      hooks: { partialMerge: ['series', 'xAxis'] },
    })

    await wrapper.setProps({ values: { a: 2 } })

    expect(lastUpdate()).toEqual({ replaceMerge: ['series', 'xAxis'] })

    wrapper.unmount()
  })

  it('build 拿得到「这次是不是全量」', async () => {
    const build = vi.fn((full: boolean): ECOption => ({
      series: full ? [] : [{ type: 'line' }],
    }))
    const wrapper = await mountChart({ values: { a: 1 }, hooks: { build } })

    await wrapper.setProps({ values: { a: 2 } })

    expect(build.mock.calls.map((call) => call[0])).toEqual([true, false])

    wrapper.unmount()
  })

  it('换肤后整图重绘——只换 series 改不掉轴与图例的颜色', async () => {
    const wrapper = await mountChart()
    const handle = lastHandle()
    handle.setOption.mockClear()

    document.body.style.setProperty('--accent-primary', 'red')
    await vi.waitFor(() => expect(handle.setOption).toHaveBeenCalled())

    expect(lastUpdate(handle)).toEqual({ notMerge: true })

    wrapper.unmount()
  })
})

describe('图元点击', () => {
  /** 造一次 echarts 的点击回调入参。 */
  function clickParams(patch: Record<string, unknown> = {}) {
    return {
      name: '甲线',
      seriesName: '功率',
      event: { event: { stopPropagation: vi.fn() } },
      ...patch,
    }
  }

  it('不传回调就不注册点击', async () => {
    const wrapper = await mountChart()

    expect(lastHandle().onClick).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('点到图元上抛联动事件，值取类目名', async () => {
    const onItemClick = vi.fn()
    const wrapper = await mountChart({ hooks: { onItemClick } })

    lastHandle().onClick.mock.calls[0]?.[0](clickParams())

    expect(onItemClick).toHaveBeenCalledWith({ event: 'click', value: '甲线' })

    wrapper.unmount()
  })

  it('没有类目名时退回系列名', async () => {
    const onItemClick = vi.fn()
    const wrapper = await mountChart({ hooks: { onItemClick } })

    lastHandle().onClick.mock.calls[0]?.[0](clickParams({ name: '' }))

    expect(onItemClick).toHaveBeenCalledWith({ event: 'click', value: '功率' })

    wrapper.unmount()
  })

  it('取不到名字就不上抛——没有规则用得上一个空值', async () => {
    const onItemClick = vi.fn()
    const wrapper = await mountChart({ hooks: { onItemClick } })

    lastHandle().onClick.mock.calls[0]?.[0](
      clickParams({ name: '', seriesName: '' }),
    )

    expect(onItemClick).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('取值口径可由族覆盖', async () => {
    const onItemClick = vi.fn()
    const wrapper = await mountChart({
      hooks: { onItemClick, itemValueOf: () => '自定义' },
    })

    lastHandle().onClick.mock.calls[0]?.[0](clickParams())

    expect(onItemClick).toHaveBeenCalledWith({
      event: 'click',
      value: '自定义',
    })

    wrapper.unmount()
  })

  it('吞掉这次点击的冒泡——不吞的话「整块可点」会再上抛一个没有值的 click', async () => {
    const onItemClick = vi.fn()
    const wrapper = await mountChart({ hooks: { onItemClick } })
    const params = clickParams()

    lastHandle().onClick.mock.calls[0]?.[0](params)

    expect(params.event.event.stopPropagation).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('实例重建后点击照样接得上', async () => {
    const onItemClick = vi.fn()
    const wrapper = await mountChart({ hooks: { onItemClick } })

    await wrapper.setProps({ hasChart: false })
    await wrapper.setProps({ hasChart: true })
    await flushPromises()
    lastHandle().onClick.mock.calls[0]?.[0](clickParams())

    expect(onItemClick).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})

describe('尺寸跟随', () => {
  // happy-dom 自带的 ResizeObserver 永远不会触发，这里换成 spy 是为了拿到回调
  // 与断言 disconnect，不是为了「让它不报错」。
  it('容器尺寸变了让实例重算，卸载后停止观察', async () => {
    const disconnect = vi.fn()
    const captured: { notify: (() => void) | null } = { notify: null }
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          captured.notify = callback
        }
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = disconnect
      },
    )

    const wrapper = await mountChart()
    captured.notify?.()

    expect(lastHandle().resize).toHaveBeenCalledTimes(1)

    wrapper.unmount()

    expect(disconnect).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
