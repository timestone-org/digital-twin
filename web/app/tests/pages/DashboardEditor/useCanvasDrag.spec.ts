/**
 * @fileoverview 契约：拖动的算术（步进吸附、参考线优先、8 向缩放只动在动的那条边、
 * 多选整体位移、换父换算）与会话的收口——卸载与 `pointercancel` 都要真的把
 * window 监听摘掉，只在 `pointerup` 里摘会留下一副永远跟着鼠标走的监听。
 */
import type { NodeBox } from '@dt/runtime'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import {
  normalizeEditorGrid,
  normalizeSnapConfig,
} from '@/features/dashboard/canvasSnap'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import {
  computeDrag,
  reparentGeometry,
  type CanvasDrag,
  type DragItem,
  type DragSession,
  type DropTarget,
} from '@/pages/DashboardEditor/canvasDrag'
import { useCanvasDrag } from '@/pages/DashboardEditor/useCanvasDrag'

const LAYER = { width: 1000, height: 800 }
/** 步进 10 的像素吸附：栅格档的周期是小数，断言会被浮点噪声淹掉。 */
const SNAP = normalizeSnapConfig({ mode: 'px', step: 10 })
const GRID = normalizeEditorGrid()
const START: NodeBox = { x: 100, y: 100, w: 200, h: 100 }

function item(
  nodeId: string,
  start: NodeBox,
  over: Partial<DragItem> = {},
): DragItem {
  return {
    nodeId,
    parentId: null,
    start,
    originX: 0,
    originY: 0,
    layer: LAYER,
    minW: 24,
    minH: 24,
    isPinned: false,
    ...over,
  }
}

function session(
  over: Partial<DragSession> & { anchor: DragItem },
): DragSession {
  return {
    kind: 'move',
    dir: { x: 0, y: 0 },
    clientX: 0,
    clientY: 0,
    items: [over.anchor],
    excluded: new Set([over.anchor.nodeId]),
    candidates: [],
    snap: SNAP,
    grid: GRID,
    wasMulti: false,
    moved: false,
    ...over,
  }
}

const FRAME = { free: false, threshold: 6 }

describe('位移', () => {
  it('位移后按步进吸附', () => {
    const current = session({ anchor: item('a', START) })

    const result = computeDrag(current, { dx: 13, dy: -7, ...FRAME })

    expect(result.rects.get('a')).toEqual({ x: 110, y: 90, w: 200, h: 100 })
  })

  it('按住 Alt 是自由像素放置，一点都不吸', () => {
    const current = session({ anchor: item('a', START) })

    const result = computeDrag(current, {
      dx: 13,
      dy: -7,
      ...FRAME,
      free: true,
    })

    expect(result.rects.get('a')).toEqual({ x: 113, y: 93, w: 200, h: 100 })
  })

  it('参考线命中的那一轴优先吸边线，压过步进', () => {
    const current = session({
      anchor: item('a', START),
      candidates: [{ left: 118, top: 0, width: 50, height: 50 }],
    })

    const result = computeDrag(current, { dx: 13, dy: 0, ...FRAME })

    expect(result.rects.get('a')?.x).toBe(118)
    expect(result.guides).toContainEqual(
      expect.objectContaining({ orientation: 'v', pos: 118 }),
    )
  })

  it('拖出画布的部分夹回本层边界', () => {
    const current = session({ anchor: item('a', START) })

    const result = computeDrag(current, { dx: 9000, dy: 9000, ...FRAME })

    expect(result.rects.get('a')).toEqual({ x: 800, y: 700, w: 200, h: 100 })
  })

  it('多选整体位移：锚点吸附后的净位移原样施加到其余项', () => {
    const anchor = item('a', START)
    const other = item('b', { x: 400, y: 300, w: 50, h: 50 })
    const current = session({ anchor, items: [anchor, other] })

    const result = computeDrag(current, { dx: 13, dy: 13, ...FRAME })

    expect(result.rects.get('a')).toEqual({ x: 110, y: 110, w: 200, h: 100 })
    expect(result.rects.get('b')).toEqual({ x: 410, y: 310, w: 50, h: 50 })
  })
})

