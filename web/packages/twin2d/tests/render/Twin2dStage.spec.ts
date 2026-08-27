/**
 * @fileoverview 舞台守的契约：`fitMode` 四档的倍率与对齐、量不出容器时只藏起来**不产
 * transform**、自下而上六层的 DOM 顺序、底图与三档图案底、空态那一行，以及 sprite 宿主
 * 在每个 DOM 文档里只挂一次。
 *
 * ⚠ 这几件事错了都不报错：少了 0 尺寸那条保护，`translate(NaN, NaN)` 让整块空白而
 * devtools 里一切正常；层序错了只是「标注跑到节点上面」；漏挂 sprite 时 `<use>` 元素
 * 照样在，图标静默消失。
 */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { twin2dValues } from '../../src/bindingValues'
import { normalizeTwin2dConfig } from '../../src/normalize'
import Twin2dNodeBox from '../../src/render/Twin2dNodeBox.vue'
import Twin2dStage from '../../src/render/Twin2dStage.vue'
import type { Twin2dEdgeState } from '../../src/edgeView'
import type { Twin2dSlotValues } from '../../src/expr'
import type { Twin2dFitMode, Twin2dStatus } from '../../src/kinds'
import type { Twin2dSlotRead } from '../../src/paintText'
import type { Twin2dConfig, Twin2dNode } from '../../src/types'

// ⚠ 拥有 sprite 的舞台在卸载时才把文档级标记还回去，不逐条卸载会让后面的用例全都
// 领不到宿主——而那看起来像「层序错了」
enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** 画布 400×200：非方形，两轴换算写反了才看得出来 */
const CANVAS = { width: 400, height: 200 }

const NODE_STYLE = {
  id: 'ns',
  name: '方块',
  size: { w: 100, h: 60 },
  defaultStatus: 'online',
  prims: [{ id: 'frame', kind: 'box', size: { w: 100, h: 60 } }],
  ports: [
    { id: 'r', at: { kind: 'perim', t: 0.375 }, side: 'right' },
    { id: 'l', at: { kind: 'perim', t: 0.875 }, side: 'left' },
  ],
}

const EDGE_STYLE = {
  id: 'es',
  name: '单线',
  route: 'straight',
  strokes: [{ id: 'core', width: 2, color: 'currentColor' }],
  flow: { enabled: true, dash: [10, 10], durationMs: 800 },
}

const NODES = [
  { id: 'a', styleId: 'ns', x: 0, y: 0, w: 100, h: 60 },
  { id: 'b', styleId: 'ns', x: 260, y: 0, w: 100, h: 60 },
]

const EDGE = {
  id: 'e1',
  styleId: 'es',
  from: { nodeId: 'a', portId: 'r' },
  to: { nodeId: 'b', portId: 'l' },
}

/** 舞台四键的缺省，与组件里那份同值。 */
const VIEW = {
  fitMode: 'contain' as Twin2dFitMode,
  fitPadding: 4,
  animateFlow: false,
  flowSpeed: 1,
}

interface Overrides {
  canvas?: Record<string, unknown>
  nodes?: readonly unknown[]
  styles?: readonly unknown[]
  edges?: readonly unknown[]
  edgeStyles?: readonly unknown[]
  marks?: readonly unknown[]
}

interface Live {
  status?: Readonly<Record<string, Twin2dStatus | null>>
  slots?: Readonly<Record<string, Twin2dSlotValues>>
  readSlot?: (nodeId: string, key: string) => Twin2dSlotRead | null
  edges?: Readonly<Record<string, Twin2dEdgeState>>
  resolveIcon?: (assetRef: string) => string
  resolveImage?: (assetRef: string) => string
}

interface Extra {
  view?: Partial<typeof VIEW>
  live?: Live
  containerSize?: { w: number; h: number } | null
}

