/**
 * @fileoverview 契约：从一个端口拉出来的预览虚线跟着指针走、**预览期间一个字都不往
 * 文档里写**，松手落到别的节点上才抛一次 `connect`，落在空白处或落回自己整个丢弃，
 * 拉到一半被卸载则按落定收。
 *
 * ⚠ 预览期间就写文档不报错，只是撤销栈里多出两格空动作：写进去再删。
 * ⚠ 自环那一档两端会解析到同一只盒上，画出来是一个点——不拦的话用户以为线没画出来。
 * ⚠ 同一个 pointerdown 起两次手势时，第二次会把第一次顶掉，表现是「松手之后线还黏在
 * 指针上」。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Pt, Twin2dConfig, Twin2dEndpoint } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CanvasConnectPreview from '@/pages/Twin2dEditor/components/CanvasConnectPreview.vue'
import { useCanvasPointer } from '@/pages/Twin2dEditor/scripts/useCanvasPointer'
import type { Twin2dClientPoint } from '@/pages/Twin2dEditor/scripts/viewportOps'

/** 100×60 的方块，右边中点一个引脚。 */
const NODE_STYLE = {
  id: 'ns',
  name: '方块',
  size: { w: 100, h: 60 },
  ports: [{ id: 'r', at: { kind: 'perim', t: 0.375 }, side: 'right' }],
}

/** a 的引脚在 (100,30)，c 的引脚在 (100,230)。 */
const DOC: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 400, grid: 20 },
  styles: [NODE_STYLE],
  nodes: [
    { id: 'a', styleId: 'ns', x: 0, y: 0, w: 100, h: 60 },
    { id: 'c', styleId: 'ns', x: 0, y: 200, w: 100, h: 60 },
  ],
})

/** 一次拉线的起手：端口加那一下 pointerdown。 */
interface Source {
  nodeId: string
  portId: string
  event: PointerEvent
}

/** 用例里视口不缩不移，client 坐标直接当设计坐标用。 */
function identity(at: Twin2dClientPoint): Pt {
  return { x: at.clientX, y: at.clientY }
}

/** 一次挂载的现场。 */
interface Stand {
  wrapper: ReturnType<typeof mount>
  connects: [Twin2dEndpoint, Twin2dEndpoint][]
  /** ⚠ 计数装在对象里：展开 `Stand` 时数字会被拷走，回调加的就是另一个变量了。 */
  counts: { done: number }
  start: (source: Source) => Promise<void>
  hide: () => Promise<void>
}

/**
 * 挂一份预览。
 * @param toDesign 指针 → 设计坐标；回 null 即「舞台还没挂上」
 */
function mountPreview(
  toDesign: (at: Twin2dClientPoint) => Pt | null = identity,
): Stand {
  const shown = shallowRef(true)
  const source = shallowRef<Source | null>(null)
  const connects: [Twin2dEndpoint, Twin2dEndpoint][] = []
  const counts = { done: 0 }
  const stand: Omit<Stand, 'wrapper'> = {
    connects,
    counts,
    start: async (next) => {
      source.value = next
      await nextTick()
    },
    hide: async () => {
      shown.value = false
      await nextTick()
    },
  }
  const host = defineComponent({
    setup() {
      const pointer = useCanvasPointer({ toDesign })
      return () =>
        shown.value
          ? h(CanvasConnectPreview, {
              canvas: DOC.canvas,
              source: source.value,
              nodes: DOC.nodes,
              nodeStyles: DOC.styles,
              scale: 1,
              startGesture: pointer.start,
              cancelGesture: pointer.cancel,
              onConnect: (from: Twin2dEndpoint, to: Twin2dEndpoint) =>
                connects.push([from, to]),
              onDone: () => {
                counts.done += 1
                source.value = null
              },
            })
          : h('div')
    },
  })
  return { ...stand, wrapper: mount(host) }
}

function down(at: Pt): PointerEvent {
  return new PointerEvent('pointerdown', { clientX: at.x, clientY: at.y })
}

/**
 * window 上的一帧。
 * @param type 事件名
 * @param at 落点
 */
function fire(type: string, at: Pt): void {
  window.dispatchEvent(new PointerEvent(type, { clientX: at.x, clientY: at.y }))
}

/** 从 a 的引脚起手。 */
async function pull(stand: Stand): Promise<void> {
  await stand.start({
    nodeId: 'a',
    portId: 'r',
    event: down({ x: 100, y: 30 }),
  })
}

function lineOf(stand: Stand): Record<string, string> {
  return stand.wrapper.get('[data-test="connect-line"]').attributes()
}

