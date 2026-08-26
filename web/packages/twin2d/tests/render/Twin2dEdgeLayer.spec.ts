/**
 * @fileoverview 契约：连线层把 `edgeView` 算好的东西**原样**贴到 SVG 上——多遍描边的
 * 元素数与层序、两处端点箭头的朝向与空心线宽、流动动画的三级合成（总闸 → 样式开关 →
 * 时长 ÷ 倍率，终点由 dash 求和算出）、非活跃档、带拐点的反向渲染路径不自交、
 * 沿路径的标签与底板，以及端口上引脚符号的线宽与「连线从引脚外端起画」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { normalizeTwin2dConfig } from '../../src/normalize'
import Twin2dEdgeLayer from '../../src/render/Twin2dEdgeLayer.vue'
import type { Twin2dEdgeState } from '../../src/edgeView'

/** 引脚符号：0..1 的一段横线，按 length 放大成 12px 伸出 */
const PIN = {
  shape: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
  strokes: [{ id: 'pin-0', width: 3, color: 'currentColor' }],
  length: 12,
}

const NODE_STYLE = {
  id: 'ns',
  name: '方块',
  size: { w: 100, h: 60 },
  ports: [
    { id: 'r', at: { kind: 'perim', t: 0.375 }, side: 'right' },
    { id: 'l', at: { kind: 'perim', t: 0.875 }, side: 'left', marker: PIN },
  ],
}

const EDGE_STYLE = {
  id: 'es',
  name: '双线',
  accent: '--edge-hot',
  route: 'straight',
  cornerRadius: 0,
  strokes: [
    { id: 'base', width: 6, color: 'var(--surface-base)' },
    { id: 'core', width: 2, color: 'currentColor', dash: [4, 4] },
  ],
  endMarker: { kind: 'arrow' },
  flow: { enabled: true, dash: [10, 10], durationMs: 800 },
  label: { font: { size: 14 } },
}

const NODES = [
  { id: 'a', styleId: 'ns', x: 0, y: 0, w: 100, h: 60 },
  { id: 'b', styleId: 'ns', x: 400, y: 0, w: 100, h: 60 },
]

/** 两端各取一处周长参数：a 的右边中点 (100,30) → b 的左边中点 (400,30) */
const EDGE = {
  id: 'e1',
  styleId: 'es',
  from: { nodeId: 'a', t: 0.375 },
  to: { nodeId: 'b', t: 0.875 },
}

interface Overrides {
  edges?: readonly unknown[]
  edgeStyles?: readonly unknown[]
  styles?: readonly unknown[]
  nodes?: readonly unknown[]
}

interface Runtime {
  states?: Record<string, Twin2dEdgeState>
  animateFlow?: boolean
  flowSpeed?: number
}

function render(over: Overrides = {}, runtime: Runtime = {}) {
  const doc = normalizeTwin2dConfig({
    canvas: { width: 800, height: 400 },
    styles: [NODE_STYLE],
    edgeStyles: [EDGE_STYLE],
    nodes: NODES,
    edges: [EDGE],
    ...over,
  })
  return mount(Twin2dEdgeLayer, {
    props: {
      edges: doc.edges,
      edgeStyles: doc.edgeStyles,
      nodes: doc.nodes,
      nodeStyles: doc.styles,
      width: doc.canvas.width,
      height: doc.canvas.height,
      ...runtime,
    },
  })
}

type Wrapper = ReturnType<typeof render>

function strokes(wrapper: Wrapper) {
  return wrapper.findAll('[data-test="edge-stroke"]')
}

function edgeStyleAttr(wrapper: Wrapper): string {
  return wrapper.get('[data-test="edge"]').attributes('style') ?? ''
}

function markerPoints(wrapper: Wrapper, id: string): string {
  return (
    wrapper
      .get(`[data-test="edge-marker"][data-id="${id}"]`)
      .attributes('points') ?? ''
  )
}

function tipOf(points: string): string {
  return points.split(' ')[0] ?? ''
}

/** 带底板的一条连线：只改底板/字体里的几项，其余照 EDGE_STYLE */
function labelBoxOf(patch: Record<string, unknown>) {
  const { font, ...box } = patch
  return render({
    edges: [{ ...EDGE, label: '母线' }],
    edgeStyles: [
      {
        ...EDGE_STYLE,
        label: {
          font: font ?? { size: 14 },
          box: {
            fill: 'var(--surface-base)',
            radius: 'pill',
            pad: [2, 6, 2, 6],
            border: { width: 1, color: 'var(--border-base)' },
            ...box,
          },
        },
      },
    ],
  }).get('[data-test="edge-label-box"]')
}

