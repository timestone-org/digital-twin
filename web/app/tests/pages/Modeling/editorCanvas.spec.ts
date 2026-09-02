/**
 * @fileoverview 画布组件：拖节点只在松手时提交一次、按住接点是拉线不是拖卡片、
 * 松手落在卡片上也算连上、连线不合法当场给人话、框选算命中、从算子面板拖进来
 * 落件、右键弹菜单、只读时手势全不生效。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import EditorCanvas from '@/pages/Modeling/Canvas/components/EditorCanvas.vue'
import { OPERATOR_MIME } from '@/pages/Modeling/Canvas/scripts/dragMime'
import type { NodeRuntime } from '@/pages/Modeling/Canvas/scripts/nodeState'

function operator(code: string, inputs: string[], outputs: string[]) {
  const port = (name: string) => ({
    name,
    contract: 'frame',
    label: name,
    is_required: true,
    description: '',
  })
  return {
    code,
    name: code,
    description: '',
    category: 'preprocess',
    spec_version: '1',
    icon: 'workflow',
    inputs: inputs.map(port),
    outputs: outputs.map(port),
    config_schema: {},
    fit_required: false,
    serving_enabled: false,
    serving_window_required: false,
    serving_channel: 'json',
  } satisfies ModelingOperator
}

const OPERATORS = new Map<string, ModelingOperator>([
  ['src', operator('src', [], ['out'])],
  ['mid', operator('mid', ['in'], ['out'])],
])

const GRAPH: ModelingGraph = {
  format_version: '1',
  nodes: [
    {
      id: 'a',
      operator: 'src',
      alias: '',
      position: { left: 0, top: 0 },
      config: {},
    },
    {
      id: 'b',
      operator: 'mid',
      alias: '',
      position: { left: 300, top: 0 },
      config: {},
    },
  ],
  edges: [],
}

function open(
  over: {
    isReadonly?: boolean
    graph?: ModelingGraph
    isSnapping?: boolean
    selection?: { nodes: string[]; edges: string[] }
  } = {},
) {
  return mount(EditorCanvas, {
    attachTo: document.body,
    props: {
      graph: over.graph ?? GRAPH,
      operators: OPERATORS,
      runtime: new Map<string, NodeRuntime>(),
      selection: over.selection ?? { nodes: [], edges: [] },
      isReadonly: over.isReadonly ?? false,
      // 吸附默认关掉：开着的话拖动的位移会被吸到邻居的边线上，用例断言的是原始位移
      isSnapping: over.isSnapping ?? false,
    },
  })
}

function move(left: number, top: number): void {
  window.dispatchEvent(
    new PointerEvent('pointermove', { clientX: left, clientY: top }),
  )
}

function up(target: EventTarget = window): void {
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('画布组件', () => {
  it('每个节点都渲染成一张卡片', () => {
    const wrapper = open()

    expect(wrapper.findAll('.dt-ml-node')).toHaveLength(2)
  })

  it('按在卡片上是选中它', async () => {
    const wrapper = open()

    await wrapper.findAll('.dt-ml-canvas__node')[0]?.trigger('pointerdown')

    expect(wrapper.emitted('pickNode')?.[0]).toEqual(['a', false])
  })

  it('按住 shift 是加选', async () => {
    const wrapper = open()

    await wrapper
      .findAll('.dt-ml-canvas__node')[0]
      ?.trigger('pointerdown', { shiftKey: true })

    expect(wrapper.emitted('pickNode')?.[0]).toEqual(['a', true])
  })

  it('拖一段之后只在松手时提交一次位置', async () => {
    const wrapper = open()
    await wrapper.findAll('.dt-ml-canvas__node')[0]?.trigger('pointerdown', {
      clientX: 0,
      clientY: 0,
    })

    move(40, 30)
    move(60, 50)
    up()

    expect(wrapper.emitted('moveNodes')).toHaveLength(1)
  })

  it('按住输出接点是拉线，不是拖整张卡片', async () => {
    const wrapper = open()
    const port = wrapper.find('.dt-ml-node__port--out')

    await port.trigger('pointerdown', { clientX: 0, clientY: 0 })
    move(150, 0)

    expect(wrapper.emitted('moveNodes')).toBeUndefined()
    expect(wrapper.find('.dt-ml-edges__line--pending').exists()).toBe(true)
  })

  it('连到合法的入口上就发 connect', async () => {
    const wrapper = open()
    const out = wrapper.findAll('.dt-ml-node__port--out')[0]
    const into = wrapper.find('.dt-ml-node__port--in')

    await out?.trigger('pointerdown', { clientX: 0, clientY: 0 })
    move(300, 0)
    up(into.element)

    expect(wrapper.emitted('connect')?.[0]).toEqual([
      { node: 'a', port: 'out', side: 'out' },
      { node: 'b', port: 'in', side: 'in' },
    ])
  })

  it('连回自己身上时不连，并把人话交给页面去弹', async () => {
    const wrapper = open()
    const node = wrapper.findAll('.dt-ml-canvas__node')[1]
    const out = node?.find('.dt-ml-node__port--out')
    const into = node?.find('.dt-ml-node__port--in')

    await out?.trigger('pointerdown', { clientX: 300, clientY: 0 })
    move(300, 0)
    if (into !== undefined) up(into.element)

    expect(wrapper.emitted('connect')).toBeUndefined()
    expect(String(wrapper.emitted('reject')?.[0]?.[0])).toContain('自己')
  })

  it('在空白处拖是框选，松手时给出落在框里的节点', async () => {
    const wrapper = open()
    const surface = wrapper.find('.dt-ml-canvas')

    await surface.trigger('pointerdown', { clientX: 0, clientY: 0 })
    move(400, 200)
    up()

    expect(wrapper.emitted('boxSelect')?.[0]?.[0]).toEqual(['a', 'b'])
  })

  it('框只圈住一个时另一个不算命中', async () => {
    const wrapper = open()
    const surface = wrapper.find('.dt-ml-canvas')

    await surface.trigger('pointerdown', { clientX: 0, clientY: 0 })
    move(100, 200)
    up()

    expect(wrapper.emitted('boxSelect')?.[0]?.[0]).toEqual(['a'])
  })

  it('点空白处先清掉选中', async () => {
    const wrapper = open()

    await wrapper.find('.dt-ml-canvas').trigger('pointerdown')

    expect(wrapper.emitted('pickNothing')).toHaveLength(1)
  })

  it('只读时拖不动节点，空白处只能平移', async () => {
    const wrapper = open({ isReadonly: true })
    await wrapper.findAll('.dt-ml-canvas__node')[0]?.trigger('pointerdown', {
      clientX: 0,
      clientY: 0,
    })

    move(60, 50)
    up()

    expect(wrapper.emitted('moveNodes')).toBeUndefined()
  })

  it('只读时按接点也拉不出线来', async () => {
    const wrapper = open({ isReadonly: true })

    await wrapper
      .find('.dt-ml-node__port--out')
      .trigger('pointerdown', { clientX: 0, clientY: 0 })
    move(150, 0)

    expect(wrapper.find('.dt-ml-edges__line--pending').exists()).toBe(false)
  })

  it('滚轮缩放，画布跟着换比例', async () => {
    const wrapper = open()
    const before = wrapper.find('.dt-ml-canvas__world').attributes('style')

    await wrapper.find('.dt-ml-canvas').trigger('wheel', { deltaY: -100 })

    expect(wrapper.find('.dt-ml-canvas__world').attributes('style')).not.toBe(
      before,
    )
  })

  it('已有的边画成一条线，点它就选中', async () => {
    const wrapper = open({
      graph: {
        ...GRAPH,
        edges: [
          {
            id: 'a:out->b:in',
            from_node: 'a',
            from_port: 'out',
            to_node: 'b',
            to_port: 'in',
          },
        ],
      },
    })

    await wrapper.find('.dt-ml-edges__hit').trigger('pointerdown')

    expect(wrapper.emitted('pickEdge')?.[0]).toEqual(['a:out->b:in'])
  })

  it('两端认不出来的边不画，而不是画到原点去', () => {
    const wrapper = open({
      graph: {
        ...GRAPH,
        edges: [
          {
            id: '幽灵',
            from_node: '不存在',
            from_port: 'out',
            to_node: 'b',
            to_port: 'in',
          },
        ],
      },
    })

    expect(wrapper.findAll('.dt-ml-edges__line')).toHaveLength(0)
  })
})

/** 一份能被 `getData` 读出算子码的假 dataTransfer。 */
function transfer(code: string) {
  return {
    dropEffect: '',
    effectAllowed: '',
    getData: (type: string) => (type === OPERATOR_MIME ? code : ''),
    setData: () => undefined,
  }
}