describe('缩放', () => {
  it('拖右下角只动宽高', () => {
    const current = session({
      anchor: item('a', START),
      kind: 'resize',
      dir: { x: 1, y: 1 },
    })

    const result = computeDrag(current, { dx: 13, dy: 13, ...FRAME })

    expect(result.rects.get('a')).toEqual({ x: 100, y: 100, w: 210, h: 110 })
  })

  it('拖左上角同时动起点与宽高', () => {
    const current = session({
      anchor: item('a', START),
      kind: 'resize',
      dir: { x: -1, y: -1 },
    })

    const result = computeDrag(current, { dx: -13, dy: -13, ...FRAME })

    expect(result.rects.get('a')).toEqual({ x: 90, y: 90, w: 210, h: 110 })
  })

  it('只吸正在动的那条边：拖右边时左边不会被参考线拽走', () => {
    const current = session({
      anchor: item('a', START),
      kind: 'resize',
      dir: { x: 1, y: 0 },
      candidates: [{ left: 104, top: 0, width: 2, height: 2 }],
    })

    const result = computeDrag(current, { dx: 13, dy: 0, ...FRAME })

    expect(result.rects.get('a')?.x).toBe(100)
  })

  it('缩不到比最小边长还小', () => {
    const current = session({
      anchor: item('a', START),
      kind: 'resize',
      dir: { x: 1, y: 1 },
    })

    const result = computeDrag(current, { dx: -9000, dy: -9000, ...FRAME })

    expect(result.rects.get('a')).toMatchObject({ w: 24, h: 24 })
  })

  it('钉位节点横向被钉死，只有高能改', () => {
    const current = session({
      anchor: item('h', { x: 0, y: 0, w: 1000, h: 80 }, { isPinned: true }),
      kind: 'resize',
      dir: { x: 0, y: 1 },
    })

    const result = computeDrag(current, { dx: 50, dy: 23, ...FRAME })

    expect(result.rects.get('h')).toEqual({ x: 0, y: 0, w: 1000, h: 100 })
  })
})

describe('换父', () => {
  it('绝对位置换算成目标层的局部坐标再吸附', () => {
    const target: DropTarget = {
      parentId: 'box',
      originX: 150,
      originY: 50,
      layer: { width: 400, height: 300 },
    }

    const geometry = reparentGeometry({
      anchor: item('a', START),
      rect: { x: 203, y: 104, w: 80, h: 40 },
      target,
      snap: SNAP,
      grid: GRID,
      free: false,
    })

    expect(geometry).toEqual({ x: 50, y: 50, w: 80, h: 40 })
  })
})

interface Change {
  nodeId: string
  geometry: NodeGeometry
  isContinuous: boolean
}

function mountDrag(target: DropTarget | null = null, scale = 1) {
  const changes: Change[] = []
  const batches: Array<[Map<string, NodeGeometry>, boolean]> = []
  const reparented: Array<[string, string | null, NodeGeometry]> = []
  const collapsed: string[] = []
  let drag: CanvasDrag | null = null
  const host = defineComponent({
    setup() {
      drag = useCanvasDrag({
        scale: () => scale,
        dropTargetAt: () => target,
        onChange: (nodeId, geometry, isContinuous) =>
          changes.push({ nodeId, geometry, isContinuous }),
        onChangeBatch: (map, isContinuous) => batches.push([map, isContinuous]),
        onReparent: (nodeId, parentId, geometry) =>
          reparented.push([nodeId, parentId, geometry]),
        onCollapse: (nodeId) => collapsed.push(nodeId),
      })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return {
    wrapper,
    changes,
    batches,
    reparented,
    collapsed,
    drag: drag as unknown as CanvasDrag,
  }
}

function pointer(type: string, clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX, clientY }))
}

