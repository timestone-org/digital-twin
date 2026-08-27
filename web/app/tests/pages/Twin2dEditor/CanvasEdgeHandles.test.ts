/**
 * @fileoverview 契约：拖一个把手走几十帧只落**一次** `change`（一手势一步撤销）、
 * 拖到一半被卸载要补上这一次、撤掉的那一手一次都不落；拐点跟位移走并吸网格，端点
 * 吸到最近的引脚或周长，落在空白处则这一端不动。
 *
 * ⚠ 逐帧 commit 不报错，只是撤销键从此按不回上一步——拖一个把手就能塞进几十帧。
 * ⚠ 卸载不补收场同样不报错：拖到一半切走的改动既没进撤销栈也没落库。
 * ⚠ 端点就地造一个「不挂节点」的自由端会让整条线在下次读盘时静默消失
 *   （`normalizeEndpoint` 见到空 nodeId 直接丢整条）。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Pt, Twin2dConfig, Twin2dEdge } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CanvasEdgeHandles from '@/pages/Twin2dEditor/components/CanvasEdgeHandles.vue'
import { TWIN_2D_DEFAULT_SNAP } from '@/pages/Twin2dEditor/scripts/snapping'
import type { Twin2dSnapOptions } from '@/pages/Twin2dEditor/scripts/snapping'
import { useCanvasPointer } from '@/pages/Twin2dEditor/scripts/useCanvasPointer'
import type { Twin2dClientPoint } from '@/pages/Twin2dEditor/scripts/viewportOps'

/** 100×60 的方块，右边中点一个引脚。 */
const NODE_STYLE = {
  id: 'ns',
  name: '方块',
  size: { w: 100, h: 60 },
  ports: [{ id: 'r', at: { kind: 'perim', t: 0.375 }, side: 'right' }],
}

const EDGE_STYLE = {
  id: 'es',
  name: '直线',
  route: 'straight',
  cornerRadius: 0,
  strokes: [{ id: 'core', width: 2 }],
}

/** 一个拐点的连线：折线是 (100,30) → (200,100) → (400,30)。 */
const DOC: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 400, grid: 20 },
  styles: [NODE_STYLE],
  edgeStyles: [EDGE_STYLE],
  nodes: [
    { id: 'a', styleId: 'ns', x: 0, y: 0, w: 100, h: 60 },
    { id: 'b', styleId: 'ns', x: 400, y: 0, w: 100, h: 60 },
    { id: 'c', styleId: 'ns', x: 0, y: 200, w: 100, h: 60 },
  ],
  edges: [
    {
      id: 'e1',
      styleId: 'es',
      from: { nodeId: 'a', t: 0.375 },
      to: { nodeId: 'b', t: 0.875 },
      waypoints: [{ x: 200, y: 100 }],
    },
  ],
})

const SNAP: Twin2dSnapOptions = {
  ...TWIN_2D_DEFAULT_SNAP,
  grid: 20,
  guides: false,
}

/** 用例里视口不缩不移，client 坐标直接当设计坐标用。 */
function identity(at: Twin2dClientPoint): Pt {
  return { x: at.clientX, y: at.clientY }
}

function edgeOf(config: Twin2dConfig): Twin2dEdge {
  const edge = config.edges[0]
  if (edge === undefined) throw new Error('这份文档里没有连线')
  return edge
}

/** 一次挂载的现场：两串事件、卸载开关与当前这一份 props。 */
interface Stand {
  wrapper: ReturnType<typeof mount>
  previews: (Twin2dEdge | null)[]
  changes: Twin2dEdge[]
  hide: () => Promise<void>
}

interface Options {
  edge?: Twin2dEdge
  snap?: Twin2dSnapOptions
  scale?: number
}

function mountHandles(options: Options = {}): Stand {
  const shown = shallowRef(true)
  const previews: (Twin2dEdge | null)[] = []
  const changes: Twin2dEdge[] = []
  const host = defineComponent({
    setup() {
      const pointer = useCanvasPointer({ toDesign: identity })
      return () =>
        shown.value
          ? h(CanvasEdgeHandles, {
              canvas: DOC.canvas,
              edge: options.edge ?? edgeOf(DOC),
              nodes: DOC.nodes,
              nodeStyles: DOC.styles,
              edgeStyles: DOC.edgeStyles,
              snap: options.snap ?? SNAP,
              scale: options.scale ?? 1,
              startGesture: pointer.start,
              cancelGesture: pointer.cancel,
              onPreview: (edge: Twin2dEdge | null) => previews.push(edge),
              onChange: (edge: Twin2dEdge) => changes.push(edge),
            })
          : h('div')
    },
  })
  const wrapper = mount(host)
  return {
    wrapper,
    previews,
    changes,
    hide: async () => {
      shown.value = false
      await nextTick()
    },
  }
}

