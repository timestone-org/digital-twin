/**
 * @fileoverview 契约：连线检查器只算配置不碰文档——一步一步的改动走 `change`，
 * 文本与滑块走 `merge`（同一格同键，并成一帧撤销），失焦断段走 `endMerge`；
 * 走线四档一档不少，反转是「端点互换 + 拐点反序 + 标签跟着走」。
 *
 * ⚠ 每敲一个字母塞一帧进撤销栈，撤销键就等于废了——所以文本框必须交出 `merge`
 * 而不是 `change`，这一条由下面的合并键用例逐格钉住。
 */
import {
  TWIN_2D_EDGE_ROUTES,
  normalizeTwin2dConfig,
  edgeRowFieldKey,
} from '@dt/twin2d'
import type { Twin2dConfig, Twin2dEdge } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EdgeInspector from '@/pages/Twin2dEditor/components/inspector/EdgeInspector.vue'

/** 三个节点两条线；`water` 在文档里改过名，用来验证同 id 以文档为准。 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  version: 1,
  canvas: { width: 800, height: 600, grid: 20 },
  edgeStyles: [{ id: 'water', name: '改过名的水流' }],
  nodes: [
    { id: 'n1', styleId: 'circuit-resistor', x: 0, y: 0, label: '电阻' },
    { id: 'n2', styleId: 'circuit-ground', x: 200, y: 0 },
    { id: 'n3', styleId: 'circuit-capacitor', x: 400, y: 0, label: '电容' },
    { id: 'n4', styleId: 'no-such-style', x: 600, y: 0, label: '悬空样式' },
  ],
  edges: [
    {
      id: 'e0',
      styleId: 'steam',
      from: { nodeId: 'n1' },
      to: { nodeId: 'n3' },
    },
    {
      id: 'e1',
      styleId: 'water',
      from: { nodeId: 'n1', portId: '2' },
      to: { nodeId: 'n2', portId: '1' },
      route: 'bezier',
      waypoints: [
        { x: 100, y: 40 },
        { x: 140, y: 80 },
      ],
      label: '母线',
      labelAt: 0.25,
    },
  ],
})

/**
 * 按 id 取一条连线。
 * @param id 连线 id
 * @param config 从哪份配置里取
 */
function edgeOf(id: string, config: Twin2dConfig = CONFIG): Twin2dEdge {
  const edge = config.edges.find((item) => item.id === id)
  if (edge === undefined) throw new Error(`没有 ${id} 这条线`)
  return edge
}

const E1 = edgeOf('e1')

function mountInspector(edge: Twin2dEdge, config: Twin2dConfig = CONFIG) {
  return mount(EdgeInspector, { props: { edge, config } })
}

type Wrapper = ReturnType<typeof mountInspector>

/** 一步一帧那一路交出来的整份配置。 */
function lastChange(wrapper: Wrapper): Twin2dConfig {
  const events = wrapper.emitted('change')
  if (!events?.length) throw new Error('没有一步一帧的写入')
  return events[events.length - 1]?.[0] as Twin2dConfig
}

/** 并成一帧那一路交出来的配置与合并键。 */
function lastMerge(wrapper: Wrapper): [Twin2dConfig, string] {
  const events = wrapper.emitted('merge')
  if (!events?.length) throw new Error('没有并成一帧的写入')
  const last = events[events.length - 1]
  return [last?.[0] as Twin2dConfig, last?.[1] as string]
}

/** 改完之后的那条线。 */
function changedEdge(wrapper: Wrapper, id = 'e1'): Twin2dEdge {
  return edgeOf(id, lastChange(wrapper))
}

/**
 * 按 `data-test` 取那一个下拉——同一面板上「节点」「端口」各有两个，按序号取会
 * 跟着版式一起漂。
 * @param wrapper 挂好的检查器
 * @param test 那一格的 data-test
 */