describe('一次拖动会话', () => {
  it('单选拖动逐帧抛出，松手那一下抛一次收尾', () => {
    const { drag, changes, wrapper } = mountDrag()

    drag.start(session({ anchor: item('a', START) }))
    pointer('pointermove', 20, 0)
    pointer('pointerup', 20, 0)

    expect(changes.map((change) => change.isContinuous)).toEqual([true, false])
    expect(changes[1]?.geometry).toEqual({ x: 120, y: 100, w: 200, h: 100 })
    wrapper.unmount()
  })

  it('屏幕位移按生效倍率折算，缩得越小不该拖得越快', () => {
    const { drag, changes, wrapper } = mountDrag(null, 0.5)

    drag.start(session({ anchor: item('a', START) }))
    pointer('pointerup', 10, 0)

    expect(changes[0]?.geometry.x).toBe(120)
    wrapper.unmount()
  })

  it('倍率为 0 时按 1 折算，不把 Infinity 写进坐标', () => {
    const { drag, changes, wrapper } = mountDrag(null, 0)

    drag.start(session({ anchor: item('a', START) }))
    pointer('pointerup', 12, 0)

    expect(changes[0]?.geometry.x).toBe(110)
    wrapper.unmount()
  })

  it('多选拖动走批量事件，一帧一批', () => {
    const anchor = item('a', START)
    const other = item('b', { x: 400, y: 300, w: 50, h: 50 })
    const { drag, batches, changes, wrapper } = mountDrag()

    drag.start(session({ anchor, items: [anchor, other], wasMulti: true }))
    pointer('pointermove', 20, 0)
    pointer('pointerup', 20, 0)

    expect(batches.map(([, live]) => live)).toEqual([true, false])
    expect(batches[1]?.[0].get('b')).toEqual({ x: 420, y: 300, w: 50, h: 50 })
    expect(changes).toEqual([])
    wrapper.unmount()
  })

  it('多选里原地单击收敛成单选，且不记一笔几何变更', () => {
    const anchor = item('a', START)
    const { drag, batches, collapsed, wrapper } = mountDrag()

    drag.start(session({ anchor, items: [anchor], wasMulti: true }))
    pointer('pointerup', 0, 0)

    expect(collapsed).toEqual(['a'])
    expect(batches).toEqual([])
    wrapper.unmount()
  })

  it('松手落进另一个容器时抛换父而不是改几何', () => {
    const { drag, changes, reparented, wrapper } = mountDrag({
      parentId: 'box',
      originX: 100,
      originY: 100,
      layer: { width: 400, height: 300 },
    })

    drag.start(session({ anchor: item('a', START) }))
    pointer('pointermove', 20, 0)
    pointer('pointerup', 20, 0)

    expect(reparented[0]).toEqual(['a', 'box', { x: 20, y: 0, w: 200, h: 100 }])
    expect(changes.filter((change) => !change.isContinuous)).toEqual([])
    wrapper.unmount()
  })

  it('pointercancel 也收尾，且不换父', () => {
    const { drag, changes, reparented, wrapper } = mountDrag({
      parentId: 'box',
      originX: 100,
      originY: 100,
      layer: { width: 400, height: 300 },
    })

    drag.start(session({ anchor: item('a', START) }))
    pointer('pointermove', 20, 0)
    pointer('pointercancel', 20, 0)
    pointer('pointermove', 90, 90)

    expect(changes.at(-1)?.isContinuous).toBe(false)
    expect(reparented).toEqual([])
    expect(changes).toHaveLength(2)
    wrapper.unmount()
  })

  it('拖动中被卸载时监听一起摘掉', () => {
    const { drag, changes, wrapper } = mountDrag()

    drag.start(session({ anchor: item('a', START) }))
    wrapper.unmount()
    pointer('pointermove', 99, 99)
    pointer('pointerup', 99, 99)

    expect(changes).toEqual([])
  })

  it('再起一次拖动会先摘掉上一次的监听', () => {
    const { drag, changes, wrapper } = mountDrag()

    drag.start(session({ anchor: item('a', START) }))
    drag.start(session({ anchor: item('b', START) }))
    pointer('pointermove', 20, 0)

    expect(changes.map((change) => change.nodeId)).toEqual(['b'])
    wrapper.unmount()
  })
})
