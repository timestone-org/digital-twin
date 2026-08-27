/**
 * @fileoverview 契约：框选。判定是**包围盒相交**不是完全包含、一次只出一类、
 * 框选期间不动选中态（松手才落），点空白算清选中。
 *
 * ⚠ 要求完全包含不会报错，只是「框住一条横穿画面的长连线」得把整屏都拖进去，
 * 而用户想的只是圈这一片。
 * ⚠ 横平竖直的连线与辅助线包围盒有一边是 0，严格判相交时它们永远框不中——同样零报错。
 */
import { normalizeCanvas } from '@dt/twin2d'
import type { Pt } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'

import CanvasMarquee from '@/pages/Twin2dEditor/components/CanvasMarquee.vue'
import type { Twin2dPickKind } from '@/pages/Twin2dEditor/scripts/editorSelection'
import { useCanvasPointer } from '@/pages/Twin2dEditor/scripts/useCanvasPointer'
import type {
  Twin2dCanvasPointer,
  Twin2dGestureSpec,
} from '@/pages/Twin2dEditor/scripts/useCanvasPointer'
import type { Twin2dClientPoint } from '@/pages/Twin2dEditor/scripts/viewportOps'

/** 画布：800 × 600。 */
const CANVAS = normalizeCanvas({ width: 800, height: 600 })

/** 一批候选：两个节点、一条零高的直连线、一个铺得很大的辅助框。 */
const TARGETS = [
  { kind: 'nodes', id: 'n1', box: { x: 100, y: 100, w: 80, h: 60 } },
  { kind: 'nodes', id: 'n2', box: { x: 400, y: 400, w: 80, h: 60 } },
  { kind: 'edges', id: 'e1', box: { x: 90, y: 300, w: 600, h: 0 } },
  { kind: 'marks', id: 'm1', box: { x: 120, y: 120, w: 400, h: 300 } },
] as const

/** 上抛的选中，按发生顺序记下来。 */
interface Recorder {
  picks: { kind: Twin2dPickKind; ids: readonly string[]; additive: boolean }[]
  clears: number
  dones: number
}

/** 画布宿主持有的那台手势状态机。 */
interface Bus {
  wrapper: ReturnType<typeof mount>
  start: (spec: Twin2dGestureSpec) => boolean
}

let rec: Recorder
let bus: Bus

/** 测试里视口不缩不移，client 坐标直接当设计坐标用。 */
function identity(at: Twin2dClientPoint): Pt {
  return { x: at.clientX, y: at.clientY }
}

function mountBus(): Bus {
  const holder = shallowRef<Twin2dCanvasPointer | null>(null)
  const host = defineComponent({
    setup() {
      holder.value = useCanvasPointer({ toDesign: identity })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  const pointer = holder.value
  if (pointer === null) throw new Error('指针总线没装上')
  return { wrapper, start: pointer.start }
}

beforeEach(() => {
  rec = { picks: [], clears: 0, dones: 0 }
  bus = mountBus()
})

function mountMarquee() {
  return mount(CanvasMarquee, {
    props: {
      canvas: CANVAS,
      targets: [...TARGETS],
      source: null,
      startGesture: bus.start,
      onPick: (
        kind: Twin2dPickKind,
        ids: readonly string[],
        additive: boolean,
      ) => {
        rec.picks.push({ kind, ids, additive })
      },
      onClear: () => {
        rec.clears += 1
      },
      onDone: () => {
        rec.dones += 1
      },
    },
  })
}

function down(x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent('pointerdown', { clientX: x, clientY: y, ...init })
}

function fire(
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  init: PointerEventInit = {},
): void {
  window.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, ...init }),
  )
}

/** 画布背景那一按递进来，框选随即起手。 */
async function begin(
  wrapper: ReturnType<typeof mountMarquee>,
  at: readonly [number, number],
  init: PointerEventInit = {},
): Promise<void> {
  await wrapper.setProps({ source: down(at[0], at[1], init) })
}

/** 拖一个框：起手、走一帧、松手。 */
async function dragBox(
  wrapper: ReturnType<typeof mountMarquee>,
  from: readonly [number, number],
  to: readonly [number, number],
  init: PointerEventInit = {},
): Promise<void> {
  await begin(wrapper, from, init)
  fire('pointermove', to[0], to[1], init)
  fire('pointerup', to[0], to[1], init)
}

describe('包围盒相交', () => {
  it('框到一角就算框中，不必整条都框进去', async () => {
    const wrapper = mountMarquee()

    await dragBox(wrapper, [500, 410], [560, 470])

    expect(rec.picks).toEqual([{ kind: 'marks', ids: ['m1'], additive: false }])
    wrapper.unmount()
  })

  it('横平竖直那条零高的连线照样框得中', async () => {
    const wrapper = mountMarquee()

    await dragBox(wrapper, [200, 290], [260, 310])

    expect(rec.picks[0]).toMatchObject({ kind: 'edges', ids: ['e1'] })
    wrapper.unmount()
  })

  it('框里一个都没有时按清选中算', async () => {
    const wrapper = mountMarquee()

    await dragBox(wrapper, [700, 500], [760, 560])

    expect(rec.picks).toEqual([])
    expect(rec.clears).toBe(1)
    wrapper.unmount()
  })
})