function selectBy(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

/**
 * 一个下拉摆出来的取值。
 * @param wrapper 挂好的检查器
 * @param test 那一格的 data-test
 */
function valuesOf(wrapper: Wrapper, test: string): readonly string[] {
  const options: readonly { value: string }[] = selectBy(wrapper, test).props(
    'options',
  )
  return options.map((option) => option.value)
}

describe('外观', () => {
  it('样式下拉是文档里的并上预置库，同 id 以文档那一份为准', () => {
    const wrapper = mountInspector(E1)
    const options: readonly { value: string; label: string }[] = selectBy(
      wrapper,
      'edge-style',
    ).props('options')

    expect(options.filter((item) => item.value === 'water')).toHaveLength(1)
    expect(options[0]).toEqual({ value: 'water', label: '改过名的水流' })
  })

  // ⚠ 抹掉它等于「点开下拉就把配置改了」，而用户没打算改任何东西
  it('样式指到不存在的 id 时原样列出来，不被抹掉', () => {
    const wrapper = mountInspector({ ...E1, styleId: 'gone' })

    expect(valuesOf(wrapper, 'edge-style')).toContain('gone')
  })

  it('换样式落成一步一帧', () => {
    const wrapper = mountInspector(E1)

    selectBy(wrapper, 'edge-style').vm.$emit('update:modelValue', 'steam')

    expect(changedEdge(wrapper).styleId).toBe('steam')
  })

  it('走线四档加上跟随样式一档不少', () => {
    expect(valuesOf(mountInspector(E1), 'edge-route')).toEqual([
      ...TWIN_2D_EDGE_ROUTES,
    ])
  })

  it('换走线档落成一步一帧', () => {
    const wrapper = mountInspector(E1)

    selectBy(wrapper, 'edge-route').vm.$emit('update:modelValue', 'straight')

    expect(changedEdge(wrapper).route).toBe('straight')
  })

  // ⚠ 断言按下去的是编译期，写进文档的仍是那个认不出的档
  it('认不出的走线档不写回', () => {
    const wrapper = mountInspector(E1)

    selectBy(wrapper, 'edge-route').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('有拐点时写明走线档不生效', () => {
    const withPoints = selectBy(mountInspector(E1), 'edge-route')
    const clean = selectBy(mountInspector(edgeOf('e0')), 'edge-route')

    expect(withPoints.props('hint')).toContain('不生效')
    expect(clean.props('hint')).not.toContain('不生效')
  })

  it('主色逐键写入并成一帧，键钉在这条线的这一格上', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.find('.dt-t2-color input[type="text"]').setValue('tomato')

    const [config, key] = lastMerge(wrapper)
    expect(edgeOf('e1', config).accent).toBe('tomato')
    expect(key).toBe('edge:e1:accent')
  })
})

describe('两端', () => {
  it('端口下拉带一档自动，其余是这个节点上的引脚', () => {
    const wrapper = mountInspector(E1)

    expect(valuesOf(wrapper, 'edge-port-from')).toEqual(['', '1', '2'])
    expect(valuesOf(wrapper, 'edge-port-to')).toEqual(['', '1'])
  })

  it('节点寻不到时端口只剩自动那一档', () => {
    const edge: Twin2dEdge = {
      ...E1,
      from: { nodeId: 'gone', portId: '', t: null },
    }

    expect(valuesOf(mountInspector(edge), 'edge-port-from')).toEqual([''])
  })

  it('样式悬空的节点上一个引脚都摆不出来', () => {
    const edge: Twin2dEdge = {
      ...E1,
      from: { nodeId: 'n4', portId: '', t: null },
    }

    expect(valuesOf(mountInspector(edge), 'edge-port-from')).toEqual([''])
  })

  // ⚠ 端口是旧节点内部的地址，跟着换过去只会指到一个不存在的引脚
  it('换节点时把端口与周长参数一起清掉', () => {
    const wrapper = mountInspector({
      ...E1,
      from: { nodeId: 'n1', portId: '2', t: 0.3 },
    })

    selectBy(wrapper, 'edge-node-from').vm.$emit('update:modelValue', 'n3')

    expect(changedEdge(wrapper).from).toEqual({
      nodeId: 'n3',
      portId: '',
      t: null,
    })
  })

  it('换端口只动这一端，另一端原样不动', () => {
    const wrapper = mountInspector(E1)

    selectBy(wrapper, 'edge-port-from').vm.$emit('update:modelValue', '1')

    const edge = changedEdge(wrapper)
    expect(edge.from.portId).toBe('1')
    expect(edge.to).toEqual(E1.to)
  })

  it('端口指到不存在的引脚时原样列出来', () => {
    const edge: Twin2dEdge = {
      ...E1,
      from: { nodeId: 'n1', portId: 'gone', t: null },
    }

    expect(valuesOf(mountInspector(edge), 'edge-port-from')).toContain('gone')
  })

  it('钉上周长参数给一个看得见的落点，取消就回到不钉', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.get('[data-test="edge-pin-from"]').trigger('click')
    expect(changedEdge(wrapper).from.t).toBe(0.5)

    const pinned = mountInspector({
      ...E1,
      from: { nodeId: 'n1', portId: '2', t: 0.5 },
    })
    await pinned.get('[data-test="edge-pin-from"]').trigger('click')
    expect(changedEdge(pinned).from.t).toBeNull()
  })

  it('没钉周长参数时不摆那个滑块', () => {
    const wrapper = mountInspector(E1)

    expect(wrapper.find('[data-test="edge-t-from"]').exists()).toBe(false)
  })

  it('拖周长参数并成一帧，两端各是一个键', async () => {
    const wrapper = mountInspector({
      ...E1,
      from: { nodeId: 'n1', portId: '2', t: 0.5 },
      to: { nodeId: 'n2', portId: '1', t: 0.5 },
    })

    await wrapper.get('[data-test="edge-t-from"]').setValue('0.35')
    expect(lastMerge(wrapper)[1]).toBe('edge:e1:t:from')

    await wrapper.get('[data-test="edge-t-to"]').setValue('0.8')
    const [config, key] = lastMerge(wrapper)
    expect(key).toBe('edge:e1:t:to')
    expect(edgeOf('e1', config).to.t).toBe(0.8)
  })
})

describe('反转方向', () => {
  it('两端互换、拐点整体反序、标签跟着换到另一头', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.get('[data-test="edge-reverse"]').trigger('click')

    const edge = changedEdge(wrapper)
    expect(edge.from).toEqual(E1.to)
    expect(edge.to).toEqual(E1.from)
    // ⚠ 只换端点不反序拐点，带拐点的路径会自己交叉
    expect(edge.waypoints).toEqual([
      { x: 140, y: 80 },
      { x: 100, y: 40 },
    ])
    expect(edge.labelAt).toBeCloseTo(0.75)
  })
})

