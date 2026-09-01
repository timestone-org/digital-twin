/**
 * @fileoverview 画布组件：拖节点只在松手时提交一次、按住接点是拉线不是拖卡片、
 * 连线不合法当场给人话、框选算命中、只读时手势全不生效。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import EditorCanvas from '@/pages/Modeling/Canvas/components/EditorCanvas.vue'
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

function open(over: { isReadonly?: boolean; graph?: ModelingGraph } = {}) {
  return mount(EditorCanvas, {
    attachTo: document.body,
    props: {
      graph: over.graph ?? GRAPH,
      operators: OPERATORS,
      runtime: new Map<string, NodeRuntime>(),
      selection: { format_version: '1', nodes: [], edges: [] },
      isReadonly: over.isReadonly ?? false,
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
      { node: 'a', port: 'out' },
      { node: 'b', port: 'in' },
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

    await wrapper.find('.dt-ml-edges__line').trigger('pointerdown')

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
