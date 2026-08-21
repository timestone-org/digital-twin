/**
 * @fileoverview 契约：画布按排版结果摆节点，点选/Shift 多选/右键/模块库拖放各自
 * 抛出对应事件，钉位节点点得中却拖不动，且**卸载时把拖动的 window 监听摘掉**——
 * 大屏一开就是几天，漏一次就留下一副永远跟着鼠标走的监听。
 */
import type {
  CardChrome,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import {
  normalizeEditorGrid,
  normalizeSnapConfig,
  type SnapConfig,
} from '@/features/dashboard/canvasSnap'
import { layoutFrames } from '@/features/dashboard/editorLayout'
import { MODULE_DRAG_MIME } from '@/features/dashboard/moduleLibrary'
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

const PINNED: ModuleManifest = { ...MANIFEST, type: 'pinned', region: 'header' }
const CONTAINER: ModuleManifest = {
  ...MANIFEST,
  type: 'box',
  isContainer: true,
}

function getManifest(moduleType: string): ModuleManifest {
  if (moduleType === 'pinned') return PINNED
  return moduleType === 'box' ? CONTAINER : MANIFEST
}

/** 步进 10 的像素吸附：栅格档的周期是小数，断言会被浮点噪声淹掉。 */
const SNAP: SnapConfig = normalizeSnapConfig({ mode: 'px', step: 10 })
const GRID = normalizeEditorGrid()

function node(
  id: string,
  over: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
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

function mountCanvas(
  nodes: DashboardNodePayload[],
  selectedIds: string[] = [],
  snap: SnapConfig = SNAP,
  cardChrome: CardChrome = {},
) {
  return mount(EditorCanvas, {
    props: {
      design: { width: 1920, height: 1080 },
      frames: layoutFrames(nodes, getManifest).frames,
      nodes,
      selectedIds,
      getManifest,
      cardChrome,
      snap,
      grid: GRID,
      zoom: null,
    },
  })
}

function pointer(type: string, clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX, clientY }))
}

describe('摆节点', () => {
  it('一个节点一格，位置来自排版结果', () => {
    const wrapper = mountCanvas([node('a')])

    const box = wrapper.find('.dt-node')
    expect(box.attributes('style')).toContain('left: 10px')
    expect(box.attributes('style')).toContain('top: 20px')
  })

  it('隐藏的节点在设计态仍然画出来，只是标成隐藏', () => {
    const wrapper = mountCanvas([node('a', { isVisible: false })])

    expect(wrapper.find('.dt-node').classes()).toContain('dt-node--hidden')
  })

  it('选中的那一格挂上选中样式，没选中的不挂', () => {
    const wrapper = mountCanvas([node('a'), node('b', { zIndex: 1 })], ['b'])

    const boxes = wrapper.findAll('.dt-node')
    expect(boxes[0]?.classes()).not.toContain('dt-node--selected')
    expect(boxes[1]?.classes()).toContain('dt-node--selected')
  })

  it('单选的那一格给 8 个手柄，没选中的一个都没有', () => {
    const wrapper = mountCanvas([node('a'), node('b', { zIndex: 1 })], ['a'])

    expect(wrapper.findAll('.dt-node__handle')).toHaveLength(8)
  })

  it('多选时不出手柄——拖手柄该改谁的尺寸没有定义', () => {
    const wrapper = mountCanvas(
      [node('a'), node('b', { zIndex: 1 })],
      ['a', 'b'],
    )

    expect(wrapper.findAll('.dt-node__handle')).toHaveLength(0)
  })

  it('钉位节点只给一个手柄，且只许动高', () => {
    const wrapper = mountCanvas(
      [node('h', { moduleType: 'pinned', x: 0, y: 0, w: 1920, h: 80 })],
      ['h'],
    )

    expect(wrapper.findAll('.dt-node__handle')).toHaveLength(1)
  })

  it('一个节点都没有时出中央引导层，且挂在缩放变换的舞台之外', () => {
    const wrapper = mountCanvas([])

    const empty = wrapper.find('.dt-canvas__empty')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('从左侧模块库拖入模块开始搭建')
    // 挂在 stage 外：引导文字不随画布倍率缩放（pointer-events 在 SCSS 里，vitest 不编译）
    expect(wrapper.find('.dt-canvas__stage .dt-canvas__empty').exists()).toBe(
      false,
    )
  })

  it('有节点时不出引导层', () => {
    const wrapper = mountCanvas([node('a')])

    expect(wrapper.find('.dt-canvas__empty').exists()).toBe(false)
  })
})