function docOf(over: Overrides): Twin2dConfig {
  return normalizeTwin2dConfig({
    canvas: { ...CANVAS, ...over.canvas },
    styles: over.styles ?? [NODE_STYLE],
    edgeStyles: over.edgeStyles ?? [EDGE_STYLE],
    nodes: over.nodes ?? NODES,
    edges: over.edges ?? [],
    marks: over.marks ?? [],
  })
}

function render(over: Overrides = {}, extra: Extra = {}) {
  const doc = docOf(over)
  return mount(Twin2dStage, {
    props: {
      canvas: doc.canvas,
      nodes: doc.nodes,
      edges: doc.edges,
      marks: doc.marks,
      nodeStyles: doc.styles,
      edgeStyles: doc.edgeStyles,
      view: { ...VIEW, ...extra.view },
      live: extra.live ?? {},
      containerSize: extra.containerSize ?? null,
    },
  })
}

type Wrapper = ReturnType<typeof render>

/** ⚠ 容器尺寸必须显式喂：happy-dom 量不出真实布局，`getBoundingClientRect` 恒 0。 */
const BOX = { w: 800, h: 800 }

/** 替掉那一次读数用的矩形：自己量容器那条路只有这么一个办法测。 */
const MEASURED: DOMRect = {
  width: 800,
  height: 800,
  top: 0,
  left: 0,
  right: 800,
  bottom: 800,
  x: 0,
  y: 0,
  toJSON: () => ({}),
}

/** 谁都不做的观察者，只为填 `ResizeObserverCallback` 的第二个参数。 */
const IDLE_OBSERVER: ResizeObserver = {
  observe: () => undefined,
  unobserve: () => undefined,
  disconnect: () => undefined,
}

function viewportStyle(wrapper: Wrapper): string {
  return wrapper.get('.t2-stage__viewport').attributes('style') ?? ''
}

function layerStyle(wrapper: Wrapper, layer: string): string {
  return wrapper.get(`[data-layer="${layer}"]`).attributes('style') ?? ''
}

function spriteCount(wrapper: Wrapper): number {
  return wrapper.findAll('.twin2d-icon-sprite').length
}

/** 一层标注里各条的 id，文档序。 */
function markIds(wrapper: Wrapper, layer: string): string[] {
  return wrapper
    .findAll(`[data-layer="${layer}"] [data-test="mark"]`)
    .map((node) => node.attributes('data-id') ?? '')
}

describe('等比缩放四档', () => {
  it('contain 取两轴较小者并按 fitPadding 留白，居中摆', () => {
    const wrapper = render({}, { containerSize: BOX })

    expect(viewportStyle(wrapper)).toContain(
      'transform: translate(16px, 208px) scale(1.92, 1.92)',
    )
  })

  it('width 填满横轴、顶端对齐', () => {
    const wrapper = render(
      {},
      { view: { fitMode: 'width' }, containerSize: BOX },
    )

    expect(viewportStyle(wrapper)).toContain(
      'transform: translate(0px, 0px) scale(2, 2)',
    )
  })

  it('height 填满竖轴、左对齐', () => {
    const wrapper = render(
      {},
      { view: { fitMode: 'height' }, containerSize: BOX },
    )

    expect(viewportStyle(wrapper)).toContain(
      'transform: translate(0px, 0px) scale(4, 4)',
    )
  })

  it('stretch 两轴各自缩放', () => {
    const wrapper = render(
      {},
      { view: { fitMode: 'stretch' }, containerSize: BOX },
    )

    expect(viewportStyle(wrapper)).toContain(
      'transform: translate(0px, 0px) scale(2, 4)',
    )
  })

  // ⚠ 其余三档的意思就是「把某一轴填满」，再乘一个安全留白就填不满了，而表现是
  // 「配了 width 却两边留白」
  it('fitPadding 只作用在 contain 上', () => {
    const wrapper = render(
      {},
      { view: { fitMode: 'width', fitPadding: 20 }, containerSize: BOX },
    )

    expect(viewportStyle(wrapper)).toContain('scale(2, 2)')
  })

  it('缩放层恒带画布的宽高', () => {
    const style = viewportStyle(render({}, { containerSize: BOX }))

    expect(style).toContain('width: 400px')
    expect(style).toContain('height: 200px')
  })
})