/** 只改连线样式里的几项，其余照 EDGE_STYLE */
function withStyle(patch: Record<string, unknown>): Overrides {
  return { edgeStyles: [{ ...EDGE_STYLE, ...patch }] }
}

/** 只改连线实例里的几项 */
function withEdge(patch: Record<string, unknown>): Overrides {
  return { edges: [{ ...EDGE, ...patch }] }
}

describe('多遍描边', () => {
  it('一遍描边一个 path，文档序即从下往上', () => {
    const paths = strokes(render())

    expect(paths).toHaveLength(2)
    expect(paths[0]?.attributes('stroke-width')).toBe('6')
    expect(paths[1]?.attributes('stroke-width')).toBe('2')
  })

  it('每一遍都贴同一条 path 的 d，且恒带 fill="none"', () => {
    const paths = strokes(render())

    expect(paths[0]?.attributes('d')).toBe('M100,30 L400,30')
    expect(paths[1]?.attributes('d')).toBe('M100,30 L400,30')
    expect(paths[0]?.attributes('fill')).toBe('none')
  })

  it('边色三级兜底链落在组上的 --t2-accent，描边靠 currentColor 取它', () => {
    expect(edgeStyleAttr(render())).toContain(
      '--t2-accent: var(--edge-hot, var(--accent-primary))',
    )
  })
})

describe('端点标记', () => {
  it('缺省只画末端箭头，尖端落在终点上', () => {
    const wrapper = render()

    expect(wrapper.findAll('[data-test="edge-marker"]')).toHaveLength(1)
    expect(tipOf(markerPoints(wrapper, 'end'))).toBe('400,30')
  })

  it('起点的箭头朝外，不跟末端指向同一头', () => {
    const wrapper = render(withStyle({ startMarker: { kind: 'arrow' } }))

    expect(tipOf(markerPoints(wrapper, 'start'))).toBe('100,30')
    expect(tipOf(markerPoints(wrapper, 'end'))).toBe('400,30')
  })

  it('实心箭头用边色填充，透明度是 0.82 而不是 1', () => {
    const marker = render().get('[data-test="edge-marker"][data-id="end"]')

    expect(marker.attributes('fill')).toBe('currentColor')
    expect(marker.attributes('opacity')).toBe('0.82')
  })

  it('空心箭头的线宽跟随最上面那一遍描边', () => {
    const wrapper = render(
      withStyle({ endMarker: { kind: 'arrow', filled: false } }),
    )
    const marker = wrapper.get('[data-test="edge-marker"][data-id="end"]')

    expect(marker.attributes('fill')).toBe('none')
    expect(marker.attributes('stroke')).toBe('currentColor')
    expect(marker.attributes('stroke-width')).toBe('2')
  })

  it('marker 是 none 的那一档一个元素都不产', () => {
    const wrapper = render(withStyle({ endMarker: { kind: 'none' } }))

    expect(wrapper.findAll('[data-test="edge-marker"]')).toHaveLength(0)
  })
})

describe('流动动画的合成', () => {
  it('总闸开着时最上面那一遍挂 twin2d.scss 的流动类，底下那一遍不挂', () => {
    const paths = strokes(render({}, { animateFlow: true }))

    expect(paths[0]?.classes()).not.toContain('t2-anim-dash')
    expect(paths[1]?.classes()).toContain('t2-anim-dash')
  })

  it('时长 = 基准时长 ÷ 倍率，dash 由 flow 给', () => {
    const wrapper = render({}, { animateFlow: true, flowSpeed: 2 })

    expect(edgeStyleAttr(wrapper)).toContain('--t2-anim-dur: 400ms')
    expect(strokes(wrapper)[1]?.attributes('stroke-dasharray')).toBe('10 10')
  })

  it('倍率越界按上下限夹取，不算出 0 或负的时长', () => {
    const wrapper = render({}, { animateFlow: true, flowSpeed: 99 })

    expect(edgeStyleAttr(wrapper)).toContain('--t2-anim-dur: 160ms')
  })

  it('dashoffset 终点是 dash 求和的负值，不写死 -20', () => {
    const wrapper = render(
      withStyle({ flow: { enabled: true, dash: [12, 4], durationMs: 800 } }),
      { animateFlow: true },
    )

    expect(edgeStyleAttr(wrapper)).toContain('--t2-dash-end: -16px')
  })

  it('奇数段的 dash 终点翻一倍：SVG 自己把序列翻了一倍', () => {
    const wrapper = render(
      withStyle({ flow: { enabled: true, dash: [6], durationMs: 800 } }),
      { animateFlow: true },
    )

    expect(edgeStyleAttr(wrapper)).toContain('--t2-dash-end: -12px')
  })

  it('animateFlow=false 时 flow.enabled=true 也不动', () => {
    const wrapper = render({}, { animateFlow: false })

    expect(strokes(wrapper)[1]?.classes()).not.toContain('t2-anim-dash')
    expect(edgeStyleAttr(wrapper)).not.toContain('--t2-anim-dur')
  })

  it('样式里没开流动时总闸开着也不动', () => {
    const wrapper = render(
      withStyle({ flow: { enabled: false, dash: [10, 10], durationMs: 800 } }),
      { animateFlow: true },
    )

    expect(strokes(wrapper)[1]?.classes()).not.toContain('t2-anim-dash')
  })
})

