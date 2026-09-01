/**
 * @fileoverview 视口：坐标换算、以指针为锚缩放、缩放上下限、适应视图，
 * 以及接点坐标随卡片实测尺寸走。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { useCanvasViewport } from '@/pages/Modeling/Canvas/scripts/useCanvasViewport'
import { useNodeAnchors } from '@/pages/Modeling/Canvas/scripts/useNodeAnchors'

/** 宿主元素在屏幕上的位置固定成原点，让断言只盯换算本身。 */
function hostAt(left: number, top: number): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({ left, top, width: 800, height: 600 }) as DOMRect
  return element
}

function setupViewport(host: HTMLElement) {
  let view!: ReturnType<typeof useCanvasViewport>
  const wrapper = mount(
    defineComponent({
      setup() {
        view = useCanvasViewport(ref(host))
        return () => h('div')
      },
    }),
  )
  return { view, wrapper }
}

describe('视口', () => {
  it('屏幕坐标扣掉宿主原点与平移，再除以缩放', () => {
    const { view } = setupViewport(hostAt(100, 50))
    view.pan(20, 10)
    view.viewport.zoom = 2

    expect(view.toCanvas(140, 90)).toEqual({ left: 10, top: 15 })
  })

  it('以指针那一点为锚缩放——那一点在画布上的位置放大前后不变', () => {
    const host = hostAt(0, 0)
    const { view } = setupViewport(host)

    const before = view.toCanvas(300, 200)
    view.zoomAt(300, 200, -100)
    const after = view.toCanvas(300, 200)

    expect(view.viewport.zoom).toBeGreaterThan(1)
    expect(after.left).toBeCloseTo(before.left, 6)
    expect(after.top).toBeCloseTo(before.top, 6)
  })

  it('缩放有上下限，滚多久都不会缩到 0 或放到没边', () => {
    const { view } = setupViewport(hostAt(0, 0))

    for (let at = 0; at < 200; at += 1) view.zoomAt(0, 0, 100)
    const smallest = view.viewport.zoom
    for (let at = 0; at < 400; at += 1) view.zoomAt(0, 0, -100)

    expect(smallest).toBeGreaterThan(0)
    expect(view.viewport.zoom).toBeLessThan(10)
  })

  it('一个矩形都没有时「适应视图」回到原点，而不是算出 NaN', () => {
    const { view } = setupViewport(hostAt(0, 0))
    view.pan(123, 456)

    view.fit([])

    expect(view.viewport).toEqual({ left: 0, top: 0, zoom: 1 })
  })
})

function operator(outputs: string[]): ModelingOperator {
  return {
    code: 'src',
    name: 'src',
    description: '',
    category: 'source',
    spec_version: '1',
    icon: 'workflow',
    inputs: [],
    outputs: outputs.map((name) => ({
      name,
      contract: 'frame',
      label: name,
      is_required: true,
      description: '',
    })),
    config_schema: {},
    fit_required: false,
    serving_enabled: false,
    serving_window_required: false,
    serving_channel: 'json',
  }
}

const GRAPH: ModelingGraph = {
  format_version: '1',
  nodes: [
    {
      id: 'n1',
      operator: 'src',
      alias: '',
      position: { left: 50, top: 20 },
      config: {},
    },
  ],
  edges: [],
}

function setupAnchors() {
  let anchors!: ReturnType<typeof useNodeAnchors>
  const wrapper = mount(
    defineComponent({
      setup() {
        anchors = useNodeAnchors()
        return () => h('div')
      },
    }),
  )
  return { anchors, wrapper }
}

describe('接点坐标', () => {
  it('没量到尺寸时用兜底值，不给 null 也不给 NaN', () => {
    const { anchors } = setupAnchors()
    const operators = new Map([['src', operator(['out'])]])

    const at = anchors.anchorOf(GRAPH, operators, {
      node: 'n1',
      port: 'out',
      side: 'out',
    })

    expect(at).toEqual({ left: 50 + 224, top: 20 + 44 })
  })

  it('同一侧多个接点在边上等距分布', () => {
    const { anchors } = setupAnchors()
    const operators = new Map([['src', operator(['a', 'b', 'c'])]])

    const tops = ['a', 'b', 'c'].map(
      (port) =>
        anchors.anchorOf(GRAPH, operators, { node: 'n1', port, side: 'out' })
          ?.top,
    )

    expect(tops).toEqual([20 + 22, 20 + 44, 20 + 66])
  })

  it('图里没有这个节点时给 null，而不是画到原点去', () => {
    const { anchors } = setupAnchors()

    const at = anchors.anchorOf(GRAPH, new Map(), {
      node: '不存在',
      port: 'out',
      side: 'out',
    })

    expect(at).toBeNull()
  })

  it('外接矩形带上位置与尺寸，「适应视图」照它算', () => {
    const { anchors } = setupAnchors()

    expect(anchors.rectOf(GRAPH, 'n1')).toEqual({
      left: 50,
      top: 20,
      width: 224,
      height: 88,
    })
  })
})
