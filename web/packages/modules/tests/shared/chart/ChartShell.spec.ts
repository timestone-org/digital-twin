/**
 * @fileoverview 守图表族公共壳的渲染契约：标题走 ModulePanel（留空不画标题栏）、
 * 空态盖在图区上但不吃鼠标、主题与取色器自渲染根派生后喂进各族 build、
 * `watchValues` 覆盖后按族自己的口径刷新，以及读屏摘要只在真有话说时才挂。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChartShell from '../../../src/shared/chart/ChartShell.vue'
import type { ChartBuild } from '../../../src/shared/chart/chartKit'

const echarts = vi.hoisted(() => {
  const handle = {
    setOption: vi.fn((option: unknown, update: unknown) => [option, update]),
    onClick: vi.fn((handler: (params: unknown) => void) => handler),
    resize: vi.fn(),
    dispose: vi.fn(),
  }
  return { handle, createChart: vi.fn(() => Promise.resolve(handle)) }
})

vi.mock('../../../src/shared/chart/echarts', () => ({
  createChart: echarts.createChart,
}))

const build: ChartBuild = () => ({ series: [] })

async function mountShell(props: Record<string, unknown> = {}) {
  const wrapper = mount(ChartShell, {
    props: { config: {}, values: {}, build, ...props },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  echarts.createChart.mockClear()
  echarts.handle.setOption.mockClear()
  echarts.handle.onClick.mockClear()
})

describe('标题', () => {
  it('配了标题就画标题栏', async () => {
    const wrapper = await mountShell({ config: { title: '功率趋势' } })

    expect(wrapper.text()).toContain('功率趋势')

    wrapper.unmount()
  })

  it('标题留空不画标题栏，图区吃满', async () => {
    const wrapper = await mountShell()

    expect(wrapper.find('.module-title-bar').exists()).toBe(false)

    wrapper.unmount()
  })
})

describe('空态', () => {
  it('不空时不画空态', async () => {
    const wrapper = await mountShell()

    expect(wrapper.find('.dt-chart__empty').exists()).toBe(false)

    wrapper.unmount()
  })

  it('空态盖在图区上，文案可换', async () => {
    const wrapper = await mountShell({ isEmpty: true, emptyText: '未绑点位' })

    expect(wrapper.get('.dt-chart__empty').text()).toBe('未绑点位')

    wrapper.unmount()
  })

  it('空态缺省文案是「暂无数据」', async () => {
    const wrapper = await mountShell({ isEmpty: true })

    expect(wrapper.get('.dt-chart__empty').text()).toBe('暂无数据')

    wrapper.unmount()
  })

  it('空着也照样建图——图区容器一直在，不会静默不初始化', async () => {
    const wrapper = await mountShell({ isEmpty: true })

    expect(echarts.createChart).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})

describe('喂给各族的东西', () => {
  /**
   * 在渲染根上写一个变量并触发一次重建，返回最后一次 build 的入参与 wrapper。
   * ⚠ 变量必须写在渲染根**自己**身上：happy-dom 的 getComputedStyle 不做
   * 自定义属性的继承，写在祖先上读出来是空串。
   */
  async function buildWith(name: string, value: string) {
    const spy = vi.fn(build)
    const wrapper = await mountShell({ build: spy })
    document
      .querySelector<HTMLElement>('.dt-chart')
      ?.style.setProperty(name, value)
    await wrapper.setProps({ config: { title: '换一版' } })
    return { call: spy.mock.calls.at(-1), wrapper }
  }

  it('主题自渲染根派生', async () => {
    const { call, wrapper } = await buildWith('--text-primary', 'rgb(9, 9, 9)')

    expect(call?.[0].text).toBe('rgb(9, 9, 9)')

    wrapper.unmount()
  })

  it('取色器读的是渲染根的级联', async () => {
    const { call, wrapper } = await buildWith('--state-danger', 'rgb(8, 8, 8)')

    expect(call?.[1]('--state-danger')).toBe('rgb(8, 8, 8)')

    wrapper.unmount()
  })

  it('首帧是全量重建', async () => {
    const spy = vi.fn(build)
    const wrapper = await mountShell({ build: spy })

    expect(spy.mock.calls[0]?.[2]).toBe(true)
    expect(echarts.handle.setOption).toHaveBeenLastCalledWith(
      { series: [] },
      { notMerge: true },
    )

    wrapper.unmount()
  })
})

describe('刷新源', () => {
  it('缺省按 config 全量、按 values 部分刷新', async () => {
    const wrapper = await mountShell({ values: { a: 1 } })

    await wrapper.setProps({ values: { a: 2 } })

    expect(echarts.handle.setOption).toHaveBeenLastCalledWith(
      { series: [] },
      { replaceMerge: ['series'] },
    )

    wrapper.unmount()
  })

  it('族可以自带刷新源——签名没变就不该重画', async () => {
    const wrapper = await mountShell({
      values: { a: 1 },
      watchValues: () => 'sig',
      valuesDeep: false,
    })
    echarts.handle.setOption.mockClear()

    await wrapper.setProps({ values: { a: 2 } })

    expect(echarts.handle.setOption).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})

describe('图元点击', () => {
  it('不传回调就不注册点击——只开「整块可点」的族误传会让整块失效', async () => {
    const wrapper = await mountShell()

    expect(echarts.handle.onClick).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('只给上抛回调时走缺省取值——⚠ 取值器不许叫 Object 原型上已有的名字', async () => {
    const emit = vi.fn()
    const wrapper = await mountShell({ itemClick: { emit } })

    echarts.handle.onClick.mock.calls[0]?.[0]({ name: '甲' })

    expect(emit).toHaveBeenCalledWith({ event: 'click', value: '甲' })

    wrapper.unmount()
  })

  it('取值口径跟着上抛回调一起给', async () => {
    const emit = vi.fn()
    const wrapper = await mountShell({
      itemClick: { emit, readValue: () => '自定义' },
    })

    echarts.handle.onClick.mock.calls[0]?.[0]({ name: '甲' })

    expect(emit).toHaveBeenCalledWith({ event: 'click', value: '自定义' })

    wrapper.unmount()
  })
})

describe('读屏摘要', () => {
  it('摘要挂在图区宿主上——canvas 里的一切对读屏是纯空白', async () => {
    const wrapper = await mountShell({ ariaSummary: '功率趋势：两条系列' })
    const canvas = wrapper.get('.dt-chart__canvas')

    expect(canvas.attributes('aria-label')).toBe('功率趋势：两条系列')
    expect(canvas.attributes('role')).toBe('img')

    wrapper.unmount()
  })

  it('没摘要就连属性一起省掉——没名字的图形比不写更糟', async () => {
    const wrapper = await mountShell()
    const canvas = wrapper.get('.dt-chart__canvas')

    expect(canvas.attributes('aria-label')).toBeUndefined()
    expect(canvas.attributes('role')).toBeUndefined()

    wrapper.unmount()
  })

  it('一串空格不算摘要', async () => {
    const wrapper = await mountShell({ ariaSummary: '   ' })

    expect(
      wrapper.get('.dt-chart__canvas').attributes('aria-label'),
    ).toBeUndefined()

    wrapper.unmount()
  })
})
