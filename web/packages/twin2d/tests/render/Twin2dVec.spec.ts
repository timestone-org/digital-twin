/**
 * @fileoverview vec 渲染件守的契约：五种几何各落对的 SVG 元素、填充在下多遍描边
 * 从下往上各出一个元素、局部渐变的 id 恒带实例前缀（同页两张图才不互顶）、
 * `stretch` 落 `preserveAspectRatio="none"`，以及根 `<svg>` 的样式全部取自 paintVec。
 *
 * ⚠ 层序反了、渐变 id 撞了、样式在组件里又算了一遍，这三件事都不报错——
 * 只表现为「画得不对」，所以只有这份用例拦得住。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { paintVec } from '../../src/paintVec'
import Twin2dVec from '../../src/render/Twin2dVec.vue'
import type { DOMWrapper } from '@vue/test-utils'

import type { Twin2dPaintCtx } from '../../src/paintCommon'
import type { Twin2dNode } from '../../src/types'
import type {
  Twin2dGradient,
  Twin2dPaint,
  Twin2dShape,
  Twin2dStrokePass,
  Twin2dVecPrim,
} from '../../src/typesPrim'

const NODE: Twin2dNode = {
  id: 'n1',
  styleId: 's1',
  x: 0,
  y: 0,
  w: 300,
  h: 120,
  rotate: 0,
  flipX: false,
  flipY: false,
  label: '储罐',
  labelPos: 'bottom',
  status: '',
  accent: '',
  badge: '',
  badgeColor: '',
  badgeShape: 'round',
  tags: {},
  slots: [],
  layers: [],
  patch: {},
  ports: [],
}

/** 非方形盒：两轴换算写反了才看得出来 */
const CTX: Twin2dPaintCtx = { node: NODE, boxW: 200, boxH: 100, idPrefix: 'a1' }

const BASE: Twin2dVecPrim = {
  id: 'outline',
  kind: 'vec',
  at: { kind: 'flow' },
  size: { w: 40, h: 40 },
  minWidth: null,
  maxWidth: null,
  z: 3,
  opacity: 0.5,
  hidden: false,
  when: null,
  anim: null,
  transition: null,
  rotate: 0,
  scale: 1,
  transformOrigin: '50% 50%',
  pointerEvents: 'none',
  keepUpright: false,
  coord: 'px',
  shape: { kind: 'rect', x: 1, y: 2, w: 3, h: 4, rx: 0 },
  fill: { kind: 'color', color: 'var(--t2-accent)' },
  strokes: [],
  gradients: [],
  stretch: false,
}

function stroke(id: string, width: number, color: string): Twin2dStrokePass {
  return {
    id,
    width,
    color,
    dash: [],
    cap: 'butt',
    join: 'miter',
    opacity: 1,
    nonScaling: false,
  }
}

const LINEAR: Twin2dGradient = {
  kind: 'linear',
  id: 'g1',
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 1,
  stops: [
    { id: 'st1', color: 'var(--surface-panel)', at: 0 },
    { id: 'st2', color: 'var(--surface-raised)', at: 1 },
  ],
}

const RADIAL: Twin2dGradient = {
  kind: 'radial',
  id: 'g2',
  cx: 0.5,
  cy: 0.5,
  r: 0.5,
  fx: 0.5,
  fy: 0.5,
  stops: [{ id: 'st3', color: 'var(--t2-accent)', at: 0.25 }],
}

function render(patch: Partial<Twin2dVecPrim>, ctx: Twin2dPaintCtx = CTX) {
  return mount(Twin2dVec, { props: { prim: { ...BASE, ...patch }, ctx } })
}

type Wrapper = ReturnType<typeof render>

/** 真正画出来的那几个元素，不含 `<defs>` 里的渐变。 */
function drawn(wrapper: Wrapper): DOMWrapper<Element>[] {
  return wrapper.findAll('path, rect, ellipse, line, polygon, polyline')
}