describe('量不出容器尺寸的那一帧', () => {
  // 一个可选 prop 都不给，走组件自己那套缺省
  it('只给必填 props 也渲染得出来', () => {
    const doc = normalizeTwin2dConfig({ canvas: CANVAS, nodes: [] })
    const wrapper = mount(Twin2dStage, {
      props: {
        canvas: doc.canvas,
        nodes: doc.nodes,
        edges: doc.edges,
        marks: doc.marks,
        nodeStyles: doc.styles,
        edgeStyles: doc.edgeStyles,
      },
    })

    expect(wrapper.get('.t2-stage__viewport').attributes('style')).toBe(
      'width: 400px; height: 200px; visibility: hidden;',
    )
  })

  // ⚠ 少了这条保护，transform 里会写出 translate(NaN, NaN)，整块空白而 devtools
  // 里看什么都正常
  it('不产 transform，只给宽高并藏起来', () => {
    const style = viewportStyle(render())

    expect(style).not.toContain('transform')
    expect(style).toContain('visibility: hidden')
    expect(style).toContain('width: 400px')
  })

  it('容器某一轴为 0 时同样只藏起来', () => {
    const style = viewportStyle(render({}, { containerSize: { w: 0, h: 300 } }))

    expect(style).not.toContain('transform')
    expect(style).toContain('visibility: hidden')
  })
})

describe('自己量容器', () => {
  // ⚠ happy-dom 自带的 ResizeObserver 是彻底的空实现（observe / disconnect 都不做事），
  // 所以「装了观察者」与「卸载时断开」只能靠替身证明
  it('容器尺寸变了就重新贴合', async () => {
    const callbacks: ResizeObserverCallback[] = []
    class Fake implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback)
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', Fake)
    const wrapper = render()
    const host = wrapper.get('.t2-stage').element
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(MEASURED)

    callbacks[0]?.([], IDLE_OBSERVER)
    await nextTick()

    expect(viewportStyle(wrapper)).toContain(
      'transform: translate(16px, 208px) scale(1.92, 1.92)',
    )
  })

  it('卸载时把观察者断开', () => {
    const stops: string[] = []
    class Fake implements ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {
        stops.push('off')
      }
    }
    vi.stubGlobal('ResizeObserver', Fake)
    const wrapper = render()

    wrapper.unmount()

    expect(stops).toEqual(['off'])
  })
})

describe('层序', () => {
  it('自下而上是 底图 → 图案 → 下层标注 → 连线 → 节点 → 上层标注', () => {
    const wrapper = render({}, { containerSize: BOX })

    const layers = [...wrapper.get('.t2-stage__viewport').element.children]

    expect(layers.map((el) => el.getAttribute('data-layer'))).toEqual([
      'background',
      'pattern',
      'marks-below',
      'edges',
      'nodes',
      'marks-above',
    ])
  })

  // ⚠ 编辑器与运行态共用这一份分层：两边分法不同的表现是「配 below 的标注在编辑器里
  // 看着在上面、上了大屏跑到下面」
  it('标注按 zOrder 分进上下两层，各自真画出形状来', () => {
    const marks = [
      { id: 'm1', kind: 'rect', zOrder: 'below' },
      { id: 'm2', kind: 'text', text: '标题', zOrder: 'above' },
    ]

    const wrapper = render({ marks })

    expect(markIds(wrapper, 'marks-below')).toEqual(['m1'])
    expect(markIds(wrapper, 'marks-above')).toEqual(['m2'])
  })

  it('两层标注都空时一条形状都不画', () => {
    const wrapper = render()

    expect(markIds(wrapper, 'marks-below')).toEqual([])
    expect(markIds(wrapper, 'marks-above')).toEqual([])
  })

  // ⚠ 两层的 viewBox 跟着画布走：写死成节点层那一份的话，非方形画布上标注会整体错位
  it('两层标注按画布尺寸取 viewBox', () => {
    const marks = [{ id: 'm1', kind: 'rect', zOrder: 'below' }]

    const wrapper = render({ marks })

    expect(
      wrapper.get('[data-layer="marks-below"]').attributes('viewBox'),
    ).toBe('0 0 400 200')
  })
})

