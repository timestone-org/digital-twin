/**
 * @fileoverview 契约：层级页签上建根 / 建子 / 挪位 / 拖拽改父子各自抛对事件，
 * 空态给得出下一步动作，而拖进自己的子树一次都抛不出去。
 * ⚠ 空态只写「还没有钻取节点」等于把人留在原地；必须同时给按钮与一句用途说明。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TwinHierarchyPanel from '@/pages/TwinEditor/components/TwinHierarchyPanel.vue'

function configOf(nodes: unknown[]): TwinConfig {
  return normalizeTwinConfig({ hierNodes: nodes })
}

const TREE = [
  { id: 'plant', name: '厂区' },
  { id: 'shopA', parentId: 'plant', name: 'A 车间', order: 0 },
  { id: 'shopB', parentId: 'plant', name: 'B 车间', order: 1 },
]

function render(
  nodes: unknown[] = TREE,
  flagged: ReadonlySet<string> = new Set(),
) {
  return mount(TwinHierarchyPanel, {
    props: { config: configOf(nodes), selection: null, flaggedIds: flagged },
  })
}

type Wrapper = ReturnType<typeof render>

function rowOf(wrapper: Wrapper, id: string) {
  const found = wrapper.find(`[data-test="hier-row"][data-id="${id}"]`)
  if (!found.exists()) throw new Error(`树上没有 ${id} 这一行`)
  return found
}

describe('空态', () => {
  it('一个节点都没有时给「新建根节点」按钮', async () => {
    const wrapper = render([])

    await wrapper.get('[data-test="hier-empty-add"]').trigger('click')

    expect(wrapper.emitted('add')?.[0]).toEqual([null])
  })

  it('空态同时说清这个功能是干什么的', () => {
    expect(render([]).get('[data-test="hier-empty"]').text()).toContain(
      '一层层点进',
    )
  })

  it('有节点之后空态就不显示了', () => {
    expect(render().find('[data-test="hier-empty"]').exists()).toBe(false)
  })
})

describe('增删与挪位', () => {
  it('头上的「+」建的是根', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="hier-add-root"]').trigger('click')

    expect(wrapper.emitted('add')?.[0]).toEqual([null])
  })

  it('行上的「+」建的是这一行的子层', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'plant')
      .get('[data-test="hier-add-child"]')
      .trigger('click')

    expect(wrapper.emitted('add')?.[0]).toEqual(['plant'])
  })

  it('上移下移带的是同级方向', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'shopB').get('[data-test="hier-up"]').trigger('click')

    expect(wrapper.emitted('move')?.[0]).toEqual([{ id: 'shopB', delta: -1 }])
  })

  it('删除要二次确认，确认前不抛事件', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'shopA')
      .get('[data-test="hier-remove"]')
      .trigger('click')
    expect(wrapper.emitted('remove')).toBeUndefined()

    await wrapper.get('[data-test="hier-remove-yes"]').trigger('click')
    expect(wrapper.emitted('remove')?.[0]).toEqual(['shopA'])
  })

  it('有子层时确认框里写明下级会各自变成一个根', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'plant')
      .get('[data-test="hier-remove"]')
      .trigger('click')

    expect(wrapper.get('[data-test="hier-remove-confirm"]').text()).toContain(
      '下级会各自变成一个根',
    )
  })

  it('点一行抛选中', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'shopA')
      .get('[data-test="hier-select"]')
      .trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([
      { kind: 'hierNodes', id: 'shopA' },
    ])
  })

  it('折叠一支之后它的子层不再列出来', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'plant')
      .get('[data-test="hier-toggle"]')
      .trigger('click')

    expect(wrapper.findAll('[data-test="hier-row"]')).toHaveLength(1)
  })
})

describe('拖拽改父子', () => {
  it('拖到别的支上抛出改父子', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'shopA').trigger('dragstart')
    await rowOf(wrapper, 'shopB').trigger('drop')

    expect(wrapper.emitted('reparent')?.[0]).toEqual([
      { id: 'shopA', parentId: 'shopB' },
    ])
  })

  it('拖进自己的子树里一次都抛不出去', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'plant').trigger('dragstart')
    await rowOf(wrapper, 'shopA').trigger('drop')

    expect(wrapper.emitted('reparent')).toBeUndefined()
  })

  it('拖到顶层落区抛出提到顶层', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'shopA').trigger('dragstart')
    await wrapper.get('[data-test="hier-drop-root"]').trigger('drop')

    expect(wrapper.emitted('reparent')?.[0]).toEqual([
      { id: 'shopA', parentId: null },
    ])
  })

  it('松手之后拖拽态清干净，下一次落点不借用上一次的起点', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'shopA').trigger('dragstart')
    await rowOf(wrapper, 'shopB').trigger('drop')
    await rowOf(wrapper, 'plant').trigger('drop')

    expect(wrapper.emitted('reparent')).toHaveLength(1)
  })

  it('拖起来经过一个合法落点时那一行高亮', async () => {
    const wrapper = render()

    await rowOf(wrapper, 'shopA').trigger('dragstart')
    await rowOf(wrapper, 'shopB').trigger('dragover')

    expect(rowOf(wrapper, 'shopB').classes()).toContain('ring-accent-primary')
  })
})

describe('诊断红点', () => {
  it('有问题的那一行打红点', () => {
    const wrapper = render(TREE, new Set(['shopB']))

    expect(wrapper.findAll('[data-test="hier-flag"]')).toHaveLength(1)
  })
})
