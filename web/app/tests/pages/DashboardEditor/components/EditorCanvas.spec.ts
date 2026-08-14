/**
 * @fileoverview 契约：画布按排版结果摆节点、选中与拖动抛出事件，
 * 且**卸载时把 ResizeObserver 断开**——大屏一开就是几天，漏一次就持续累积一份。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import { layoutFrames } from '@/features/dashboard/editorLayout'
import EditorCanvas from '@/pages/DashboardEditor/components/EditorCanvas.vue'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  chrome: 'bare',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [],
  preview: { config: { title: '演示标题' } },
  component: () => Promise.resolve({ default: { template: '<i />' } }),
}

function getManifest(): ModuleManifest {
  return MANIFEST
}

function node(id: string, over: Partial<DashboardNodePayload> = {}): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
    ...over,
  }
}

const disconnect = vi.fn()
const observe = vi.fn()

class FakeObserver {
  observe = observe
  disconnect = disconnect
  unobserve = vi.fn()
}

beforeEach(() => {
  disconnect.mockClear()
  observe.mockClear()
  vi.stubGlobal('ResizeObserver', FakeObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mountCanvas(nodes: DashboardNodePayload[], selectedId: string | null = null) {
  return mount(EditorCanvas, {
    props: {
      design: { width: 1920, height: 1080 },
      frames: layoutFrames(nodes, getManifest).frames,
      nodes,
      selectedId,
      getManifest,
    },
  })
}

describe('摆节点', () => {
  it('一个节点一格，位置来自排版结果', () => {
    const wrapper = mountCanvas([node('a')])
    const box = wrapper.find('.dt-canvas__node')

    expect(box.attributes('style')).toContain('left: 10px')
    expect(box.attributes('style')).toContain('top: 20px')
  })

  it('选中的那一格挂上选中样式', () => {
    const wrapper = mountCanvas([node('a'), node('b', { zIndex: 1 })], 'b')
    const boxes = wrapper.findAll('.dt-canvas__node')

    expect(boxes[0]?.classes()).not.toContain('dt-canvas__node--selected')
    expect(boxes[1]?.classes()).toContain('dt-canvas__node--selected')
  })

  it('隐藏的节点在设计态仍然画出来，只是标成隐藏——不然没法把它改回可见', () => {
    const wrapper = mountCanvas([node('a', { isVisible: false })])

    expect(wrapper.find('.dt-canvas__node').classes()).toContain(
      'dt-canvas__node--hidden',
    )
  })

  it('只有选中的那一格有缩放把手', () => {
    const wrapper = mountCanvas([node('a')], 'a')

    expect(wrapper.findAll('.dt-canvas__handle')).toHaveLength(1)
  })
})

describe('选中与拖动', () => {
  it('按下一格就选中它', async () => {
    const wrapper = mountCanvas([node('a')])

    await wrapper.find('.dt-canvas__node').trigger('pointerdown')

    expect(wrapper.emitted('select')?.[0]).toEqual(['a'])
  })

  it('按在空白处清掉选中', async () => {
    const wrapper = mountCanvas([node('a')], 'a')

    await wrapper.find('.dt-canvas').trigger('pointerdown')

    expect(wrapper.emitted('select')?.at(-1)).toEqual([null])
  })

  it('拖动过程中抛出连续的几何变更', async () => {
    const wrapper = mountCanvas([node('a')], 'a')

    await wrapper.find('.dt-canvas__node').trigger('pointerdown', {
      clientX: 0,
      clientY: 0,
    })
    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 30, clientY: 0 }),
    )
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 30, clientY: 0 }))

    const changes = wrapper.emitted('change') ?? []
    expect(changes).toHaveLength(2)
    expect(changes[1]).toEqual(['a', { x: 40, y: 20, w: 100, h: 50 }, false])
  })
})

describe('卸载清理', () => {
  it('挂载时接上 ResizeObserver，卸载时断开', () => {
    const wrapper = mountCanvas([node('a')])
    expect(observe).toHaveBeenCalledTimes(1)

    wrapper.unmount()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('卸载之后再动鼠标不再抛出几何变更', async () => {
    const wrapper = mountCanvas([node('a')], 'a')
    await wrapper.find('.dt-canvas__node').trigger('pointerdown', {
      clientX: 0,
      clientY: 0,
    })
    wrapper.unmount()

    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 90, clientY: 90 }),
    )

    expect(wrapper.emitted('change')).toBeUndefined()
  })
})