describe('底图', () => {
  // ⚠ 两层底的取值出成自定义属性、由组件自己的 scoped 规则接过去：值里带 var() 的标准
  // 属性会被 happy-dom 的 CSSOM 整条丢掉，浏览器上没事、用例里却断言不到
  // ⚠ 底图吃的是**图片**那一条解析槽，不是图标那一条：共用一条时其中一档必然拼错
  // 对象键前缀，而拼错的表现只是那一档 404（§11.4）
  it('素材引用经图片那条解析槽落进 url() 并带上铺法', () => {
    const wrapper = render(
      { canvas: { background: 'asset:7f3a', backgroundFit: 'contain' } },
      { live: { resolveImage: (ref) => `/oss/${ref}` } },
    )

    expect(layerStyle(wrapper, 'background')).toContain(
      '--t2-bg: url("/oss/asset:7f3a") center center / contain no-repeat',
    )
  })

  // ⚠ 未注入解析槽时整层不画，不发一个必 404 的请求
  it('未注入解析槽时素材引用一层都不画', () => {
    const wrapper = render({ canvas: { background: 'asset:7f3a' } })

    expect(layerStyle(wrapper, 'background')).toBe('')
  })

  it('CSS background 简写原样用', () => {
    const wrapper = render({
      canvas: { background: 'linear-gradient(180deg, #04121f, #071a2c)' },
    })

    expect(layerStyle(wrapper, 'background')).toContain(
      '--t2-bg: linear-gradient(',
    )
  })

  // ⚠ 消毒是在挡把请求打到外部的那条路，被拒的值回落成「不画」而不是原样注入
  it('自己写的 url() 被消毒挡掉', () => {
    const wrapper = render({
      canvas: { background: 'url(https://evil.example/x.png)' },
    })

    expect(layerStyle(wrapper, 'background')).toBe('')
  })
})

describe('图案底', () => {
  it('斜织是两层角度对称的等距斜线', () => {
    const wrapper = render({
      canvas: { pattern: 'weave', patternGap: 26, patternWidth: 1 },
    })

    const style = layerStyle(wrapper, 'pattern')
    expect(style).toContain('--t2-pattern: repeating-linear-gradient(45deg')
    expect(style).toContain('repeating-linear-gradient(-45deg')
    expect(style).toContain('transparent 0 26px')
  })

  it('平行线只出一层', () => {
    const style = layerStyle(
      render({ canvas: { pattern: 'lines' } }),
      'pattern',
    )

    expect(style).toContain('--t2-pattern: repeating-linear-gradient(0deg')
    expect(style).not.toContain('-45deg')
  })

  it('点阵靠 background-size 按格铺', () => {
    const wrapper = render({ canvas: { pattern: 'dots', patternGap: 18 } })

    const style = layerStyle(wrapper, 'pattern')
    expect(style).toContain('--t2-pattern: radial-gradient(')
    expect(style).toContain('background-size: 18px 18px')
  })

  // 图案色留空时走兜底表达式：参考项目那几个变量全仓无定义，实际生效的就是兜底
  it('没给图案色时用兜底表达式', () => {
    const style = layerStyle(
      render({ canvas: { pattern: 'lines' } }),
      'pattern',
    )

    expect(style).toContain('color-mix(in srgb, var(--accent-primary) 5%')
  })

  it('none 一档一条声明都不产', () => {
    expect(layerStyle(render({ canvas: { pattern: 'none' } }), 'pattern')).toBe(
      '',
    )
  })
})

