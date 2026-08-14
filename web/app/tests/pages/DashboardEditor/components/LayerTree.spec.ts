/**
 * @fileoverview 契约：图层树按父子关系递归，选中 / 显隐 / 删除各抛各的事件。
 * ⚠ 行的 key 用节点 id：用索引的话，删掉中间一层会让其余行的选中态整体错位。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import LayerTree from '@/pages/DashboardEditor/components/LayerTree.vue'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示模块',
  category: '演示',
  icon: 'building',
  defaultSize: { width: 10, height: 10 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function node(id: string, over: Partial<DashboardNodePayload> = {}): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
    ...over,
  }
}

function mountTree(nodes: DashboardNodePayload[], selectedId: string | null = null) {
  return mount(LayerTree, {
    props: {
      nodes,
      parentId: null,
      selectedId,
      getManifest: () => MANIFEST,
    },
  })
}

describe('渲染', () => {
  it('顶层与子层都列出来，显示名取自清单', () => {
    const wrapper = mountTree([node('a'), node('kid', { parentId: 'a' })])

    expect(wrapper.findAll('.dt-layer__row')).toHaveLength(2)
    expect(wrapper.text()).toContain('演示模块')
  })

  it('认不出清单时退回模块类型，不留白', () => {
    const wrapper = mount(LayerTree, {
      props: {
        nodes: [node('a', { moduleType: 'unknown-type' })],
        parentId: null,
        selectedId: null,
        getManifest: () => undefined,
      },
    })

    expect(wrapper.text()).toContain('unknown-type')
  })

  it('同层按 (zIndex, id) 定序', () => {
    const wrapper = mountTree([
      node('b', { zIndex: 1 }),
      node('a', { zIndex: 0 }),
    ])
    const rows = wrapper.findAll('.dt-layer__row')

    expect(rows[0]?.attributes('style')).toBe(rows[1]?.attributes('style'))
    expect(rows).toHaveLength(2)
  })

  it('选中的那一行挂上选中样式', () => {
    const wrapper = mountTree([node('a')], 'a')

    expect(wrapper.find('.dt-layer__row').classes()).toContain(
      'dt-layer__row--on',
    )
  })
})

describe('动作', () => {
  it('点一行抛 select', async () => {
    const wrapper = mountTree([node('a')])

    await wrapper.find('.dt-layer__row').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['a'])
  })

  it('切显隐抛 toggle，带下一个状态', async () => {
    const wrapper = mountTree([node('a')])
    const eye = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '隐藏这个节点')

    await eye?.trigger('click')

    expect(wrapper.emitted('toggle')?.[0]).toEqual(['a', false])
  })

  it('已隐藏的节点给的是「显示」这一档', async () => {
    const wrapper = mountTree([node('a', { isVisible: false })])
    const eye = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '显示这个节点')

    await eye?.trigger('click')

    expect(wrapper.emitted('toggle')?.[0]).toEqual(['a', true])
  })

  it('删除抛 remove，且不顺带选中它', async () => {
    const wrapper = mountTree([node('a')])
    const trash = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '删除这个节点')

    await trash?.trigger('click')

    expect(wrapper.emitted('remove')?.[0]).toEqual(['a'])
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('子层的事件一路冒到顶层', async () => {
    const wrapper = mountTree([node('a'), node('kid', { parentId: 'a' })])
    const rows = wrapper.findAll('.dt-layer__row')

    await rows[1]?.trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['kid'])
  })
})
