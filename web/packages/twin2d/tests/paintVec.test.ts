/**
 * @fileoverview 锁住 vec 图元的 SVG 侧属性：五种几何各出对的元素与属性、`unit` 档
 * 两轴各乘各的（非方形盒才看得出写反）、多遍描边的层序与 `fill="none"`、局部渐变的
 * 实例前缀永不撞上 sprite 那四个文档级 id，以及 `stretch` / viewBox 除零兜底。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_SPRITE_GRADIENT_IDS } from '../src/kinds'
import {
  paintVec,
  svgGradientAttrs,
  svgGradientDomId,
  svgPaintLayers,
  svgShapeAttrs,
  svgShapeTag,
  svgStopAttrs,
  svgStrokeAttrs,
} from '../src/paintVec'
import type { Twin2dPaintCtx } from '../src/paintCommon'
import type { Twin2dNode } from '../src/types'
import type {
  Twin2dGradient,
  Twin2dShape,
  Twin2dStrokePass,
  Twin2dVecPrim,
} from '../src/typesPrim'

const BASE_NODE: Twin2dNode = {
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

const BASE_PRIM: Twin2dVecPrim = {
  id: 'outline',
  kind: 'vec',
  at: { kind: 'fill', inset: [0, 0, 0, 0] },
  size: { w: 'auto', h: 'auto' },
  minWidth: null,
  maxWidth: null,
  z: 1,
  opacity: 1,
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
  shape: { kind: 'rect', x: 10, y: 0, w: 280, h: 120, rx: 0 },
  fill: { kind: 'color', color: 'var(--surface-panel)' },
  strokes: [],
  gradients: [],
  stretch: false,
}

/** 非方形盒：两轴写反了才看得出来 */
const CTX: Twin2dPaintCtx = {
  node: BASE_NODE,
  boxW: 300,
  boxH: 120,
  idPrefix: 't2-1',
}

const BASE_STROKE: Twin2dStrokePass = {
  id: 'core',
  width: 1.2,
  color: 'var(--t2-accent)',
  dash: [],
  cap: 'butt',
  join: 'miter',
  opacity: 1,
  nonScaling: false,
}

function prim(patch: Partial<Twin2dVecPrim>): Twin2dVecPrim {
  return { ...BASE_PRIM, ...patch }
}

function stroke(patch: Partial<Twin2dStrokePass>): Twin2dStrokePass {
  return { ...BASE_STROKE, ...patch }
}

describe('五种几何 → SVG 元素与属性', () => {
  it('元素名逐档对上，poly 按 closed 分成 polygon 与 polyline', () => {
    expect(svgShapeTag({ kind: 'path', d: 'M0,0 L1,1' })).toBe('path')
    expect(svgShapeTag(BASE_PRIM.shape)).toBe('rect')
    expect(
      svgShapeTag({ kind: 'ellipse', cx: 10, cy: 60, rx: 10, ry: 60 }),
    ).toBe('ellipse')
    expect(svgShapeTag({ kind: 'line', x1: 14, y1: 57, x2: 286, y2: 57 })).toBe(
      'line',
    )
    const points = [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ] as const
    expect(svgShapeTag({ kind: 'poly', points, closed: true })).toBe('polygon')
    expect(svgShapeTag({ kind: 'poly', points, closed: false })).toBe(
      'polyline',
    )
  })

  it('rect 出 x/y/width/height 与两轴各自的圆角', () => {
    expect(svgShapeAttrs(BASE_PRIM.shape, 'px', 300, 120)).toEqual({
      x: '10',
      y: '0',
      width: '280',
      height: '120',
      rx: '0',
      ry: '0',
    })
  })

  it('ellipse 出 cx/cy/rx/ry', () => {
    const shape: Twin2dShape = {
      kind: 'ellipse',
      cx: 10,
      cy: 60,
      rx: 10,
      ry: 60,
    }
    expect(svgShapeAttrs(shape, 'px', 300, 120)).toEqual({
      cx: '10',
      cy: '60',
      rx: '10',
      ry: '60',
    })
  })

  it('line 出四个端点坐标', () => {
    const shape: Twin2dShape = { kind: 'line', x1: 14, y1: 57, x2: 286, y2: 66 }
    expect(svgShapeAttrs(shape, 'px', 300, 120)).toEqual({
      x1: '14',
      y1: '57',
      x2: '286',
      y2: '66',
    })
  })

  it('poly 出逗号分对、空格分点的 points 串', () => {
    const shape: Twin2dShape = {
      kind: 'poly',
      points: [
        [0, 0],
        [8, 0],
        [4, 8],
      ],
      closed: true,
    }
    expect(svgShapeAttrs(shape, 'px', 300, 120)).toEqual({
      points: '0,0 8,0 4,8',
    })
  })

  it('path 的 d 原样出，px 档不带变换', () => {
    const shape: Twin2dShape = { kind: 'path', d: 'M0,0 L10,10 Z' }
    expect(svgShapeAttrs(shape, 'px', 300, 120)).toEqual({ d: 'M0,0 L10,10 Z' })
  })
})