describe('空态', () => {
  it('一个节点、一条标注都没有时出那一行字', () => {
    const wrapper = render({ nodes: [], edges: [] })

    expect(wrapper.get('.t2-stage__empty').text()).toBe(
      '这张 2D 孪生还没有画任何节点',
    )
  })

  it('有节点时不出空态', () => {
    expect(render().find('.t2-stage__empty').exists()).toBe(false)
  })

  // 只有标注的纯图框是合法用法，盖一行「还没画任何节点」在上面是错的
  it('只有标注时不算空', () => {
    const marks = [{ id: 'm1', kind: 'rect', zOrder: 'above' }]

    const wrapper = render({ nodes: [], edges: [], marks })

    expect(wrapper.find('.t2-stage__empty').exists()).toBe(false)
  })
})

describe('sprite 宿主', () => {
  it('挂在舞台根上', () => {
    const wrapper = render()

    expect(
      wrapper.get('.t2-stage').element.querySelector('.twin2d-icon-sprite'),
    ).not.toBeNull()
  })

  // ⚠ 挂两份时 symbol id 在整个文档里重号，浏览器只认头一个；漏挂则 <use> 解析不到
  // 任何目标，图标静默消失而元素还在
  it('同一个 DOM 文档里只挂一次', () => {
    const first = render()
    const second = render()

    expect(spriteCount(first)).toBe(1)
    expect(spriteCount(second)).toBe(0)
  })

  it('拥有者卸载后下一个舞台接手', () => {
    const first = render()
    first.unmount()

    expect(spriteCount(render())).toBe(1)
  })
})

describe('节点层', () => {
  it('每个节点一个节点件，样式按 styleId 取', () => {
    const boxes = render().findAllComponents(Twin2dNodeBox)

    expect(boxes).toHaveLength(2)
    expect((boxes[0]?.props('node') as Twin2dNode).id).toBe('a')
  })

  // ⚠ 样式悬空时整个不画：造一个空壳出来会在图上留一块吃指针的透明区
  it('样式悬空的节点不画', () => {
    const nodes = [NODES[0], { id: 'c', styleId: 'gone', x: 0, y: 0 }]

    const boxes = render({ nodes }).findAllComponents(Twin2dNodeBox)

    expect(boxes).toHaveLength(1)
  })

  // ⚠ 运行态按节点 id 取而不按下标：两个 props 各自变化时下标会错位，表现是
  // 「状态点串到隔壁节点上」
  it('状态覆盖按节点 id 喂到对应节点', () => {
    const live: Live = { status: { b: 'alarm' } }

    const boxes = render({}, { live }).findAllComponents(Twin2dNodeBox)

    expect(boxes[0]?.props('status')).toBeNull()
    expect(boxes[1]?.props('status')).toBe('alarm')
  })

  it('读数按节点 id 喂到对应节点', () => {
    const live: Live = { slots: { a: new Map([['temp', 60]]) } }

    const boxes = render({}, { live }).findAllComponents(Twin2dNodeBox)

    expect(
      (boxes[0]?.props('slotValues') as Twin2dSlotValues).get('temp'),
    ).toBe(60)
    expect((boxes[1]?.props('slotValues') as Twin2dSlotValues).size).toBe(0)
  })

  it('取数槽带上节点 id 再往下递', () => {
    const seen: string[] = []
    const live: Live = {
      readSlot: (nodeId, key) => {
        seen.push(`${nodeId}/${key}`)
        return null
      },
    }
    const boxes = render({}, { live }).findAllComponents(Twin2dNodeBox)
    const read = boxes[0]?.props('readSlot') as (
      key: string,
    ) => Twin2dSlotRead | null

    read('temp')

    expect(seen).toEqual(['a/temp'])
  })

  it('实例前缀用节点 id，同页两张图的局部渐变 id 不会撞', () => {
    const boxes = render().findAllComponents(Twin2dNodeBox)

    expect(boxes[0]?.props('idPrefix')).toBe('a')
    expect(boxes[1]?.props('idPrefix')).toBe('b')
  })
})