describe('非活跃档', () => {
  const OFF: Record<string, Twin2dEdgeState> = {
    e1: { active: false, reversed: false, label: '' },
  }

  it('照常渲染，只是整组压透明度', () => {
    const wrapper = render({}, { states: OFF })

    expect(strokes(wrapper)).toHaveLength(2)
    expect(edgeStyleAttr(wrapper)).toContain('opacity: 0.5')
  })

  it('dashOff 把虚线拉直成实线', () => {
    const wrapper = render({}, { states: OFF })

    expect(strokes(wrapper)[1]?.attributes('stroke-dasharray')).toBeUndefined()
  })

  it('非活跃的边即使总闸开着也不动', () => {
    const wrapper = render({}, { states: OFF, animateFlow: true })

    expect(strokes(wrapper)[1]?.classes()).not.toContain('t2-anim-dash')
  })

  it('inactive.color 非空时整条改色', () => {
    const wrapper = render(
      withStyle({ inactive: { opacity: 0.4, color: 'var(--text-muted)' } }),
      { states: OFF },
    )

    expect(strokes(wrapper)[0]?.attributes('stroke')).toBe('var(--text-muted)')
  })
})

describe('反向渲染', () => {
  const REVERSED: Record<string, Twin2dEdgeState> = {
    e1: { active: true, reversed: true, label: '' },
  }

  it('反向的边箭头调头', () => {
    const wrapper = render({}, { states: REVERSED })

    expect(tipOf(markerPoints(wrapper, 'end'))).toBe('100,30')
  })

  it('带拐点时拐点整体反序，路径不自交', () => {
    const waypoints = [
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ]
    const forward = render(withEdge({ waypoints }))
    const backward = render(withEdge({ waypoints }), { states: REVERSED })

    expect(strokes(forward)[0]?.attributes('d')).toBe(
      'M100,30 L200,200 L300,300 L400,30',
    )
    expect(strokes(backward)[0]?.attributes('d')).toBe(
      'M400,30 L300,300 L200,200 L100,30',
    )
  })
})

describe('标签', () => {
  it('落在 edgePath 给出的沿路径锚点上', () => {
    const wrapper = render(withEdge({ label: '母线 A', labelAt: 0.25 }))
    const label = wrapper.get('[data-test="edge-label"]')

    expect(label.text()).toBe('母线 A')
    expect(label.attributes('x')).toBe('175')
    expect(label.attributes('y')).toBe('30')
  })

  it('绑定值上的标签盖过字面量', () => {
    const wrapper = render(withEdge({ label: '母线 A' }), {
      states: { e1: { active: true, reversed: false, label: '42.5 t/h' } },
    })

    expect(wrapper.get('[data-test="edge-label"]').text()).toBe('42.5 t/h')
  })

  it('字体走 fill 上色，不是 color', () => {
    const wrapper = render({
      edges: [{ ...EDGE, label: '母线' }],
      edgeStyles: [
        {
          ...EDGE_STYLE,
          label: { font: { size: 14, color: 'var(--text-base)' } },
        },
      ],
    })
    const style = wrapper.get('[data-test="edge-label"]').attributes('style')

    expect(style).toContain('fill: var(--text-base)')
    expect(style).toContain('font-size: 14px')
  })

  it('没有文字时标签与底板一个元素都不产', () => {
    const wrapper = render()

    expect(wrapper.find('[data-test="edge-label"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="edge-label-box"]').exists()).toBe(false)
  })

  it('配了 box 才画底板，药丸档的 rx 是半高', () => {
    const wrapper = render({
      edges: [{ ...EDGE, label: '母线' }],
      edgeStyles: [
        {
          ...EDGE_STYLE,
          label: {
            font: { size: 14 },
            box: {
              fill: 'var(--surface-base)',
              radius: 'pill',
              pad: [2, 6, 2, 6],
              border: { width: 1, color: 'var(--border-base)' },
            },
          },
        },
      ],
    })
    const box = wrapper.get('[data-test="edge-label-box"]')

    expect(box.attributes('height')).toBe('20.8')
    expect(box.attributes('rx')).toBe('10.4')
    expect(box.attributes('fill')).toBe('var(--surface-base)')
    expect(box.attributes('stroke-width')).toBe('1')
  })
})