describe('coord 两档的换算', () => {
  it('px 档坐标直用，不乘盒尺寸', () => {
    const shape: Twin2dShape = { kind: 'line', x1: 0, y1: 0, x2: 100, y2: 50 }
    expect(svgShapeAttrs(shape, 'px', 300, 120)).toEqual({
      x1: '0',
      y1: '0',
      x2: '100',
      y2: '50',
    })
  })

  it('unit 档在非方形盒上 x 乘宽、y 乘高——两轴共用一个比例就会在这条上红', () => {
    const shape: Twin2dShape = {
      kind: 'line',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0.5,
    }
    expect(svgShapeAttrs(shape, 'unit', 300, 120)).toEqual({
      x1: '0',
      y1: '0',
      x2: '300',
      y2: '60',
    })
  })

  it('unit 档的椭圆与折线也各轴各乘，坐标定到 0.01 不带浮点长尾', () => {
    const ellipse: Twin2dShape = {
      kind: 'ellipse',
      cx: 0.5,
      cy: 0.5,
      rx: 0.1,
      ry: 0.1,
    }
    expect(svgShapeAttrs(ellipse, 'unit', 333, 120)).toEqual({
      cx: '166.5',
      cy: '60',
      rx: '33.3',
      ry: '12',
    })
    const poly: Twin2dShape = {
      kind: 'poly',
      points: [
        [0, 0],
        [1, 1],
      ],
      closed: false,
    }
    expect(svgShapeAttrs(poly, 'unit', 300, 120)).toEqual({
      points: '0,0 300,120',
    })
  })

  it('unit 档的 rect 圆角横竖各按自己那一轴缩，非方形盒上才不会被拉扁', () => {
    const shape: Twin2dShape = {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rx: 0.1,
    }
    expect(svgShapeAttrs(shape, 'unit', 300, 120)).toEqual({
      x: '0',
      y: '0',
      width: '300',
      height: '120',
      rx: '30',
      ry: '12',
    })
  })

  it('unit 档的 path 靠 scale() 顶上，d 串一个字符都不改', () => {
    const shape: Twin2dShape = { kind: 'path', d: 'M0,0 L1,1' }
    expect(svgShapeAttrs(shape, 'unit', 300, 120)).toEqual({
      d: 'M0,0 L1,1',
      transform: 'scale(300, 120)',
    })
  })

  it('unit 档盒尺寸为 0 或负数时兜到 1，不产出 0 宽的几何', () => {
    const shape: Twin2dShape = { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }
    expect(svgShapeAttrs(shape, 'unit', 0, -5)).toEqual({
      x1: '0',
      y1: '0',
      x2: '1',
      y2: '1',
    })
  })
})

describe('多遍描边', () => {
  it('七项逐项落到 SVG 属性上，且恒带 fill=none——SVG 的填充缺省是黑色', () => {
    expect(
      svgStrokeAttrs(
        stroke({
          width: 6,
          color: 'var(--chart-series-2)',
          dash: [10, 4],
          cap: 'round',
          join: 'round',
          opacity: 0.6,
          nonScaling: true,
        }),
      ),
    ).toEqual({
      fill: 'none',
      stroke: 'var(--chart-series-2)',
      'stroke-width': '6',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-opacity': '0.6',
      'stroke-dasharray': '10 4',
      'vector-effect': 'non-scaling-stroke',
    })
  })

  it('没有虚线段就不产 dasharray，不 nonScaling 就不产 vector-effect', () => {
    const attrs = svgStrokeAttrs(stroke({}))
    expect(attrs['stroke-dasharray']).toBeUndefined()
    expect(attrs['vector-effect']).toBeUndefined()
    expect(attrs['stroke-width']).toBe('1.2')
  })

  it('描边色过消毒：url( 那类值回落 currentColor 而不是原样注入', () => {
    expect(
      svgStrokeAttrs(stroke({ color: 'url(http://x/a.svg#g)' })).stroke,
    ).toBe('currentColor')
  })

  it('宽底窄芯的层序照文档序自下而上，倒过来就只剩一根粗线', () => {
    const layers = svgPaintLayers(
      { kind: 'none' },
      [
        stroke({ id: 'base', width: 6, color: '#123456' }),
        stroke({ id: 'core', width: 2, color: '#abcdef' }),
      ],
      [],
      't2-1',
    )
    expect(layers.map((layer) => layer.key)).toEqual(['s:base', 's:core'])
    expect(layers.map((layer) => layer.attrs['stroke-width'])).toEqual([
      '6',
      '2',
    ])
  })

  it('填充层排在全部描边遍下面，且 key 与描边遍的分得开', () => {
    const layers = svgPaintLayers(
      { kind: 'color', color: '#0f0' },
      [stroke({ id: 'f' })],
      [],
      't2-1',
    )
    expect(layers.map((layer) => layer.key)).toEqual(['f:', 's:f'])
    expect(layers[0]?.attrs).toEqual({ fill: '#0f0' })
  })
})