function tags(wrapper: Wrapper): string[] {
  return drawn(wrapper).map((item) => item.element.tagName)
}

describe('五种几何各落对的元素', () => {
  const cases: readonly (readonly [string, Twin2dShape, string])[] = [
    ['path', { kind: 'path', d: 'M0 0 L10 10' }, 'path'],
    ['rect', { kind: 'rect', x: 1, y: 2, w: 3, h: 4, rx: 1 }, 'rect'],
    ['ellipse', { kind: 'ellipse', cx: 5, cy: 5, rx: 4, ry: 2 }, 'ellipse'],
    ['line', { kind: 'line', x1: 0, y1: 0, x2: 8, y2: 8 }, 'line'],
    [
      'poly（闭合）',
      {
        kind: 'poly',
        points: [[0, 0] as const, [4, 0] as const],
        closed: true,
      },
      'polygon',
    ],
    [
      'poly（开口）',
      {
        kind: 'poly',
        points: [[0, 0] as const, [4, 0] as const],
        closed: false,
      },
      'polyline',
    ],
  ]

  it.each(cases)('%s 渲成 <%s>', (_name, shape, tag) => {
    expect(tags(render({ shape }))).toEqual([tag])
  })

  it('几何属性来自 svgShapeAttrs，组件不自己算一遍', () => {
    const shape: Twin2dShape = { kind: 'ellipse', cx: 5, cy: 5, rx: 4, ry: 2 }

    const [element] = drawn(render({ shape }))

    expect(element?.attributes('cx')).toBe('5')
    expect(element?.attributes('ry')).toBe('2')
  })

  // ⚠ path 的 d 是一段串没法逐数缩放，unit 档只能靠 scale() 顶上；这条属性被上色
  // 属性顶掉的表现是形状还在、整个缩回原点
  it('unit 档的 path 带 scale()，且不被上色属性顶掉', () => {
    const wrapper = render({
      coord: 'unit',
      shape: { kind: 'path', d: 'M0 0 L1 1' },
    })

    const [element] = drawn(wrapper)
    expect(element?.attributes('transform')).toBe('scale(200, 100)')
    expect(element?.attributes('d')).toBe('M0 0 L1 1')
    expect(element?.attributes('fill')).toBe('var(--t2-accent)')
  })
})

describe('填充与多遍描边', () => {
  it('填充一层在下，描边按文档序叠在上面', () => {
    const wrapper = render({
      strokes: [
        stroke('base', 6, 'var(--surface-panel)'),
        stroke('core', 2, 'var(--t2-accent)'),
      ],
    })

    const widths = drawn(wrapper).map((item) => item.attributes('stroke-width'))
    expect(widths).toEqual([undefined, '6', '2'])
  })

  // ⚠ SVG 的填充缺省是黑色：描边遍不摘掉它就是一块黑盖在底下那几遍上
  it('每一遍描边都摘掉填充', () => {
    const wrapper = render({ strokes: [stroke('core', 2, 'var(--t2-accent)')] })

    expect(drawn(wrapper)[1]?.attributes('fill')).toBe('none')
  })

  it('fill 为 none 时不产填充层', () => {
    const fill: Twin2dPaint = { kind: 'none' }

    const wrapper = render({ fill, strokes: [stroke('core', 2, 'red')] })

    expect(drawn(wrapper)).toHaveLength(1)
  })

  it('一遍描边都没有时只画填充那一层', () => {
    expect(drawn(render({}))).toHaveLength(1)
  })
})

