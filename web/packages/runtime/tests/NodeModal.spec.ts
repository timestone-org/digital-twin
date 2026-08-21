/**
 * @fileoverview 节点弹窗契约：子树重根渲染、初始不可见的根被掀开、
 * Esc 与关闭键收口、遮罩不点击关闭、尺寸钳进舞台。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, type FunctionalComponent } from 'vue'
import type { DashboardNodeView, ModuleManifest } from '@dt/contracts'

import NodeModal from '../src/NodeModal.vue'
import NodeTree from '../src/NodeTree.vue'
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

  // ⚠ DtIcon 拿到未登记的名字静默不画：关闭键一旦画不出图标就是一颗看不见的键
  it('关闭键真的画出了图标，不是一颗空按钮', () => {
    const wrapper = mountModal()

    expect(wrapper.get('.dt-node-modal__close').find('svg').exists()).toBe(true)
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

  // ⚠ 弹窗渲染在舞台内却自起一棵 NodeTree：大屏级外观缺省不透传的话，
  //   弹窗里的模块全部落回平台默认——同一个模块在屏上和弹窗里长两个样
  it('大屏级卡片外观缺省原样透传给弹窗里的 NodeTree', () => {
    const chrome = { titleColor: '#123456', corners: false }
    const wrapper = mount(NodeModal, {
      props: {
        nodes: NODES,
        rootId: 'root',
        design: { width: 1920, height: 1080 },
        getManifest,
        cardChrome: chrome,
      },
    })

    expect(wrapper.getComponent(NodeTree).props('cardChrome')).toEqual(chrome)
    wrapper.unmount()
  })

  it('不传外观缺省时 NodeTree 拿到 undefined，走平台默认', () => {
    const wrapper = mountModal()

    expect(wrapper.getComponent(NodeTree).props('cardChrome')).toBeUndefined()
    wrapper.unmount()
  })

  it('挂载后初始焦点落在面板上，关掉后归还触发元素', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()

    const wrapper = mountModal('x')
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        wrapper.get('.dt-node-modal__panel').element,
      ),
    )

    wrapper.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('Tab 走到最后一个可聚焦元素后折返，键盘出不了弹窗', async () => {
    const wrapper = mountModal('x')
    // 先等初始聚焦落到面板，否则它会在断言前把焦点抢回去
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        wrapper.get('.dt-node-modal__panel').element,
      ),
    )
    // 弹窗里唯一可聚焦的是关闭键：Tab 在它身上必须折回它自己
    const close = wrapper.get('.dt-node-modal__close').element as HTMLElement
    close.focus()

    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Tab' })

    expect(document.activeElement).toBe(close)
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