describe('从算子面板拖进来', () => {
  it('松手落在哪就在哪落一张卡片', async () => {
    const wrapper = open()

    await wrapper.find('.dt-ml-canvas').trigger('drop', {
      clientX: 300,
      clientY: 200,
      dataTransfer: transfer('mid'),
    })

    const dropped = wrapper.emitted('dropOperator')?.[0]
    expect(dropped?.[0]).toBe('mid')
    expect(dropped?.[1]).toEqual({ left: 300 - 112, top: 200 - 34 })
  })

  // ⚠ 认 text/plain 的话，从别处拖进来的任意文本都会被当成一次添加
  it('不是自定义 MIME 就不落件', async () => {
    const wrapper = open()

    await wrapper.find('.dt-ml-canvas').trigger('drop', {
      clientX: 10,
      clientY: 10,
      dataTransfer: { getData: () => '', dropEffect: '' },
    })

    expect(wrapper.emitted('dropOperator')).toBeUndefined()
  })

  it('只读时拖进来也不落件', async () => {
    const wrapper = open({ isReadonly: true })

    await wrapper.find('.dt-ml-canvas').trigger('drop', {
      clientX: 10,
      clientY: 10,
      dataTransfer: transfer('mid'),
    })

    expect(wrapper.emitted('dropOperator')).toBeUndefined()
  })

  it('拖到画布上空时先把卡片将落在哪儿画出来', async () => {
    const wrapper = open()

    await wrapper.find('.dt-ml-canvas').trigger('dragover', {
      clientX: 300,
      clientY: 200,
      dataTransfer: transfer('mid'),
    })

    expect(wrapper.find('.dt-ml-canvas__ghost').exists()).toBe(true)
  })

  it('拖出画布之后那个落点框收掉', async () => {
    const wrapper = open()
    await wrapper.find('.dt-ml-canvas').trigger('dragover', {
      clientX: 1,
      clientY: 1,
      dataTransfer: transfer('mid'),
    })

    await wrapper.find('.dt-ml-canvas').trigger('dragleave')

    expect(wrapper.find('.dt-ml-canvas__ghost').exists()).toBe(false)
  })
})