describe('引脚符号', () => {
  it('只给配了 marker 的端口画，几何按 length 见方放大', () => {
    const pins = render().findAll('[data-test="pin"]')

    expect(pins).toHaveLength(2)
    expect(pins[0]?.attributes('transform')).toBe('translate(0 30) rotate(180)')
    expect(pins[0]?.get('line').attributes('x2')).toBe('12')
  })

  it('线宽是设计像素，不跟着 length 一起放大', () => {
    const pin = render().findAll('[data-test="pin"]')[0]

    expect(pin?.get('line').attributes('stroke-width')).toBe('3')
  })

  it('连线从引脚外端起画', () => {
    const wrapper = render(
      withEdge({
        from: { nodeId: 'a', portId: 'r' },
        to: { nodeId: 'b', portId: 'l' },
      }),
    )

    expect(strokes(wrapper)[0]?.attributes('d')).toBe('M100,30 L388,30')
  })

  it('端口寻不到时这一端退回朝向对方中心', () => {
    const wrapper = render(
      withEdge({
        from: { nodeId: 'a', portId: 'r' },
        to: { nodeId: 'b', portId: 'zzz' },
      }),
    )

    expect(strokes(wrapper)[0]?.attributes('d')).toBe('M100,30 L400,30')
  })
})

describe('挂不上的连线', () => {
  it('样式寻不到时整条不画，不画一条到 (0,0) 的斜线', () => {
    const wrapper = render(withEdge({ styleId: 'nope' }))

    expect(wrapper.findAll('[data-test="edge"]')).toHaveLength(0)
  })

  it('节点不在这一层的名单里时整条不画', () => {
    const doc = normalizeTwin2dConfig({
      canvas: { width: 800, height: 400 },
      styles: [NODE_STYLE],
      edgeStyles: [EDGE_STYLE],
      nodes: NODES,
      edges: [EDGE],
    })
    const wrapper = mount(Twin2dEdgeLayer, {
      props: {
        edges: doc.edges,
        edgeStyles: doc.edgeStyles,
        nodes: doc.nodes.filter((node) => node.id === 'a'),
        nodeStyles: doc.styles,
        width: 800,
        height: 400,
      },
    })

    expect(wrapper.findAll('[data-test="edge"]')).toHaveLength(0)
  })

  it('节点样式寻不到时整条不画', () => {
    const wrapper = render({
      nodes: [{ id: 'a', styleId: 'gone', x: 0, y: 0 }, NODES[1]],
    })

    expect(wrapper.findAll('[data-test="edge"]')).toHaveLength(0)
  })
})

