/**
 * @fileoverview 守节点树的渲染：节点按设计像素恒等定位、**不可见节点根本不挂载**、
 * 容器的子层渲染进容器组件的默认插槽且坐标系正好是内容区（内缩绝不加第二次）、
 * 非容器节点不接子节点，以及递归到深度上限就停。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NodeTree from '../src/NodeTree.vue'
import type { DesignSize } from '../src/dashboardGeometry'
import { buildNodeTree, type RuntimeNode } from '../src/nodeTree'
import {
  asAsyncModule,
  fakeCatalog,
  fakeManifest,
  fakeModuleComponent,
  fakeNode,
} from '../src/testing/fixtures'

/** 会渲染默认插槽的模块壳：子节点进不进得来，看它插槽里有没有东西。 */
const shell = fakeManifest({
  type: 'shell',
  isContainer: true,
  component: () =>
    asAsyncModule(fakeModuleComponent({ mark: 'shell', hasSlot: true })),
})

/** 组件会渲染插槽，但清单没声明自己是容器——运行时因此不该给它子节点。 */
const slotLeaf = fakeManifest({
  type: 'slot-leaf',
  component: () =>
    asAsyncModule(fakeModuleComponent({ mark: 'shell', hasSlot: true })),
})

const leaf = fakeManifest({ type: 'leaf' })

const catalog = fakeCatalog([shell, slotLeaf, leaf])

const STAGE: DesignSize = { width: 1920, height: 1080 }

function toRoots(
  nodes: readonly DashboardNodePayload[],
): readonly RuntimeNode[] {
  return buildNodeTree(nodes, catalog).roots
}

function mountTree(nodes: readonly RuntimeNode[], design: DesignSize = STAGE) {
  return mount(NodeTree, { props: { nodes, design, getManifest: catalog } })
}

describe('一层的定位', () => {
  it('本层坐标系尺寸就是这一层的画布大小', () => {
    const wrapper = mountTree(
      toRoots([fakeNode({ id: 'a', moduleType: 'leaf' })]),
    )

    expect(wrapper.get('.dt-node-layer').attributes('style')).toContain(
      'width: 1920px',
    )
  })

  it('节点按设计像素恒等定位，亚像素照原样落进 style', () => {
    const wrapper = mountTree(
      toRoots([
        fakeNode({
          id: 'a',
          moduleType: 'leaf',
          x: 10.5,
          y: 20,
          w: 100,
          h: 50,
          zIndex: 3,
        }),
      ]),
    )
    const style = wrapper.get('.dt-node').attributes('style') ?? ''

    expect(style).toContain('left: 10.5px')
    expect(style).toContain('top: 20px')
    expect(style).toContain('width: 100px')
    expect(style).toContain('z-index: 3')
  })

  it('不可见的节点根本不挂载，它的模块一次都没跑起来', async () => {
    const wrapper = mountTree(
      toRoots([
        fakeNode({ id: 'a', moduleType: 'leaf' }),
        fakeNode({ id: 'b', moduleType: 'leaf', isVisible: false }),
      ]),
    )
    await flushPromises()

    expect(wrapper.findAll('.dt-node')).toHaveLength(1)
    expect(wrapper.findAll('.fake-module')).toHaveLength(1)
  })
})

describe('容器的子层', () => {
  const container = fakeNode({
    id: 'root',
    moduleType: 'shell',
    w: 400,
    h: 300,
    configJson: { showTitle: true, __container: { pad: 10 } },
  })

  it('子层渲染进容器组件的默认插槽，坐标系正好是内容区', async () => {
    const wrapper = mountTree(
      toRoots([
        container,
        fakeNode({
          id: 'kid',
          moduleType: 'leaf',
          parentId: 'root',
          x: 0,
          y: 0,
          w: 380,
          h: 252,
        }),
      ]),
    )
    await flushPromises()
    const childLayer = wrapper.get('.shell .dt-node-layer')

    expect(childLayer.attributes('style')).toContain('width: 380px')
    expect(childLayer.attributes('style')).toContain('height: 252px')
  })

  it('子节点坐标相对内容区原点，内缩不许再加一次', async () => {
    const wrapper = mountTree(
      toRoots([
        container,
        fakeNode({
          id: 'kid',
          moduleType: 'leaf',
          parentId: 'root',
          x: 0,
          y: 0,
          w: 380,
          h: 252,
        }),
      ]),
    )
    await flushPromises()
    const style = wrapper.get('.shell .dt-node').attributes('style') ?? ''

    expect(style).toContain('left: 0px')
    expect(style).toContain('top: 0px')
    expect(style).toContain('width: 380px')
  })

  it('清单没声明是容器的模块拿不到子节点，哪怕它的组件画了插槽', async () => {
    const wrapper = mountTree(
      toRoots([
        fakeNode({ id: 'root', moduleType: 'slot-leaf', w: 400, h: 300 }),
        fakeNode({ id: 'kid', moduleType: 'leaf', parentId: 'root' }),
      ]),
    )
    await flushPromises()

    expect(wrapper.find('.shell .dt-node-layer').exists()).toBe(false)
  })

  it('递归到深度上限就停，异常深的树不会一路挂到底', async () => {
    const chain = Array.from({ length: 30 }, (_, index) =>
      fakeNode({
        id: `n${index}`,
        moduleType: 'shell',
        parentId: index === 0 ? null : `n${index - 1}`,
        w: 400,
        h: 300,
      }),
    )
    const wrapper = mountTree(toRoots(chain))
    for (let round = 0; round < 40; round += 1) await flushPromises()

    expect(wrapper.findAll('.dt-node')).toHaveLength(25)
  })
})
