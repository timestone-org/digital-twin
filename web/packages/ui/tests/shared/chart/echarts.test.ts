/**
 * @fileoverview 锁住 echarts 装配点的契约：只注册一次、实例面收窄成三件事、
 * setOption 一律 notMerge。
 * ⚠ 这是全仓**唯一**允许 mock echarts 包本身的地方——被测的正是「怎么把包装起来」
 * 这件事；组件侧一律在本模块上打桩，见 testing-standard-typescript §5.2。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createChart } from '../../../src/shared/chart/echarts'
import { buildLineOption } from '../../../src/shared/chart/lineOption'

const echarts = vi.hoisted(() => {
  const setOption = vi.fn((option: unknown, opts: unknown) => [option, opts])
  const resize = vi.fn()
  const dispose = vi.fn()
  return {
    use: vi.fn((modules: readonly unknown[]) => modules),
    init: vi.fn((host: HTMLElement) => ({ host, setOption, resize, dispose })),
    setOption,
    resize,
    dispose,
  }
})

vi.mock('echarts/core', () => ({ use: echarts.use, init: echarts.init }))
vi.mock('echarts/charts', () => ({ LineChart: 'LineChart' }))
vi.mock('echarts/components', () => ({
  GridComponent: 'GridComponent',
  LegendComponent: 'LegendComponent',
  TooltipComponent: 'TooltipComponent',
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: 'CanvasRenderer' }))

beforeEach(() => {
  echarts.use.mockClear()
  echarts.init.mockClear()
  echarts.setOption.mockClear()
})

describe('createChart', () => {
  it('只注册用得到的图表与组件，且多次建图只注册一次', async () => {
    // ⚠ 「只注册一次」的闩是模块级状态：乱序执行时别的用例可能先建过图，
    //   这里取一份全新模块，让本用例自己见证从零到一（mock 表不受 reset 影响）
    vi.resetModules()
    const fresh = await import('../../../src/shared/chart/echarts')
    const first = document.createElement('div')
    const second = document.createElement('div')
    await fresh.createChart(first)
    await fresh.createChart(second)
    expect(echarts.use).toHaveBeenCalledTimes(1)
    expect(echarts.use.mock.calls[0]?.[0]).toEqual([
      'LineChart',
      'GridComponent',
      'LegendComponent',
      'TooltipComponent',
      'CanvasRenderer',
    ])
    expect(echarts.init).toHaveBeenCalledTimes(2)
    expect(echarts.init.mock.calls[0]?.[0]).toBe(first)
  })

  it('setOption 一律 notMerge——不这么给，被移掉的系列会留在图上继续画', async () => {
    const handle = await createChart(document.createElement('div'))
    const option = buildLineOption([])
    handle.setOption(option)
    expect(echarts.setOption).toHaveBeenCalledWith(option, { notMerge: true })
  })

  it('resize 与 dispose 直接透到实例上', async () => {
    const handle = await createChart(document.createElement('div'))
    handle.resize()
    handle.dispose()
    expect(echarts.resize).toHaveBeenCalledTimes(1)
    expect(echarts.dispose).toHaveBeenCalledTimes(1)
  })
})