describe('样式里那些各有分支的档位', () => {
  it('字体五键缺席的一项不产声明，给了就逐项落下来', () => {
    const wrapper = render({
      edges: [{ ...EDGE, label: '母线' }],
      edgeStyles: [
        {
          ...EDGE_STYLE,
          label: {
            font: {
              family: 'var(--font-digit)',
              size: 16,
              weight: 600,
              letterSpacing: 0.4,
            },
          },
        },
      ],
    })
    const style = wrapper.get('[data-test="edge-label"]').attributes('style')

    expect(style).toContain('font-family: var(--font-digit)')
    expect(style).toContain('font-weight: 600')
    expect(style).toContain('letter-spacing: 0.4px')
  })

  it('底板圆角给一个数就直用，四角分别给时取左上那一个', () => {
    const one = labelBoxOf({ radius: 6 })
    const four = labelBoxOf({ radius: [3, 9, 9, 9] })

    expect(one.attributes('rx')).toBe('6')
    expect(four.attributes('rx')).toBe('3')
  })

  it('底板的边框是 none 或零宽时不产描边属性', () => {
    const box = labelBoxOf({ border: { width: 0, color: 'var(--x)' } })

    expect(box.attributes('stroke-width')).toBeUndefined()
    expect(box.attributes('stroke')).toBeUndefined()
  })

  it('字号缺省 12：底板高度按它算', () => {
    const box = labelBoxOf({ font: {} })

    expect(box.attributes('height')).toBe('18.4')
  })

  it('连线上写死的走线档盖过样式，两边都跟随时收底到正交', () => {
    const own = render(withEdge({ route: 'bezier' }))
    const auto = render({
      edges: [EDGE],
      edgeStyles: [{ ...EDGE_STYLE, route: 'auto' }],
    })

    expect(strokes(own)[0]?.attributes('d')).toContain('C')
    expect(strokes(auto)[0]?.attributes('d')).toBe('M100,30 L400,30')
  })

  it('单遍大 width 的母线：流动就加在那一遍上', () => {
    const wrapper = render(
      withStyle({ strokes: [{ id: 'bus', width: 10, color: 'currentColor' }] }),
      { animateFlow: true },
    )
    const paths = strokes(wrapper)

    expect(paths).toHaveLength(1)
    expect(paths[0]?.classes()).toContain('t2-anim-dash')
  })

  it('dashOff 关掉时非活跃的边照旧是虚线', () => {
    const wrapper = render(
      withStyle({ inactive: { opacity: 0.5, dashOff: false } }),
      { states: { e1: { active: false, reversed: false, label: '' } } },
    )

    expect(strokes(wrapper)[1]?.attributes('stroke-dasharray')).toBe('4 4')
  })

  it('倍率取不到数时按缺省 1 算，不出 NaN 的时长', () => {
    const wrapper = render({}, { animateFlow: true, flowSpeed: Number.NaN })

    expect(edgeStyleAttr(wrapper)).toContain('--t2-anim-dur: 800ms')
  })

  it('一遍描边都没有时空心箭头的线宽退到 1', () => {
    const doc = normalizeTwin2dConfig({
      canvas: { width: 800, height: 400 },
      styles: [NODE_STYLE],
      edgeStyles: [
        { ...EDGE_STYLE, endMarker: { kind: 'arrow', filled: false } },
      ],
      nodes: NODES,
      edges: [EDGE],
    })
    const wrapper = mount(Twin2dEdgeLayer, {
      props: {
        edges: doc.edges,
        edgeStyles: doc.edgeStyles.map((one) => ({ ...one, strokes: [] })),
        nodes: doc.nodes,
        nodeStyles: doc.styles,
        width: 800,
        height: 400,
      },
    })

    expect(
      wrapper
        .get('[data-test="edge-marker"][data-id="end"]')
        .attributes('stroke-width'),
    ).toBe('1')
  })

  it('引脚有填充时填充层排在描边下面', () => {
    const wrapper = render({
      styles: [
        {
          ...NODE_STYLE,
          ports: [
            {
              id: 'l',
              at: { kind: 'perim', t: 0.875 },
              side: 'left',
              marker: {
                ...PIN,
                shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1 },
                fill: { kind: 'color', color: 'var(--surface-base)' },
              },
            },
          ],
        },
      ],
    })
    const pin = wrapper.findAll('[data-test="pin"]')[0]
    const parts = pin === undefined ? [] : pin.findAll('rect')

    expect(parts).toHaveLength(2)
    expect(parts[0]?.attributes('fill')).toBe('var(--surface-base)')
    expect(parts[1]?.attributes('stroke-width')).toBe('3')
  })
})

describe('转过的节点', () => {
  it('周长参数落在节点自己的盒上，转 90° 后端点跟着符号转', () => {
    const wrapper = render({
      nodes: [{ ...NODES[0], rotate: 90 }, NODES[1]],
    })

    expect(strokes(wrapper)[0]?.attributes('d')).toBe('M50,80 L400,30')
  })
})

describe('舞台接缝', () => {
  it('viewBox 按画布尺寸出，整层对读屏隐藏', () => {
    const svg = render().get('svg')

    expect(svg.attributes('viewBox')).toBe('0 0 800 400')
    expect(svg.attributes('aria-hidden')).toBe('true')
  })

  it('画布尺寸为 0 时兜到 1，不出 viewBox="0 0 0 0"', () => {
    const wrapper = mount(Twin2dEdgeLayer, {
      props: {
        edges: [],
        edgeStyles: [],
        nodes: [],
        nodeStyles: [],
        width: 0,
        height: 0,
      },
    })

    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 1 1')
  })
})