describe('点选', () => {
  it('按下一格就选中它，且不是累加', async () => {
    const wrapper = mountCanvas([node('a')])

    await wrapper
      .find('.dt-node__surface')
      .trigger('pointerdown', { button: 0 })

    expect(wrapper.emitted('select')?.[0]).toEqual(['a', false])
  })

  it('按住 Shift 点选是累加，且不起手拖动', async () => {
    const wrapper = mountCanvas([node('a')])

    await wrapper
      .find('.dt-node__surface')
      .trigger('pointerdown', { button: 0, shiftKey: true })
    pointer('pointermove', 40, 0)

    expect(wrapper.emitted('select')?.[0]).toEqual(['a', true])
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('在空白处按下再松手清掉选中', async () => {
    const wrapper = mountCanvas([node('a')], ['a'])

    await wrapper.find('.dt-canvas__grid').trigger('pointerdown', { button: 0 })
    pointer('pointerup', 0, 0)

    expect(wrapper.emitted('select')?.at(-1)).toEqual([null, false])
  })

  it('右键未选中的节点：先单选它再上抛画布菜单的 client 坐标，不带粘贴落点', async () => {
    const wrapper = mountCanvas([node('a')])

    await wrapper
      .find('.dt-node__surface')
      .trigger('contextmenu', { clientX: 30, clientY: 40 })

    expect(wrapper.emitted('select')?.[0]).toEqual(['a', false])
    expect(wrapper.emitted('canvas-menu')?.[0]).toEqual([
      { x: 30, y: 40, pasteAt: null },
      'a',
    ])
  })

  it('右键空白处上抛菜单：节点 id 为空且带上命中层的粘贴落点', async () => {
    const wrapper = mountCanvas([node('a')])

    await wrapper
      .find('.dt-canvas__grid')
      .trigger('contextmenu', { clientX: 12, clientY: 8 })

    expect(wrapper.emitted('canvas-menu')?.[0]).toEqual([
      {
        x: 12,
        y: 8,
        pasteAt: {
          parentId: null,
          x: 12,
          y: 8,
          layer: { width: 1920, height: 1080 },
        },
      },
      null,
    ])
  })
})

describe('拖动', () => {
  it('拖动过程中连续抛出几何，松手那一下抛一次收尾', async () => {
    const wrapper = mountCanvas([node('a')], ['a'])

    await wrapper.find('.dt-node__surface').trigger('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    pointer('pointermove', 30, 0)
    pointer('pointerup', 30, 0)

    const changes = wrapper.emitted('change') ?? []
    expect(changes).toHaveLength(2)
    expect(changes[1]).toEqual(['a', { x: 40, y: 20, w: 100, h: 50 }, false])
  })

  it('拖动中出几何浮标显示实时位置，松手即收', async () => {
    const wrapper = mountCanvas([node('a')], ['a'])

    await wrapper.find('.dt-node__surface').trigger('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    pointer('pointermove', 30, 0)
    await nextTick()

    expect(wrapper.find('.dt-readout').text()).toBe('40, 20')

    pointer('pointerup', 30, 0)
    await nextTick()
    expect(wrapper.find('.dt-readout').exists()).toBe(false)
  })

  it('原地单击不闪浮标', async () => {
    const wrapper = mountCanvas([node('a')], ['a'])

    await wrapper.find('.dt-node__surface').trigger('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    pointer('pointermove', 0, 0)
    await nextTick()

    expect(wrapper.find('.dt-readout').exists()).toBe(false)
    pointer('pointerup', 0, 0)
  })

  it('钉位节点点得中却拖不动', async () => {
    const nodes = [
      node('h', { moduleType: 'pinned', x: 0, y: 0, w: 1920, h: 80 }),
    ]
    const wrapper = mountCanvas(nodes)

    await wrapper.find('.dt-node__surface').trigger('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    pointer('pointermove', 40, 40)
    pointer('pointerup', 40, 40)

    expect(wrapper.emitted('select')?.[0]).toEqual(['h', false])
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('卸载之后再动鼠标不再抛出几何变更', async () => {
    const wrapper = mountCanvas([node('a')], ['a'])
    await wrapper.find('.dt-node__surface').trigger('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    wrapper.unmount()

    pointer('pointermove', 90, 90)
    pointer('pointerup', 90, 90)

    expect(wrapper.emitted('change')).toBeUndefined()
  })
})

describe('框选与参考线', () => {
  it('空白处拖出框：与框相交的顶层节点整批选中', async () => {
    const wrapper = mountCanvas([node('a')])

    await wrapper.find('.dt-canvas__grid').trigger('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    pointer('pointermove', 200, 200)
    pointer('pointerup', 200, 200)

    expect(wrapper.emitted('marquee')?.[0]).toEqual([['a'], false])
  })

  it('拖到与兄弟对齐时画出参考线', async () => {
    const nodes = [node('a'), node('b', { x: 200, zIndex: 1 })]
    const wrapper = mountCanvas(nodes, ['a'])

    await wrapper.findAll('.dt-node__surface')[0]?.trigger('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    pointer('pointermove', 0, 3)
    await nextTick()

    expect(wrapper.findAll('.dt-guides line').length).toBeGreaterThan(0)
  })
})

describe('换父', () => {
  it('松手落进容器时抛换父，坐标换算成容器内的局部值', async () => {
    const nodes = [
      node('a'),
      node('box', {
        moduleType: 'box',
        x: 200,
        y: 200,
        w: 400,
        h: 300,
        zIndex: 1,
      }),
    ]
    const wrapper = mountCanvas(
      nodes,
      ['a'],
      normalizeSnapConfig({ mode: 'px', step: 10, guides: false }),
    )

    await wrapper.findAll('.dt-node__surface')[0]?.trigger('pointerdown', {
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    pointer('pointermove', 300, 300)
    pointer('pointerup', 300, 300)

    expect(wrapper.emitted('drop-node')?.[0]).toEqual([
      'a',
      'box',
      { x: 100, y: 110, w: 100, h: 50 },
    ])
  })
})

describe('模块库拖放', () => {
  it('落在顶层：按落点吸附后上抛模块类型与坐标', async () => {
    const wrapper = mountCanvas([node('a')])

    await wrapper.find('.dt-canvas__stage').trigger('drop', {
      clientX: 104,
      clientY: 47,
      dataTransfer: {
        getData: (type: string) => (type === MODULE_DRAG_MIME ? 'demo' : ''),
      },
    })

    expect(wrapper.emitted('add-at')?.[0]).toEqual([
      'demo',
      { parentId: null, x: 100, y: 50 },
    ])
  })

  it('拖进来的不是模块就什么都不发', async () => {
    const wrapper = mountCanvas([node('a')])

    await wrapper.find('.dt-canvas__stage').trigger('drop', {
      clientX: 10,
      clientY: 10,
      dataTransfer: { getData: () => '' },
    })

    expect(wrapper.emitted('add-at')).toBeUndefined()
  })
})

describe('大屏级卡片外观', () => {
  // ⚠ 画布不套外观的话，右栏改了边框只有预览页看得见，用户读到的是「配了没生效」
  it('注入到画布上每一格的渲染根', () => {
    const wrapper = mountCanvas([node('a')], [], SNAP, { radius: 12 })

    expect(wrapper.get('.dt-module').attributes('style')).toContain(
      '--card-radius: 12px',
    )
  })

  it('一个键都没配时一格也不注入', () => {
    const wrapper = mountCanvas([node('a')])

    expect(wrapper.get('.dt-module').attributes('style')).toBeUndefined()
  })
})