describe('连线层', () => {
  it('连线画在连线层里', () => {
    const wrapper = render({ edges: [EDGE] })

    expect(wrapper.findAll('[data-test="edge"]')).toHaveLength(1)
  })

  it('流动动画的总闸与倍率递给连线层', () => {
    const wrapper = render(
      { edges: [EDGE] },
      { view: { animateFlow: true, flowSpeed: 2 } },
    )

    expect(wrapper.get('[data-test="edge"]').attributes('style')).toContain(
      '--t2-anim-dur: 400ms',
    )
  })

  it('连线运行态按连线 id 喂', () => {
    const live: Live = {
      edges: { e1: { active: false, reversed: false, label: '' } },
    }

    const wrapper = render({ edges: [EDGE] }, { live })

    expect(wrapper.get('[data-test="edge"]').attributes('style')).toContain(
      'opacity',
    )
  })

  it('连线层按画布尺寸出 viewBox', () => {
    const wrapper = render({ edges: [EDGE] })

    expect(wrapper.get('.t2-edges').attributes('viewBox')).toBe('0 0 400 200')
  })
})

// ⚠ 一张普通对象上 `slots['constructor']` 取到的是 `Object` 构造函数而不是 undefined，
// `?? EMPTY_SLOTS` 兜不住它（函数不是 nullish），下游 `.get()` 当场 TypeError 整块白掉
describe('实体 id 撞上原型链上的名字', () => {
  const SLOT_STYLE = {
    id: 'ns-slot',
    name: '带读数的方块',
    size: { w: 100, h: 60 },
    defaultStatus: 'online',
    slots: [{ key: 'temp', label: '温度' }],
    prims: [
      {
        id: 'frame',
        kind: 'box',
        size: { w: 100, h: 60 },
        // ⚠ 这条 `when` 是这两条用例的要害：条件求值会对读数表调 `.get()`，
        // 表里落进一个 `Object` 构造函数时正是在这儿 TypeError，整块大屏白掉
        children: [
          {
            id: 'val',
            kind: 'txt',
            src: { kind: 'slot', slot: 'temp' },
            when: { kind: 'has', slots: ['temp'], mode: 'any' },
          },
        ],
      },
    ],
  }
  const PROTO_NODE = [
    { id: 'constructor', styleId: 'ns-slot', x: 0, y: 0, w: 100, h: 60 },
  ]

  it('叫 constructor 的节点一个读数都没绑时照常画，不从原型链上拿到函数', () => {
    const over: Overrides = { styles: [SLOT_STYLE], nodes: PROTO_NODE }
    const values = twin2dValues(docOf(over), {})

    const wrapper = render(over, {
      containerSize: BOX,
      live: { slots: values.slots, readSlot: values.readSlot },
    })

    expect(wrapper.findAllComponents(Twin2dNodeBox)).toHaveLength(1)
    expect(wrapper.text()).not.toContain('60')
  })

  it('绑上读数之后照常画出它自己那一份', () => {
    const over: Overrides = { styles: [SLOT_STYLE], nodes: PROTO_NODE }
    const values = twin2dValues(docOf(over), { nodeValues: [{ value: 60 }] })

    const wrapper = render(over, {
      containerSize: BOX,
      live: { slots: values.slots, readSlot: values.readSlot },
    })

    expect(wrapper.findAllComponents(Twin2dNodeBox)).toHaveLength(1)
    expect(wrapper.text()).toContain('60')
  })
})