/**
 * 在某枚把手上按下。
 * @param stand 一次挂载的现场
 * @param test 把手的 data-test
 * @param at 按下的落点
 */
function down(stand: Stand, test: string, at: Pt): void {
  stand.wrapper.get(`[data-test="${test}"]`).element.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: at.x,
      clientY: at.y,
    }),
  )
}

/**
 * window 上的一帧。
 * @param type 事件名
 * @param at 落点
 * @param init 修饰键
 */
function fire(type: string, at: Pt, init: PointerEventInit = {}): void {
  window.dispatchEvent(
    new PointerEvent(type, { clientX: at.x, clientY: at.y, ...init }),
  )
}

function bendOf(edge: Twin2dEdge): Pt | undefined {
  return edge.waypoints[0]
}

describe('把手摆位', () => {
  it('每个拐点一枚、两端各一枚，落在真实折线的头尾上', () => {
    const { wrapper } = mountHandles()
    const bends = wrapper.findAll('[data-test="edge-bend-handle"]')
    const ends = wrapper.findAll('[data-test="edge-end-handle"]')

    expect(bends).toHaveLength(1)
    expect(bends[0]?.attributes('cx')).toBe('200')
    expect(bends[0]?.attributes('cy')).toBe('100')
    expect(ends).toHaveLength(2)
    expect(ends[0]?.attributes('data-id')).toBe('from')
  })

  it('连线挂不上时不画两端把手，也不摆到画布原点上', () => {
    const stand = mountHandles({
      edge: { ...edgeOf(DOC), styleId: 'gone' },
    })

    expect(stand.wrapper.findAll('[data-test="edge-end-handle"]')).toEqual([])
  })

  it('把手按屏幕像素恒定大小：倍率翻倍，设计半径减半', () => {
    const one = mountHandles().wrapper
    const two = mountHandles({ scale: 2 }).wrapper
    const radius = (wrapper: ReturnType<typeof mount>): number =>
      Number(wrapper.get('[data-test="edge-bend-handle"]').attributes('r'))

    expect(radius(two)).toBeCloseTo(radius(one) / 2)
  })
})

describe('拖一个拐点', () => {
  it('走几十帧只在松手那一下落一次 change', () => {
    const stand = mountHandles()
    down(stand, 'edge-bend-handle', { x: 200, y: 100 })
    for (let step = 1; step <= 30; step += 1) {
      fire('pointermove', { x: 200 + step, y: 100 + step })
    }

    expect(stand.changes).toHaveLength(0)
    expect(stand.previews.length).toBeGreaterThan(20)

    fire('pointerup', { x: 243, y: 118 })

    expect(stand.changes).toHaveLength(1)
    expect(bendOf(stand.changes[0] ?? edgeOf(DOC))).toEqual({ x: 240, y: 120 })
  })

  it('落库的是松手那一帧的位置，不是倒数第二帧', () => {
    const stand = mountHandles()
    down(stand, 'edge-bend-handle', { x: 200, y: 100 })
    fire('pointermove', { x: 210, y: 110 })
    fire('pointerup', { x: 243, y: 118 })

    expect(bendOf(stand.changes[0] ?? edgeOf(DOC))).toEqual({ x: 240, y: 120 })
  })

  it('跟的是位移不是指针落点：抓在把手边上不会跳', () => {
    const stand = mountHandles({ snap: { ...SNAP, enabled: false } })
    down(stand, 'edge-bend-handle', { x: 204, y: 104 })
    fire('pointermove', { x: 214, y: 114 })
    fire('pointerup', { x: 214, y: 114 })

    expect(bendOf(stand.changes[0] ?? edgeOf(DOC))).toEqual({ x: 210, y: 110 })
  })

  it('按住 Alt 的那一帧一点都不吸', () => {
    const stand = mountHandles()
    down(stand, 'edge-bend-handle', { x: 200, y: 100 })
    fire('pointermove', { x: 243, y: 118 }, { altKey: true })
    fire('pointerup', { x: 243, y: 118 }, { altKey: true })

    expect(bendOf(stand.changes[0] ?? edgeOf(DOC))).toEqual({ x: 243, y: 118 })
  })

  it('没挪过的那一按不落 commit，也不写草稿', () => {
    const stand = mountHandles()
    down(stand, 'edge-bend-handle', { x: 200, y: 100 })
    fire('pointermove', { x: 202, y: 100 })
    fire('pointerup', { x: 202, y: 100 })

    expect(stand.changes).toEqual([])
    expect(stand.previews).toEqual([])
  })

  it('被系统抢走指针时整手撤掉，草稿跟着归零', () => {
    const stand = mountHandles()
    down(stand, 'edge-bend-handle', { x: 200, y: 100 })
    fire('pointermove', { x: 240, y: 120 })
    fire('pointercancel', { x: 240, y: 120 })

    expect(stand.changes).toEqual([])
    expect(stand.previews.at(-1)).toBeNull()
  })

  it('双击一枚拐点把手就删掉它', async () => {
    const stand = mountHandles()
    await stand.wrapper
      .get('[data-test="edge-bend-handle"]')
      .trigger('dblclick')

    expect(stand.changes).toHaveLength(1)
    expect(stand.changes[0]?.waypoints).toEqual([])
  })
})