describe('松手落在卡片上也算连上', () => {
  // ⚠ 只认那个十来像素的圆点的话，十次里落空七次，看着就像连线根本用不了
  it('落在下游卡片的空白处，替用户挑一个契约相符的入口', async () => {
    const wrapper = open()
    const out = wrapper.findAll('.dt-ml-node__port--out')[0]
    const card = wrapper.findAll('.dt-ml-canvas__node')[1]

    await out?.trigger('pointerdown', { clientX: 0, clientY: 0 })
    move(300, 0)
    if (card !== undefined) up(card.element)

    expect(wrapper.emitted('connect')?.[0]?.[1]).toEqual({
      node: 'b',
      port: 'in',
      side: 'in',
    })
  })

  it('从入口反着往回拉也认', async () => {
    const wrapper = open()
    const into = wrapper.find('.dt-ml-node__port--in')
    const out = wrapper.findAll('.dt-ml-node__port--out')[0]

    await into.trigger('pointerdown', { clientX: 300, clientY: 0 })
    move(0, 0)
    if (out !== undefined) up(out.element)

    expect(wrapper.emitted('connect')?.[0]).toEqual([
      { node: 'a', port: 'out', side: 'out' },
      { node: 'b', port: 'in', side: 'in' },
    ])
  })

  it('拉线时接得住的口高亮起来', async () => {
    const wrapper = open()

    await wrapper
      .findAll('.dt-ml-node__port--out')[0]
      ?.trigger('pointerdown', { clientX: 0, clientY: 0 })
    move(150, 0)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.dt-ml-node__port--open').exists()).toBe(true)
  })
})

describe('右键', () => {
  it('在卡片上右键，落点带上是哪个节点', async () => {
    const wrapper = open()

    await wrapper.findAll('.dt-ml-canvas__node')[0]?.trigger('contextmenu', {
      clientX: 40,
      clientY: 50,
    })

    expect(wrapper.emitted('openMenu')?.[0]).toEqual([
      { x: 40, y: 50 },
      { nodeId: 'a', edgeId: null },
    ])
  })

  it('在空白处右键，两个身份都是空', async () => {
    const wrapper = open()

    await wrapper.find('.dt-ml-canvas').trigger('contextmenu')

    expect(wrapper.emitted('openMenu')?.[0]?.[1]).toEqual({
      nodeId: null,
      edgeId: null,
    })
  })
})

describe('吸附', () => {
  it('开着吸附时贴近邻居会吸上去，并画一条参考线', async () => {
    const wrapper = open({ isSnapping: true })
    await wrapper.findAll('.dt-ml-canvas__node')[0]?.trigger('pointerdown', {
      clientX: 0,
      clientY: 0,
    })

    // b 在 left=300；把 a 拖到 297 处，差 3px 在容差内
    move(297, 0)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.dt-ml-canvas__guide').exists()).toBe(true)
  })

  it('关掉吸附时不画参考线，位移原样', async () => {
    const wrapper = open({ isSnapping: false })
    await wrapper.findAll('.dt-ml-canvas__node')[0]?.trigger('pointerdown', {
      clientX: 0,
      clientY: 0,
    })

    move(297, 0)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.dt-ml-canvas__guide').exists()).toBe(false)
  })
})