describe('预览虚线', () => {
  it('从起手那个引脚画起，跟着指针走', async () => {
    const stand = mountPreview()
    await pull(stand)
    fire('pointermove', { x: 300, y: 300 })
    await nextTick()

    expect(lineOf(stand)).toMatchObject({
      x1: '100',
      y1: '30',
      x2: '300',
      y2: '300',
    })
  })

  it('吸到目标引脚时线头贴上去，并出一个落点圆点', async () => {
    const stand = mountPreview()
    await pull(stand)
    fire('pointermove', { x: 96, y: 232 })
    await nextTick()

    expect(lineOf(stand)).toMatchObject({ x2: '100', y2: '230' })
    expect(stand.wrapper.find('[data-test="connect-dot"]').exists()).toBe(true)
  })

  it('落在空白处时只有虚线，没有落点圆点', async () => {
    const stand = mountPreview()
    await pull(stand)
    fire('pointermove', { x: 600, y: 300 })
    await nextTick()

    expect(stand.wrapper.find('[data-test="connect-dot"]').exists()).toBe(false)
  })

  it('没在拉线时整层不画', () => {
    const stand = mountPreview()

    expect(stand.wrapper.find('[data-test="connect-preview"]').exists()).toBe(
      false,
    )
  })

  it('预览期间一条连线都不抛出去', async () => {
    const stand = mountPreview()
    await pull(stand)
    for (let step = 1; step <= 20; step += 1) {
      fire('pointermove', { x: 100 + step * 5, y: 30 + step * 5 })
    }

    expect(stand.connects).toEqual([])
    expect(stand.counts.done).toBe(0)
  })
})

describe('松手', () => {
  it('落到别的节点上才抛一条新连线的两端', async () => {
    const stand = mountPreview()
    await pull(stand)
    fire('pointermove', { x: 96, y: 232 })
    fire('pointerup', { x: 96, y: 232 })

    expect(stand.connects).toEqual([
      [
        { nodeId: 'a', portId: 'r', t: null },
        { nodeId: 'c', portId: 'r', t: null },
      ],
    ])
    expect(stand.counts.done).toBe(1)
  })

  it('落在空白处整个丢弃，只收场不连线', async () => {
    const stand = mountPreview()
    await pull(stand)
    fire('pointermove', { x: 600, y: 300 })
    fire('pointerup', { x: 600, y: 300 })
    await nextTick()

    expect(stand.connects).toEqual([])
    expect(stand.counts.done).toBe(1)
    expect(stand.wrapper.find('[data-test="connect-preview"]').exists()).toBe(
      false,
    )
  })

  it('落回起手那个节点也丢弃：自环两端会解析到同一处', async () => {
    const stand = mountPreview()
    await pull(stand)
    fire('pointermove', { x: 50, y: 30 })
    fire('pointerup', { x: 50, y: 30 })

    expect(stand.connects).toEqual([])
    expect(stand.counts.done).toBe(1)
  })

  it('被系统抢走指针时整个丢弃', async () => {
    const stand = mountPreview()
    await pull(stand)
    fire('pointermove', { x: 96, y: 232 })
    fire('pointercancel', { x: 96, y: 232 })

    expect(stand.connects).toEqual([])
    expect(stand.counts.done).toBe(1)
  })
})

describe('起手与收场', () => {
  it('引脚寻不到时当场收场，一条虚线都不画', async () => {
    const stand = mountPreview()
    await stand.start({
      nodeId: 'a',
      portId: 'nope',
      event: down({ x: 100, y: 30 }),
    })

    expect(stand.counts.done).toBe(1)
    expect(stand.wrapper.find('[data-test="connect-preview"]').exists()).toBe(
      false,
    )
  })

  it('起手那个节点已经没了时当场收场', async () => {
    const stand = mountPreview()
    await stand.start({
      nodeId: 'gone',
      portId: 'r',
      event: down({ x: 100, y: 30 }),
    })

    expect(stand.counts.done).toBe(1)
    expect(stand.wrapper.find('[data-test="connect-preview"]').exists()).toBe(
      false,
    )
  })

  it('舞台还没挂上时手势起不来，这一手当没发生过', async () => {
    const stand = mountPreview(() => null)
    await pull(stand)

    expect(stand.counts.done).toBe(1)
    expect(stand.wrapper.find('[data-test="connect-preview"]').exists()).toBe(
      false,
    )
  })

  it('没在拉线时卸载不发任何事件', async () => {
    const stand = mountPreview()
    await stand.hide()

    expect(stand.connects).toEqual([])
    expect(stand.counts.done).toBe(0)
  })

  it('同一下 pointerdown 只起一次手势', async () => {
    const stand = mountPreview()
    const event = down({ x: 100, y: 30 })
    await stand.start({ nodeId: 'a', portId: 'r', event })
    await stand.start({ nodeId: 'a', portId: 'r', event })
    fire('pointermove', { x: 96, y: 232 })
    fire('pointerup', { x: 96, y: 232 })

    expect(stand.connects).toHaveLength(1)
    expect(stand.counts.done).toBe(1)
  })

  it('拉到一半被卸载时按落定收，够得着目标就连上', async () => {
    const stand = mountPreview()
    await pull(stand)
    fire('pointermove', { x: 96, y: 232 })
    await stand.hide()

    expect(stand.connects).toHaveLength(1)
    expect(stand.counts.done).toBe(1)
  })

  it('卸载之后 window 上再动指针一声不响', async () => {
    const stand = mountPreview()
    await pull(stand)
    fire('pointermove', { x: 96, y: 232 })
    await stand.hide()
    fire('pointermove', { x: 300, y: 300 })
    fire('pointerup', { x: 300, y: 300 })

    expect(stand.connects).toHaveLength(1)
    expect(stand.counts.done).toBe(1)
  })
})