describe('拐点', () => {
  it('一个拐点都没有时说明这条线按走线档走', () => {
    const wrapper = mountInspector(edgeOf('e0'))

    expect(wrapper.find('[data-test="edge-waypoints-empty"]').exists()).toBe(
      true,
    )
    expect(wrapper.find('[data-test="edge-wp-x-0"]').exists()).toBe(false)
  })

  // ⚠ 落在 0,0 会把线甩到画布左上角，看着像这个键坏了
  it('第一个拐点落在画布中心', async () => {
    const wrapper = mountInspector(edgeOf('e0'))

    await wrapper.get('[data-test="edge-wp-add"]').trigger('click')

    expect(changedEdge(wrapper, 'e0').waypoints).toEqual([{ x: 400, y: 300 }])
  })

  it('再加一个落在末一个外一格，并且吸在网格上', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.get('[data-test="edge-wp-add"]').trigger('click')

    expect(changedEdge(wrapper).waypoints).toEqual([
      { x: 100, y: 40 },
      { x: 140, y: 80 },
      { x: 160, y: 100 },
    ])
  })

  it('删中间一个，其余保持原序', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.get('[data-test="edge-wp-remove-0"]').trigger('click')

    expect(changedEdge(wrapper).waypoints).toEqual([{ x: 140, y: 80 }])
  })

  it('改一格坐标并成一帧，每一格各是一个键', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.get('[data-test="edge-wp-x-1"]').setValue('220')
    expect(lastMerge(wrapper)[1]).toBe('edge:e1:wp:1:x')

    await wrapper.get('[data-test="edge-wp-y-0"]').setValue('60')
    const [config, key] = lastMerge(wrapper)
    expect(key).toBe('edge:e1:wp:0:y')
    expect(edgeOf('e1', config).waypoints).toEqual([
      { x: 100, y: 60 },
      { x: 140, y: 80 },
    ])
  })

  it('坐标清空当 0，不留一个解析不出的空位', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.get('[data-test="edge-wp-x-0"]').setValue('')

    expect(lastMerge(wrapper)[0].edges[1]?.waypoints[0]).toEqual({
      x: 0,
      y: 40,
    })
  })
})

describe('标签', () => {
  it('字面量逐键写入并成一帧', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.get('[data-test="edge-label"]').setValue('L1')

    const [config, key] = lastMerge(wrapper)
    expect(edgeOf('e1', config).label).toBe('L1')
    expect(key).toBe('edge:e1:label')
  })

  it('沿线位置拖动并成一帧', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.get('[data-test="edge-label-at"]').setValue('0.8')

    const [config, key] = lastMerge(wrapper)
    expect(edgeOf('e1', config).labelAt).toBe(0.8)
    expect(key).toBe('edge:e1:labelAt')
  })

  // ⚠ 行号是文档序，不是别的什么序：指错了行，接上的点位就喂给了另一条线
  it('数据行提示按文档序给出三个子槽的 fieldKey', () => {
    const text = mountInspector(E1)
      .get('[data-test="edge-binding-hint"]')
      .text()

    expect(text).toContain(edgeRowFieldKey(1, 'active'))
    expect(text).toContain(edgeRowFieldKey(1, 'direction'))
    expect(text).toContain(edgeRowFieldKey(1, 'value'))
  })

  it('这条线不在配置里时不摆数据行提示', () => {
    const wrapper = mountInspector({ ...E1, id: 'ghost' })

    expect(wrapper.find('[data-test="edge-binding-hint"]').exists()).toBe(false)
  })
})

describe('撤销分段', () => {
  // ⚠ 不断段的话，下一格的第一次输入会被并进上一格那一帧里
  it('任何一格失焦都断掉这一段连续输入', async () => {
    const wrapper = mountInspector(E1)

    await wrapper.get('[data-test="edge-label"]').trigger('focusout')

    expect(wrapper.emitted('endMerge')).toHaveLength(1)
  })
})