describe('一次只出一类', () => {
  it('同时框到几类时节点最优先', async () => {
    const wrapper = mountMarquee()

    await dragBox(wrapper, [50, 50], [200, 200])

    expect(rec.picks).toEqual([{ kind: 'nodes', ids: ['n1'], additive: false }])
    wrapper.unmount()
  })

  it('没有节点也没有连线时才轮到标注', async () => {
    const wrapper = mountMarquee()

    await dragBox(wrapper, [300, 330], [360, 380])

    expect(rec.picks).toEqual([{ kind: 'marks', ids: ['m1'], additive: false }])
    wrapper.unmount()
  })

  it('框到一批同类时一次全给', async () => {
    const wrapper = mountMarquee()

    await dragBox(wrapper, [50, 50], [700, 550])

    expect(rec.picks[0]).toMatchObject({ kind: 'nodes', ids: ['n1', 'n2'] })
    wrapper.unmount()
  })
})

describe('松手才落选中态', () => {
  it('拖框的每一帧都不上抛', async () => {
    const wrapper = mountMarquee()

    await begin(wrapper, [50, 50])
    for (let step = 1; step <= 20; step += 1) {
      fire('pointermove', 50 + step * 5, 50 + step * 5)
    }

    expect(rec.picks).toEqual([])
    expect(rec.clears).toBe(0)

    fire('pointerup', 200, 200)

    expect(rec.picks).toHaveLength(1)
    wrapper.unmount()
  })

  it('收场时交代一次，调用方借它把起手清空', async () => {
    const wrapper = mountMarquee()

    await dragBox(wrapper, [50, 50], [200, 200])

    expect(rec.dones).toBe(1)
    wrapper.unmount()
  })

  it('同一个起手事件不重复起手', async () => {
    const wrapper = mountMarquee()
    const at = down(50, 50)

    await wrapper.setProps({ source: at })
    await wrapper.setProps({ source: null })
    await wrapper.setProps({ source: at })
    fire('pointerup', 50, 50)

    expect(rec.dones).toBe(1)
    wrapper.unmount()
  })

  it('点一下空白就是清选中', async () => {
    const wrapper = mountMarquee()

    await begin(wrapper, [50, 50])
    fire('pointerup', 50, 50)

    expect(rec.clears).toBe(1)
    expect(rec.picks).toEqual([])
    wrapper.unmount()
  })

  it('加选时点空白不清选中', async () => {
    const wrapper = mountMarquee()

    await begin(wrapper, [50, 50], { ctrlKey: true })
    fire('pointerup', 50, 50, { ctrlKey: true })

    expect(rec.clears).toBe(0)
    wrapper.unmount()
  })

  it('加选原样传给上层', async () => {
    const wrapper = mountMarquee()

    await dragBox(wrapper, [50, 50], [200, 200], { metaKey: true })

    expect(rec.picks[0]).toMatchObject({ additive: true })
    wrapper.unmount()
  })

  it('系统抢走指针时整框作废', async () => {
    const wrapper = mountMarquee()

    await begin(wrapper, [50, 50])
    fire('pointermove', 200, 200)
    fire('pointercancel', 200, 200)

    expect(rec.picks).toEqual([])
    expect(rec.clears).toBe(0)
    wrapper.unmount()
  })

  it('拖到一半画布宿主走了，那一框照样落', async () => {
    const wrapper = mountMarquee()

    await begin(wrapper, [50, 50])
    fire('pointermove', 200, 200)
    bus.wrapper.unmount()

    expect(rec.picks).toEqual([{ kind: 'nodes', ids: ['n1'], additive: false }])
    wrapper.unmount()
  })

  it('宿主走时的空框不清选中', async () => {
    const wrapper = mountMarquee()

    await begin(wrapper, [50, 50])
    bus.wrapper.unmount()

    expect(rec.clears).toBe(0)
    wrapper.unmount()
  })
})

describe('框本身', () => {
  it('往左上拖也画得出，落的是两点的外接盒', async () => {
    const wrapper = mountMarquee()

    await begin(wrapper, [300, 300])
    fire('pointermove', 220, 240)
    await wrapper.vm.$nextTick()
    const box = wrapper.find('[data-test="marquee-box"]')

    expect([
      box.attributes('x'),
      box.attributes('y'),
      box.attributes('width'),
      box.attributes('height'),
    ]).toEqual(['220', '240', '80', '60'])

    fire('pointerup', 220, 240)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-test="marquee-box"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('没越过起手阈值就不画框', async () => {
    const wrapper = mountMarquee()

    await begin(wrapper, [300, 300])
    fire('pointermove', 302, 301)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-test="marquee-box"]').exists()).toBe(false)
    fire('pointerup', 302, 301)
    wrapper.unmount()
  })
})