describe('层序', () => {
  // ⚠ 卡片一叠，下面那张的接点就点不到了——那正是「连不上线」的另一半原因
  it('选中的卡片压在上面', () => {
    const wrapper = open({ selection: { nodes: ['b'], edges: [] } })

    const layers = wrapper
      .findAll('.dt-ml-canvas__node')
      .map((el) => el.attributes('style') ?? '')
    expect(layers[1]).toContain('z-index: 2')
    expect(layers[0]).toContain('z-index: 1')
  })
})

/** 工具条上的一颗按钮。⚠ 按 aria-label 找：写错事件名 typecheck 与 lint 都放行。 */
function tool(wrapper: ReturnType<typeof open>, label: string) {
  return wrapper.find(`[aria-label="${label}"]`)
}

describe('工具条', () => {
  it('放大与缩小真的改画布比例', async () => {
    const wrapper = open()
    const world = () =>
      wrapper.find('.dt-ml-canvas__world').attributes('style') ?? ''
    const before = world()

    await tool(wrapper, '放大').trigger('click')
    const zoomedIn = world()
    await tool(wrapper, '缩小').trigger('click')

    expect(zoomedIn).not.toBe(before)
    expect(world()).not.toBe(zoomedIn)
  })

  it('「回到 100%」把比例拨回 1', async () => {
    const wrapper = open()
    await tool(wrapper, '放大').trigger('click')

    await tool(wrapper, '回到 100%').trigger('click')

    expect(wrapper.find('.dt-ml-canvas__world').attributes('style')).toContain(
      'scale(1)',
    )
  })

  it('一键整理与吸附开关交给页面去做', async () => {
    const wrapper = open()

    await tool(wrapper, '一键整理').trigger('click')
    await tool(wrapper, '吸附对齐').trigger('click')

    expect(wrapper.emitted('autoLayout')).toHaveLength(1)
    expect(wrapper.emitted('toggleSnap')).toHaveLength(1)
  })

  it('空图时「适应视图」与「一键整理」都点不动', () => {
    const wrapper = open({
      graph: { format_version: '1', nodes: [], edges: [] },
    })

    expect(tool(wrapper, '适应视图').attributes('disabled')).toBeDefined()
    expect(tool(wrapper, '一键整理').attributes('disabled')).toBeDefined()
  })

  // ⚠ 滚轮方向反了的话，用户往前推滚轮画布反而缩小，手感立刻就不对
  it('滚轮往前推是放大', async () => {
    const wrapper = open()

    await wrapper.find('.dt-ml-canvas').trigger('wheel', { deltaY: -100 })

    const style = wrapper.find('.dt-ml-canvas__world').attributes('style') ?? ''
    const zoom = Number(/scale\(([\d.]+)\)/.exec(style)?.[1] ?? '1')
    expect(zoom).toBeGreaterThan(1)
  })
})

/** 边层组件的源码；样式契约只能从源码上钉，happy-dom 不做布局。 */
// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const EDGE_LAYER_PATH = join(
  process.cwd(),
  'app/src/pages/Modeling/Canvas/components/EdgeLayer.vue',
)

/** 两张卡片之间连着一条边的图。 */
const WIRED: ModelingGraph = {
  ...GRAPH,
  edges: [
    {
      id: 'a:out->b:in',
      from_node: 'a',
      from_port: 'out',
      to_node: 'b',
      to_port: 'in',
    },
  ],
}

// ⚠ `.dt-ml-canvas__world` 是个只装 absolute 子元素的变换容器，自己是 0×0；边层
// SVG 若按父容器的百分比取尺寸就也是 0×0，而外层 <svg> 宽或高为 0 时浏览器**整个
// 不绘制**它，`overflow: visible` 救不回来。表象是「连线看不见」而全部单测照常绿。
describe('边层 SVG 的尺寸', () => {
  it('挂在画布上时带着非零的显式宽高，而不是父容器的百分比', () => {
    const wrapper = open({ graph: WIRED })
    const svg = wrapper.find('.dt-ml-edges')

    expect(Number(svg.attributes('width'))).toBeGreaterThan(0)
    expect(Number(svg.attributes('height'))).toBeGreaterThan(0)
  })

  it('样式里不给这一层写百分比宽高，且视口外的线靠 overflow 放出来', () => {
    const source = readFileSync(EDGE_LAYER_PATH, 'utf8')
    const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? ''

    expect(style).not.toMatch(/(width|height)\s*:\s*100%/)
    expect(style).toMatch(/overflow\s*:\s*visible/)
  })
})
