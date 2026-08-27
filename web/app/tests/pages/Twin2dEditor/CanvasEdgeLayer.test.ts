/**
 * @fileoverview 契约：可见的线原样交给包里的渲染件（四个 props 一个都不能漏），命中带
 * 与它同一条 path 且排在它**前面**（= 画在下面）、按屏幕像素恒宽，按下只上抛不冒泡，
 * 双击按弧长插一个拐点。
 *
 * ⚠ 命中带另算一遍几何不会报错，只会表现为「点在线上没反应、点在线旁边反而中了」。
 * ⚠ 命中带宽度不除回倍率的话，缩到四分之一时它也跟着缩，连线就点不中了。
 * ⚠ 这一按冒到画布壳上会被当成「点了空白」，表现是刚选中的线在同一次按下里又被清掉。
 * ⚠ 传给渲染件的 prop 名写错，typecheck 与 lint 双双放行：少一个 props 整层就不画。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Pt, Twin2dConfig, Twin2dWaypoint } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import CanvasEdgeLayer from '@/pages/Twin2dEditor/components/CanvasEdgeLayer.vue'
import { TWIN_2D_DEFAULT_SNAP } from '@/pages/Twin2dEditor/scripts/snapping'
import type { Twin2dClientPoint } from '@/pages/Twin2dEditor/scripts/viewportOps'

/** 100×60 的方块，右边中点一个引脚。 */
const NODE_STYLE = {
  id: 'ns',
  name: '方块',
  size: { w: 100, h: 60 },
  ports: [{ id: 'r', at: { kind: 'perim', t: 0.375 }, side: 'right' }],
}

/** 直线档：命中带与可见线的 path 都是 `M起点 L终点`。 */
const EDGE_STYLE = {
  id: 'es',
  name: '直线',
  route: 'straight',
  cornerRadius: 0,
  strokes: [{ id: 'core', width: 2 }],
}

const DOC: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 400, grid: 20 },
  styles: [NODE_STYLE],
  edgeStyles: [EDGE_STYLE],
  nodes: [
    { id: 'a', styleId: 'ns', x: 0, y: 0, w: 100, h: 60 },
    { id: 'b', styleId: 'ns', x: 400, y: 0, w: 100, h: 60 },
  ],
  edges: [
    {
      id: 'e1',
      styleId: 'es',
      from: { nodeId: 'a', t: 0.375 },
      to: { nodeId: 'b', t: 0.875 },
    },
  ],
})

/** 用例里视口不缩不移，client 坐标直接当设计坐标用。 */
function identity(at: Twin2dClientPoint): Pt {
  return { x: at.clientX, y: at.clientY }
}

interface Options {
  selectedIds?: readonly string[]
  scale?: number
  toDesign?: (at: Twin2dClientPoint) => Pt | null
}

/**
 * 一份完整 props；命中带那条冒泡用例要自己摆组件，所以单独拎出来。
 * @param options 用例要改的那几项
 */
function propsOf(options: Options = {}) {
  return {
    canvas: DOC.canvas,
    edges: DOC.edges,
    edgeStyles: DOC.edgeStyles,
    nodes: DOC.nodes,
    nodeStyles: DOC.styles,
    selectedIds: options.selectedIds ?? [],
    snap: { ...TWIN_2D_DEFAULT_SNAP, grid: 20, guides: false },
    scale: options.scale ?? 1,
    toDesign: options.toDesign ?? identity,
  }
}

function mountLayer(options: Options = {}) {
  return mount(CanvasEdgeLayer, { props: propsOf(options) })
}

type Wrapper = ReturnType<typeof mountLayer>

/**
 * 真事件，不走测试库那份简化实现：命中带要的是能冒泡的 PointerEvent。
 * @param wrapper 挂起来的那一份
 * @param type 事件名
 * @param at 落点
 */
