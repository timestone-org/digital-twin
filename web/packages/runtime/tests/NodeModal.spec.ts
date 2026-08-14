/**
 * @fileoverview 节点弹窗契约：子树重根渲染、初始不可见的根被掀开、
 * Esc 与关闭键收口、遮罩不点击关闭、尺寸钳进舞台。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, type FunctionalComponent } from 'vue'
import type { DashboardNodeView, ModuleManifest } from '@dt/contracts'

import NodeModal from '../src/NodeModal.vue'
import { buildModalSubtree } from '../src/nodeTree'

// 桩件用函数式组件：只要渲染出可断言的标记，不需要自己的状态
const BoxStub: FunctionalComponent = (_props, { slots }) =>
  h('div', { class: 'stub-box' }, slots.default?.())

const TextStub: FunctionalComponent = () => h('p', '弹窗内容')

const BOX: ModuleManifest = {
  type: 'box',
  displayName: '容器',
  category: '布局',
  defaultSize: { width: 400, height: 300 },
  configSchema: [],
  bindings: [],
  isContainer: true,
  component: () => Promise.resolve({ default: BoxStub }),
}
const TEXT: ModuleManifest = {
  type: 'text',
  displayName: '文本',
  category: '装饰',
  defaultSize: { width: 100, height: 40 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: TextStub }),
}

const getManifest = (type: string): ModuleManifest | undefined =>
  type === 'box' ? BOX : type === 'text' ? TEXT : undefined

function node(
  id: string,
  parentId: string | null,
  over: Partial<DashboardNodeView> = {},
): DashboardNodeView {
  return {
    id,
    parentId,
    clientKey: null,
    moduleType: 'text',
    x: 100,
    y: 120,
    w: 300,
    h: 200,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    bindings: [],
    ...over,
  }
}

const NODES: DashboardNodeView[] = [
  node('root', null, { moduleType: 'box', isVisible: false }),
  node('child', 'root'),
  node('outside', null, { zIndex: 1 }),
]

describe('子树重根', () => {
  it('根搬到 (0,0)、强制可见，屏上其余节点不进子树', () => {
    const roots = buildModalSubtree(NODES, 'root', getManifest)

    expect(roots).toHaveLength(1)
    const root = roots[0]
    expect(root?.box).toEqual({ x: 0, y: 0, w: 300, h: 200 })
    expect(root?.isVisible).toBe(true)
    expect(root?.children.map((child) => child.id)).toEqual(['child'])
  })

  it('找不到根时给空数组', () => {
    expect(buildModalSubtree(NODES, 'ghost', getManifest)).toEqual([])
  })
})

describe('弹窗行为', () => {
  function mountModal(title?: string) {
    return mount(NodeModal, {
      props: {
        nodes: NODES,
        rootId: 'root',
        design: { width: 1920, height: 1080 },
        getManifest,
        ...(title === undefined ? {} : { title }),
      },
      attachTo: document.body,
    })
  }

  it('带标题时渲染标题栏并挂上 aria-labelledby', () => {
    const wrapper = mountModal('设备详情')

    expect(wrapper.text()).toContain('设备详情')
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-labelledby')).toBeTruthy()
    wrapper.unmount()
  })

  it('无标题时不渲染标题栏，用兜底 aria-label', () => {
    const wrapper = mountModal()

    expect(wrapper.find('.dt-node-modal__head').exists()).toBe(false)
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('详情')
    wrapper.unmount()
  })

  it('Esc 与关闭键都抛 close；点遮罩不关', async () => {
    const wrapper = mountModal('x')

    await wrapper.get('.dt-node-modal__backdrop').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await wrapper.get('.dt-node-modal__close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })

  it('内容区尺寸 = 根节点宽高，超大时钳进舞台', () => {
    const wrapper = mountModal()
    const body = wrapper.get('.dt-node-modal__body')
    expect(body.attributes('style')).toContain('width: 300px')
    wrapper.unmount()

    const huge = mount(NodeModal, {
      props: {
        nodes: [node('big', null, { w: 5000, h: 4000 })],
        rootId: 'big',
        design: { width: 1920, height: 1080 },
        getManifest,
      },
    })
    const bigBody = huge.get('.dt-node-modal__body')
    expect(bigBody.attributes('style')).toContain('width: 1824px')
    huge.unmount()
  })
})