describe('拖一端', () => {
  it('落到别的节点上就吸到它的引脚', () => {
    const stand = mountHandles()
    down(stand, 'edge-end-handle', { x: 100, y: 30 })
    fire('pointermove', { x: 96, y: 232 })
    fire('pointerup', { x: 96, y: 232 })

    expect(stand.changes[0]?.from).toEqual({
      nodeId: 'c',
      portId: 'r',
      t: null,
    })
  })

  it('落在节点身上但够不着引脚时钉周长参数', () => {
    const stand = mountHandles()
    down(stand, 'edge-end-handle', { x: 100, y: 30 })
    fire('pointermove', { x: 50, y: 205 })
    fire('pointerup', { x: 50, y: 205 })

    expect(stand.changes[0]?.from).toEqual({
      nodeId: 'c',
      portId: '',
      t: 0.125,
    })
  })

  it('拖的是末端就只改末端，另一端原样', () => {
    const stand = mountHandles()
    const ends = stand.wrapper.findAll('[data-test="edge-end-handle"]')
    ends[1]?.element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 400,
        clientY: 30,
      }),
    )
    fire('pointermove', { x: 96, y: 232 })
    fire('pointerup', { x: 96, y: 232 })

    expect(stand.changes[0]?.to).toEqual({
      nodeId: 'c',
      portId: 'r',
      t: null,
    })
    expect(stand.changes[0]?.from).toEqual(edgeOf(DOC).from)
  })

  it('松手落在空白处则这一端不动，一次 commit 都不落', () => {
    const stand = mountHandles()
    down(stand, 'edge-end-handle', { x: 100, y: 30 })
    fire('pointermove', { x: 600, y: 300 })
    fire('pointerup', { x: 600, y: 300 })

    expect(stand.changes).toEqual([])
  })
})

describe('拖到一半被卸载', () => {
  it('补上这一次 change，改动不至于既没进撤销栈也没落库', async () => {
    const stand = mountHandles()
    down(stand, 'edge-bend-handle', { x: 200, y: 100 })
    fire('pointermove', { x: 243, y: 118 })
    await stand.hide()

    expect(stand.changes).toHaveLength(1)
    expect(bendOf(stand.changes[0] ?? edgeOf(DOC))).toEqual({ x: 240, y: 120 })
  })

  it('卸载之后 window 上再动指针，一次 change 都不再落', async () => {
    const stand = mountHandles()
    down(stand, 'edge-bend-handle', { x: 200, y: 100 })
    fire('pointermove', { x: 243, y: 118 })
    await stand.hide()
    fire('pointermove', { x: 300, y: 300 })
    fire('pointerup', { x: 300, y: 300 })

    expect(stand.changes).toHaveLength(1)
  })

  it('没在拖的时候卸载不落任何一次 change', async () => {
    const stand = mountHandles()
    await stand.hide()

    expect(stand.changes).toEqual([])
    expect(stand.previews).toEqual([])
  })
})