function fire(wrapper: Wrapper, type: string, at: Pt): void {
  wrapper.get('[data-test="edge-hit"]').element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: at.x,
      clientY: at.y,
    }),
  )
}

function widthOf(wrapper: Wrapper): number {
  const raw = wrapper.get('[data-test="edge-hit"]').attributes('stroke-width')
  return Number(raw ?? '0')
}

describe('可见线与命中带', () => {
  it('可见的线由包里的渲染件出，四个 props 一个不漏', () => {
    const wrapper = mountLayer()
    const edge = wrapper.get('[data-test="edge"]')

    expect(edge.attributes('data-id')).toBe('e1')
    expect(wrapper.get('[data-test="edge-stroke"]').attributes('d')).toBe(
      'M100,30 L400,30',
    )
  })

  it('命中带与可见线同一条 path', () => {
    const wrapper = mountLayer()

    expect(wrapper.get('[data-test="edge-hit"]').attributes('d')).toBe(
      wrapper.get('[data-test="edge-stroke"]').attributes('d'),
    )
  })

  it('命中带排在可见线前面，也就是画在它下面', () => {
    const wrapper = mountLayer()
    // ⚠ 从 DOMWrapper 上取元素而不是 `wrapper.element`：后者在 eslint 那一趟里是
    // any（`.vue` 只有 vue-tsc 解析得出来），一碰就是四条 unsafe
    const layer = wrapper.get('[data-test="edge-layer"]').element
    const order = [...layer.querySelectorAll('svg')].map((svg) =>
      svg.classList.contains('dt-edges__hits') ? 'hits' : 'edges',
    )

    expect(order).toEqual(['hits', 'edges'])
  })

  it('命中带按屏幕像素恒宽：倍率翻倍，设计像素宽度减半', () => {
    const wide = widthOf(mountLayer({ scale: 1 }))
    const zoomed = widthOf(mountLayer({ scale: 2 }))

    expect(zoomed).toBeCloseTo(wide / 2)
    expect(wide).toBeGreaterThan(2)
  })

  it('倍率是零时不产出无穷大的宽度', () => {
    expect(Number.isFinite(widthOf(mountLayer({ scale: 0 })))).toBe(true)
  })

  it('只有选中的那条线底下多一圈光晕', () => {
    expect(mountLayer().find('[data-test="edge-halo"]').exists()).toBe(false)
    expect(
      mountLayer({ selectedIds: ['e1'] })
        .get('[data-test="edge-halo"]')
        .attributes('data-id'),
    ).toBe('e1')
  })
})

describe('命中带上的两下', () => {
  it('按下上抛这一条的 id，且不再冒到画布壳上', () => {
    const seen = vi.fn()
    const host = defineComponent({
      setup: () => () =>
        h('div', { onPointerdown: seen }, [h(CanvasEdgeLayer, propsOf())]),
    })
    const wrapper = mount(host)
    wrapper
      .get('[data-test="edge-hit"]')
      .element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

    const picked = wrapper.findComponent(CanvasEdgeLayer).emitted('pick') ?? []

    expect(picked).toHaveLength(1)
    expect(picked[0]?.[0]).toBe('e1')
    expect(seen).not.toHaveBeenCalled()
  })

  it('双击线上一点，按弧长插一个拐点', () => {
    const wrapper = mountLayer()
    fire(wrapper, 'dblclick', { x: 244, y: 36 })

    const inserted =
      wrapper.emitted<[string, readonly Twin2dWaypoint[]]>('insert')

    expect(inserted?.[0]?.[0]).toBe('e1')
    expect(inserted?.[0]?.[1]).toEqual([{ x: 240, y: 40 }])
  })

  it('落点算不出来（舞台还没挂上）时一个拐点都不插', () => {
    const wrapper = mountLayer({ toDesign: () => null })
    fire(wrapper, 'dblclick', { x: 244, y: 36 })

    expect(wrapper.emitted('insert')).toBeUndefined()
  })
})