describe('局部渐变', () => {
  function gradientIds(wrapper: Wrapper): (string | undefined)[] {
    return wrapper.findAll('defs > *').map((item) => item.attributes('id'))
  }

  it('两档各落对的元素', () => {
    const wrapper = render({ gradients: [LINEAR, RADIAL] })

    const defs = wrapper.findAll('defs > *')
    expect(defs.map((item) => item.element.tagName)).toEqual([
      'linearGradient',
      'radialGradient',
    ])
  })

  it('色标逐条落成 <stop>', () => {
    const wrapper = render({ gradients: [LINEAR] })

    const stops = wrapper.findAll('stop')
    expect(stops).toHaveLength(2)
    expect(stops[1]?.attributes('offset')).toBe('1')
    expect(stops[1]?.attributes('stop-color')).toBe('var(--surface-raised)')
  })

  it('id 带实例前缀，填充引的就是这个 id', () => {
    const wrapper = render({
      gradients: [LINEAR],
      fill: { kind: 'gradient', id: 'g1' },
    })

    expect(gradientIds(wrapper)).toEqual(['t2g-a1-g1'])
    expect(drawn(wrapper)[0]?.attributes('fill')).toBe('url(#t2g-a1-g1)')
  })

  // ⚠ 同页两个节点用同名渐变时浏览器只认头一个：不带实例前缀的表现是
  // 「另一张图的颜色跑到这张图上」，两边都不报错
  it('同一份图元挂两次，两个实例的渐变 id 不撞', () => {
    const props = {
      gradients: [LINEAR],
      fill: { kind: 'gradient' as const, id: 'g1' },
    }

    const first = render(props, { ...CTX, idPrefix: 'a1' })
    const second = render(props, { ...CTX, idPrefix: 'b2' })

    expect(gradientIds(first)).toEqual(['t2g-a1-g1'])
    expect(gradientIds(second)).toEqual(['t2g-b2-g1'])
    expect(drawn(second)[0]?.attributes('fill')).toBe('url(#t2g-b2-g1)')
  })

  // ⚠ url(#不存在) 在浏览器里是整个形状不画，而配置面上那一档看着是选中的
  it('引不到的渐变退回不上色', () => {
    const wrapper = render({ fill: { kind: 'gradient', id: 'ghost' } })

    expect(drawn(wrapper)[0]?.attributes('fill')).toBe('none')
  })

  it('一个渐变都没有时不产 <defs>', () => {
    expect(render({}).find('defs').exists()).toBe(false)
  })
})

describe('根 <svg>', () => {
  it('viewBox 与本次的盒尺寸同源', () => {
    expect(render({}).attributes('viewBox')).toBe('0 0 200 100')
  })

  it('盒尺寸为 0 时兜到 1，不产 viewBox="0 0 0 0"', () => {
    const wrapper = render({}, { ...CTX, boxW: 0, boxH: 0 })

    expect(wrapper.attributes('viewBox')).toBe('0 0 1 1')
  })

  it('stretch 落 preserveAspectRatio="none"', () => {
    expect(render({ stretch: true }).attributes('preserveAspectRatio')).toBe(
      'none',
    )
  })

  it('不 stretch 时不产 preserveAspectRatio', () => {
    expect(render({}).attributes('preserveAspectRatio')).toBeUndefined()
  })

  // 样式只有一份真源：组件把 paintVec 的每一条声明原样贴上，不再算第二遍
  it('每一条内联样式都来自 paintVec', () => {
    const style = render({}).attributes('style') ?? ''

    for (const [key, value] of Object.entries(paintVec(BASE, CTX).style)) {
      expect(style).toContain(`${key}: ${value}`)
    }
  })

  it('keyframes 那一档的类名也来自 paintVec', () => {
    const wrapper = render({ anim: { kind: 'pulse', durationMs: 900 } })

    expect(wrapper.classes()).toContain('t2-anim-pulse')
    expect(wrapper.attributes('style')).toContain('--t2-anim-dur: 900ms')
  })

  it('对辅助技术隐藏，也不吃焦点', () => {
    const wrapper = render({})

    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('focusable')).toBe('false')
  })

  // hidden 那一档 paintBase 连样式都不产，留下元素就是个没尺寸没定位的空壳
  it('hidden 的图元整枝不渲染', () => {
    expect(render({ hidden: true }).find('svg').exists()).toBe(false)
  })
})