describe('填充三档与局部渐变', () => {
  const gradients: readonly Twin2dGradient[] = [
    {
      kind: 'linear',
      id: 'body',
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 1,
      stops: [],
    },
  ]

  it('none 档一个填充层都不产', () => {
    expect(svgPaintLayers({ kind: 'none' }, [], gradients, 't2-1')).toEqual([])
  })

  it('color 档过消毒后原样出', () => {
    const layers = svgPaintLayers(
      { kind: 'color', color: 'var(--surface-overlay)' },
      [],
      gradients,
      't2-1',
    )
    expect(layers[0]?.attrs['fill']).toBe('var(--surface-overlay)')
  })

  it('gradient 档引的是加了实例前缀的 id', () => {
    const layers = svgPaintLayers(
      { kind: 'gradient', id: 'body' },
      [],
      gradients,
      't2-1',
    )
    expect(layers[0]?.attrs['fill']).toBe('url(#t2g-t2-1-body)')
  })

  it('引不到的渐变退回不上色，而不是 url(#不存在) 让整个形状消失', () => {
    const layers = svgPaintLayers(
      { kind: 'gradient', id: 'ghost' },
      [],
      gradients,
      't2-1',
    )
    expect(layers[0]?.attrs['fill']).toBe('none')
  })

  it('同页两个实例的同名渐变不撞', () => {
    expect(svgGradientDomId('t2-1', 'body')).not.toBe(
      svgGradientDomId('t2-2', 'body'),
    )
  })

  it('id 里的非法字符换成下划线，url(#…) 才选得中', () => {
    expect(svgGradientDomId('t2 1', 'a b#c')).toBe('t2g-t2_1-a_b_c')
  })

  it('前缀方案永不产出 sprite 那四个文档级渐变 id', () => {
    for (const spriteId of TWIN_2D_SPRITE_GRADIENT_IDS) {
      expect(svgGradientDomId('', spriteId)).not.toBe(spriteId)
      expect(svgGradientDomId(spriteId, spriteId)).not.toBe(spriteId)
      expect(svgGradientDomId('t2-1', spriteId)).not.toBe(spriteId)
    }
  })

  it('linear 与 radial 各出自己那套坐标，且都带前缀 id', () => {
    expect(
      svgGradientAttrs(
        { kind: 'linear', id: 'body', x1: 0, y1: 0, x2: 0, y2: 1, stops: [] },
        't2-1',
      ),
    ).toEqual({ id: 't2g-t2-1-body', x1: '0', y1: '0', x2: '0', y2: '1' })
    expect(
      svgGradientAttrs(
        {
          kind: 'radial',
          id: 'glow',
          cx: 0.5,
          cy: 0.5,
          r: 0.5,
          fx: 0.4,
          fy: 0.6,
          stops: [],
        },
        't2-1',
      ),
    ).toEqual({
      id: 't2g-t2-1-glow',
      cx: '0.5',
      cy: '0.5',
      r: '0.5',
      fx: '0.4',
      fy: '0.6',
    })
  })

  it('色标出 offset 与 stop-color，颜色过消毒', () => {
    expect(svgStopAttrs({ id: 's1', color: '#0B2738', at: 0.35 })).toEqual({
      offset: '0.35',
      'stop-color': '#0B2738',
    })
    expect(
      svgStopAttrs({ id: 's2', color: '@import url(x)', at: 1 })['stop-color'],
    ).toBe('currentColor')
  })
})

describe('paintVec 的根 <svg>', () => {
  it('viewBox 取 ctx 的盒尺寸，与 unit 档的换算同源', () => {
    expect(paintVec(prim({}), CTX).attrs).toEqual({ viewBox: '0 0 300 120' })
  })

  it('盒尺寸非正数时 viewBox 兜到 1，不产 0 宽的 viewBox', () => {
    const out = paintVec(prim({}), { ...CTX, boxW: 0, boxH: -20 })
    expect(out.attrs['viewBox']).toBe('0 0 1 1')
  })

  it('stretch 才产 preserveAspectRatio=none，不拉伸档留给 SVG 缺省', () => {
    expect(paintVec(prim({ stretch: true }), CTX).attrs).toEqual({
      viewBox: '0 0 300 120',
      preserveAspectRatio: 'none',
    })
  })

  it('样式在基类那份之上加 overflow:visible，贴边的描边不被裁掉外侧半根', () => {
    const out = paintVec(prim({ z: 3, opacity: 0.5 }), CTX)
    expect(out.style['overflow']).toBe('visible')
    expect(out.style['z-index']).toBe('3')
    expect(out.style['opacity']).toBe('0.5')
    expect(out.style['position']).toBe('absolute')
  })

  it('hidden 的枝连 viewBox 都不产', () => {
    expect(paintVec(prim({ hidden: true }), CTX)).toEqual({
      style: {},
      classes: [],
      attrs: {},
    })
  })

  it('keyframes 那一档的类名照基类挂着', () => {
    const out = paintVec(prim({ anim: { kind: 'dash', durationMs: 900 } }), CTX)
    expect(out.classes).toEqual(['t2-anim-dash'])
  })
})
