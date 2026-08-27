/**
 * @fileoverview 契约：右栏检查器的分派——四类选中各落到自己那个检查器，没选中、
 * 选中样式、以及选中的那条实体已经不在了，一律落回画布检查器。
 *
 * ⚠ 悬空 id 那一条是要害：撤销、重做与删除之后选中里会留下已经不存在的 id，页面那道
 * `prune` 要等下一拍才摘。这中间画一个空壳的话，用户在上面改哪一项都写不回去，
 * 而且一处报错都没有。
 * ⚠ 样式那两类停在**另一条轴**上（`styleFocus`），与画布选中并行，不走这一栏。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Twin2dInspector from '@/pages/Twin2dEditor/components/Twin2dInspector.vue'
import CanvasInspector from '@/pages/Twin2dEditor/components/inspector/CanvasInspector.vue'
import EdgeInspector from '@/pages/Twin2dEditor/components/inspector/EdgeInspector.vue'
import MarkInspector from '@/pages/Twin2dEditor/components/inspector/MarkInspector.vue'
import NodeInspector from '@/pages/Twin2dEditor/components/inspector/NodeInspector.vue'
import { TWIN_2D_SELECT_CANVAS } from '@/pages/Twin2dEditor/scripts/types'
import type { Twin2dSelection } from '@/pages/Twin2dEditor/scripts/types'

/** 一份四类实体各有一条的配置。 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 20 },
  nodes: [
    { id: 'n1', styleId: 'circuit-resistor', label: '电阻' },
    { id: 'n2', styleId: 'circuit-resistor', label: '电容' },
  ],
  edges: [{ id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } }],
  marks: [{ id: 'm1', kind: 'rect', x: 10, y: 10, w: 80, h: 40 }],
})

function mountInspector(selection: Twin2dSelection) {
  return mount(Twin2dInspector, { props: { config: CONFIG, selection } })
}

type Wrapper = ReturnType<typeof mountInspector>

/** 这一栏当前画的是哪一段。 */
function kindOf(wrapper: Wrapper): string {
  return (
    wrapper.find('[data-test="twin2d-inspector"]').attributes('data-kind') ?? ''
  )
}

describe('按选中分派', () => {
  it('没选中时是画布检查器', () => {
    const wrapper = mountInspector(TWIN_2D_SELECT_CANVAS)

    expect(wrapper.findComponent(CanvasInspector).exists()).toBe(true)
    expect(kindOf(wrapper)).toBe('canvas')
  })

  it('选中节点时画的是那一条节点', () => {
    const wrapper = mountInspector({ kind: 'nodes', id: 'n2' })

    const inspector = wrapper.findComponent(NodeInspector)
    expect(inspector.exists()).toBe(true)
    expect(inspector.text()).toContain('n2')
    expect(wrapper.findComponent(CanvasInspector).exists()).toBe(false)
  })

  it('选中连线时是连线检查器', () => {
    const wrapper = mountInspector({ kind: 'edges', id: 'e1' })

    expect(wrapper.findComponent(EdgeInspector).exists()).toBe(true)
    expect(kindOf(wrapper)).toBe('edge')
  })

  it('选中标注时是标注检查器', () => {
    const wrapper = mountInspector({ kind: 'marks', id: 'm1' })

    expect(wrapper.findComponent(MarkInspector).exists()).toBe(true)
    expect(kindOf(wrapper)).toBe('mark')
  })

  // ⚠ 空壳上改哪一项都写不回去，且一处报错都没有
  it('选中的那条已经不在了就落回画布，不画空壳', () => {
    const wrapper = mountInspector({ kind: 'nodes', id: 'gone' })

    expect(wrapper.findComponent(NodeInspector).exists()).toBe(false)
    expect(wrapper.findComponent(CanvasInspector).exists()).toBe(true)
  })

  it.each(['styles', 'edgeStyles'] as const)('%s 不走这一栏', (kind) => {
    const wrapper = mountInspector({ kind, id: 'circuit-resistor' })

    expect(wrapper.findComponent(CanvasInspector).exists()).toBe(true)
  })
})

describe('三个事件原样上抛', () => {
  it('一次性改动走 change', () => {
    const wrapper = mountInspector({ kind: 'marks', id: 'm1' })

    wrapper.findComponent(MarkInspector).vm.$emit('change', CONFIG)

    expect(wrapper.emitted('change')?.[0]).toEqual([CONFIG])
  })

  it('连续输入连着合并键一起上抛', () => {
    const wrapper = mountInspector({ kind: 'nodes', id: 'n1' })

    wrapper
      .findComponent(NodeInspector)
      .vm.$emit('merge', CONFIG, 'node:n1:label')

    expect(wrapper.emitted('merge')?.[0]).toEqual([CONFIG, 'node:n1:label'])
  })

  it('断段走 endMerge', () => {
    const wrapper = mountInspector({ kind: 'edges', id: 'e1' })

    wrapper.findComponent(EdgeInspector).vm.$emit('endMerge')

    expect(wrapper.emitted('endMerge')).toHaveLength(1)
  })
})
