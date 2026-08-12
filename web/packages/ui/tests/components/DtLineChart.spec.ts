/**
 * @fileoverview 锁住 DtLineChart 的实例生命周期：只 init 一次、换数据只 setOption、
 * 卸载必须 dispose 并断开尺寸监听。
 * ⚠ 打桩打在 `shared/chart/echarts` 这个装配点上，不是 echarts 包本身，
 * 见 testing-standard-typescript §5.2。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DtLineChart from '../../src/components/DtLineChart/DtLineChart.vue'
import type { DtChartOption } from '../../src/shared/chart/lineOption'
import type { DtChartPoint, DtChartSeries } from '../../src/shared/chart/series'

const seam = vi.hoisted(() => {
  const setOption = vi.fn<(option: DtChartOption) => void>()
  const resize = vi.fn()
  const dispose = vi.fn()
  return {
    setOption,
    resize,
    dispose,
    createChart: vi.fn((host: HTMLElement) =>
      Promise.resolve({ host, setOption, resize, dispose }),
    ),
  }
})

vi.mock('../../src/shared/chart/echarts', () => ({
  createChart: seam.createChart,
}))

// ⚠ happy-dom 自带 ResizeObserver，这里换成 **spy** 不是补能力：
// 要拿到回调才能断言尺寸变化真的转成了 resize()，也才能数 disconnect。
let notifySize: (() => void) | null = null
let disconnectCount = 0

class SpyResizeObserver {
  constructor(callback: () => void) {
    notifySize = callback
  }
  observe(): void {
    // 只为记住回调，观察本身不需要做事
  }
  disconnect(): void {
    disconnectCount += 1
  }
}

const AT = '2026-08-12T02:55:00.000Z'

function series(
  key: string,
  axis: string,
  points: readonly DtChartPoint[] = [[AT, 1]],
): DtChartSeries {
  return { key, name: key.toUpperCase(), unit: '℃', axis, points }
}

function optionAt(index: number): DtChartOption | undefined {
  return seam.setOption.mock.calls[index]?.[0]
}

beforeEach(() => {
  notifySize = null
  disconnectCount = 0
  vi.stubGlobal('ResizeObserver', SpyResizeObserver)
  seam.createChart.mockClear()
  seam.setOption.mockClear()
  seam.resize.mockClear()
  seam.dispose.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DtLineChart 实例生命周期', () => {
  it('挂载时在自己的宿主元素上建一次图', async () => {
    const wrapper = mount(DtLineChart, {
      props: { series: [series('t', 'a')] },
    })
    await flushPromises()
    expect(seam.createChart).toHaveBeenCalledTimes(1)
    expect(seam.createChart.mock.calls[0]?.[0]).toBe(
      wrapper.find('.dt-line-chart__canvas').element,
    )
  })

  it('换数据只 setOption，不重新建图', async () => {
    const wrapper = mount(DtLineChart, {
      props: { series: [series('t', 'a')] },
    })
    await flushPromises()
    await wrapper.setProps({ series: [series('t', 'a'), series('h', 'b')] })
    expect(seam.createChart).toHaveBeenCalledTimes(1)
    expect(seam.setOption).toHaveBeenCalledTimes(2)
    expect(optionAt(1)?.series.map((item) => item.id)).toEqual(['t', 'h'])
  })

  it('卸载时释放实例并断开尺寸监听', async () => {
    const wrapper = mount(DtLineChart, {
      props: { series: [series('t', 'a')] },
    })
    await flushPromises()
    wrapper.unmount()
    expect(seam.dispose).toHaveBeenCalledTimes(1)
    expect(disconnectCount).toBe(1)
  })

  it('尺寸变化转成实例的 resize', async () => {
    mount(DtLineChart, { props: { series: [series('t', 'a')] } })
    await flushPromises()
    notifySize?.()
    expect(seam.resize).toHaveBeenCalledTimes(1)
  })

  it('实例还没到手就卸载时，到手即释放——否则它永远没人回收', async () => {
    const wrapper = mount(DtLineChart, { props: { series: [] } })
    wrapper.unmount()
    await flushPromises()
    expect(seam.dispose).toHaveBeenCalledTimes(1)
    expect(seam.setOption).not.toHaveBeenCalled()
  })
})

describe('DtLineChart 取值与状态', () => {
  it('null 传成断档而不是 0，且不连线', async () => {
    mount(DtLineChart, {
      props: {
        series: [
          series('t', 'a', [
            [AT, 21.5],
            ['2026-08-12T02:56:00.000Z', null],
          ]),
        ],
      },
    })
    await flushPromises()
    expect(optionAt(0)?.series[0]?.connectNulls).toBe(false)
    expect(optionAt(0)?.series[0]?.data.map(([, value]) => value)).toEqual([
      21.5,
      null,
    ])
  })

  it('分组不同的系列分到不同的 Y 轴', async () => {
    mount(DtLineChart, {
      props: { series: [series('t', 'temperature'), series('h', 'humidity')] },
    })
    await flushPromises()
    expect(optionAt(0)?.yAxis).toHaveLength(2)
    expect(optionAt(0)?.series.map((item) => item.yAxisIndex)).toEqual([0, 1])
  })

  it('一条系列都没有时出空态，option 里的系列也是空的', async () => {
    const wrapper = mount(DtLineChart, { props: { series: [] } })
    await flushPromises()
    expect(wrapper.find('.dt-empty').exists()).toBe(true)
    expect(optionAt(0)?.series).toEqual([])
  })

  it('加载中盖加载态，且不同时显示空态', async () => {
    const wrapper = mount(DtLineChart, {
      props: { series: [], loading: true },
    })
    await flushPromises()
    expect(wrapper.find('.dt-spinner').exists()).toBe(true)
    expect(wrapper.find('.dt-empty').exists()).toBe(false)
  })

  it('有数据且不在加载时两层遮罩都不出现', async () => {
    const wrapper = mount(DtLineChart, {
      props: { series: [series('t', 'a')] },
    })
    await flushPromises()
    expect(wrapper.find('.dt-line-chart__veil').exists()).toBe(false)
  })

  it('高度按 prop 落到根节点上', () => {
    const wrapper = mount(DtLineChart, {
      props: { series: [], height: '480px' },
    })
    expect(wrapper.find('.dt-line-chart').attributes('style')).toContain(
      'height: 480px',
    )
  })

  it('画布有可访问名称，读屏不会读成一块空白', () => {
    const wrapper = mount(DtLineChart, {
      props: { series: [], ariaLabel: '车间温湿度趋势' },
    })
    const canvas = wrapper.find('.dt-line-chart__canvas')
    expect(canvas.attributes('role')).toBe('img')
    expect(canvas.attributes('aria-label')).toBe('车间温湿度趋势')
  })
})
