/**
 * @fileoverview 契约：编辑器的标注层。四件事各锁一遍——按 `zOrder` 分两层且层序与
 * 运行态舞台逐层对上；一次手势只在收场那一下上抛一次改动；拖到一半被卸载要补上这
 * 一次；手势期间一个字都不写回文档。
 *
 * ⚠ 分层错了不报错：配 `below` 的标注在编辑器里看着在上面、上了大屏跑到下面，
 * 所见即所得在这一项上是假的。
 * ⚠ 逐帧上抛同样不报错，只是拖一条标注就往撤销栈里塞进几百格，撤销键从此按不回
 * 上一步。
 * ⚠ 卸载不补那一次也不报错：拖到一半切走的改动既没进撤销栈也没落库。
 */
import {
  Twin2dMarkShape,
  Twin2dStage,
  normalizeCanvas,
  normalizeMark,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Pt, Twin2dMark } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CanvasMarkLayer from '@/pages/Twin2dEditor/components/CanvasMarkLayer.vue'
import { TWIN_2D_DEFAULT_SNAP } from '@/pages/Twin2dEditor/scripts/snapping'
import type {
  Twin2dGuideLine,
  Twin2dSnapBox,
} from '@/pages/Twin2dEditor/scripts/snapping'
import { useCanvasPointer } from '@/pages/Twin2dEditor/scripts/useCanvasPointer'
import type {
  Twin2dCanvasPointer,
  Twin2dGestureSpec,
} from '@/pages/Twin2dEditor/scripts/useCanvasPointer'
import type { Twin2dClientPoint } from '@/pages/Twin2dEditor/scripts/viewportOps'

/** 画布：800 × 600，栅格 20。 */
const CANVAS = normalizeCanvas({ width: 800, height: 600 })

/** 造一条归一化过的标注。 */
function markOf(raw: Record<string, unknown>): Twin2dMark {
  const mark = normalizeMark(raw)
  if (mark === null) throw new Error('标注造不出来')
  return mark
}

/** 两条在下层的辅助框，一条在上层的辅助线。 */
function fixtureMarks(): readonly Twin2dMark[] {
  return [
    markOf({ id: 'a', kind: 'rect', x: 100, y: 100, w: 200, h: 100 }),
    markOf({ id: 'b', kind: 'rect', x: 400, y: 100, w: 100, h: 100 }),
    markOf({
      id: 'c',
      kind: 'line',
      x: 100,
      y: 400,
      x2: 300,
      y2: 400,
      zOrder: 'above',
    }),
  ]
}

/** 上抛的改动、选中与参考线，按发生顺序记下来。 */
interface Recorder {
  changes: (readonly Twin2dMark[])[]
  picks: { id: string; additive: boolean }[]
  guides: (readonly Twin2dGuideLine[])[]
}

/** 画布宿主持有的那台手势状态机，各层共用同一台。 */
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

/** 装一台指针总线；卸载它就等于画布宿主走了。 */
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
  rec = { changes: [], picks: [], guides: [] }
  bus = mountBus()
})

/** 这一层挂起来要交代的那几样；`layer` 与 `selectedIds` 逐例换。 */
function mountLayer(patch: Record<string, unknown> = {}) {
  return mount(CanvasMarkLayer, {
    props: {
      canvas: CANVAS,
      marks: fixtureMarks(),
      layer: 'below',
      selectedIds: [],
      snap: { ...TWIN_2D_DEFAULT_SNAP },
      scale: 1,
      startGesture: bus.start,
      editable: true,
      onChange: (next: readonly Twin2dMark[]) => {
        rec.changes.push(next)
      },
      onPick: (id: string, additive: boolean) => {
        rec.picks.push({ id, additive })
      },
      onGuides: (lines: readonly Twin2dGuideLine[]) => {
        rec.guides.push(lines)
      },
      ...patch,
    },
  })
}

/** 一次 `pointerdown`。 */
function down(x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent('pointerdown', { clientX: x, clientY: y, ...init })
}

/** window 上的后续帧：指针早拖到画布外去了，监听本来就挂在那里。 */
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

/** 抓住一条标注：命中面上落一次 `pointerdown`。 */
function grab(
  wrapper: ReturnType<typeof mountLayer>,
  id: string,
  at: PointerEvent,
): void {
  wrapper
    .find(`[data-test="mark-hit"][data-id="${id}"]`)
    .element.dispatchEvent(at)
}

/** 从最后一次上抛里取某一条。 */
function lastMark(id: string): Twin2dMark {
  const next = rec.changes.at(-1)
  const mark = next?.find((item) => item.id === id)
  if (mark === undefined) throw new Error('没有上抛这一条')
  return mark
}

describe('按 zOrder 分两层', () => {
  it('一层只画自己那一档', () => {
    const below = mountLayer()
    const above = mountLayer({ layer: 'above' })

    const idsOf = (wrapper: ReturnType<typeof mountLayer>) =>
      wrapper.findAll('[data-test="mark"]').map((m) => m.attributes('data-id'))

    expect(idsOf(below)).toEqual(['a', 'b'])
    expect(idsOf(above)).toEqual(['c'])
    below.unmount()
    above.unmount()
  })

  // ⚠ 两边各按自己那套分的话，配 below 的标注在编辑器里看着在上面、上了大屏跑到
  // 下面，而两边单看都对——所以两边分出来的必须逐条相等
  it('两层分出来的与运行态舞台那两层逐条相同', () => {
    const config = normalizeTwin2dConfig({
      canvas: { width: 800, height: 600 },
      marks: fixtureMarks(),
    })
    const stage = mount(Twin2dStage, {
      props: {
        canvas: config.canvas,
        nodes: config.nodes,
        edges: config.edges,
        marks: config.marks,
        nodeStyles: [],
        edgeStyles: [],
        containerSize: { w: 800, h: 600 },
      },
    })
    // ⚠ 先落到一个有类型的根上：`.vue` 的模块在 typescript-eslint 眼里是 any，
    // 直接在 `wrapper.element` 上查 DOM 会整串判成不安全调用
    const root: Element = stage.element
    const stageIds = (layer: string) =>
      [
        ...root.querySelectorAll(`[data-layer="${layer}"] [data-test="mark"]`),
      ].map((el) => el.getAttribute('data-id'))
    const editorIds = (wrapper: ReturnType<typeof mountLayer>) =>
      wrapper.findAll('[data-test="mark"]').map((m) => m.attributes('data-id'))
    const below = mountLayer()
    const above = mountLayer({ layer: 'above' })

    expect(editorIds(below)).toEqual(stageIds('marks-below'))
    expect(editorIds(above)).toEqual(stageIds('marks-above'))
    below.unmount()
    above.unmount()
    stage.unmount()
  })

  // ⚠ 形状件两边各一份的话，同一条标注在编辑器与大屏上会长得不一样，而两边单看都对
  it('形状件与运行态是同一个组件，编辑器不另留一份', () => {
    const wrapper = mountLayer()
    const shape = wrapper.getComponent(Twin2dMarkShape)

    expect(shape.props('mark')).toMatchObject({ id: 'a' })
    wrapper.unmount()
  })

  it('只读时不出命中面也不出把手', () => {
    const wrapper = mountLayer({ editable: false, selectedIds: ['a'] })

    expect(wrapper.findAll('[data-test="mark-hit"]')).toHaveLength(0)
    expect(wrapper.find('[data-test="mark-handles"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('一手势一步撤销', () => {
  it('拖过几十帧也只在松手那一下上抛一次', () => {
    const wrapper = mountLayer()

    grab(wrapper, 'a', down(150, 150))
    for (let step = 1; step <= 50; step += 1) {
      fire('pointermove', 150 + step, 150 + step)
    }

    expect(rec.changes).toHaveLength(0)

    fire('pointerup', 200, 200)

    expect(rec.changes).toHaveLength(1)
    wrapper.unmount()
  })

  it('点一下不拖不上抛任何改动', () => {
    const wrapper = mountLayer()

    grab(wrapper, 'a', down(150, 150))
    fire('pointerup', 150, 150)

    expect(rec.changes).toHaveLength(0)
    expect(rec.picks).toEqual([{ id: 'a', additive: false }])
    wrapper.unmount()
  })

  it('系统抢走指针时整段作废', () => {
    const wrapper = mountLayer()

    grab(wrapper, 'a', down(150, 150))
    fire('pointermove', 180, 170)
    fire('pointercancel', 180, 170)

    expect(rec.changes).toHaveLength(0)
    wrapper.unmount()
  })

  it('拖到一半画布宿主走了也补上那一次', () => {
    const wrapper = mountLayer()

    grab(wrapper, 'a', down(150, 150))
    fire('pointermove', 180, 170)
    bus.wrapper.unmount()

    expect(rec.changes).toHaveLength(1)
    expect(lastMark('a')).toMatchObject({ x: 140, y: 120 })
    wrapper.unmount()
  })

  it('宿主走了之后 window 上再动指针一声不响', () => {
    const wrapper = mountLayer()

    grab(wrapper, 'a', down(150, 150))
    bus.wrapper.unmount()
    fire('pointermove', 400, 400)
    fire('pointerup', 400, 400)

    expect(rec.changes).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('拖动', () => {
  it('松手落在网格上，整份标注一起交出去', async () => {
    const wrapper = mountLayer()

    grab(wrapper, 'a', down(150, 150))
    fire('pointermove', 180, 170)
    await nextTick()

    expect(wrapper.find('[data-id="a"]').exists()).toBe(true)

    fire('pointerup', 180, 170)

    expect(rec.changes[0]).toHaveLength(3)
    expect(lastMark('a')).toMatchObject({ x: 140, y: 120 })
    expect(lastMark('b')).toMatchObject({ x: 400, y: 100 })
    wrapper.unmount()
  })

  it('关掉吸附之后一个像素都不吸', () => {
    const wrapper = mountLayer({
      snap: { ...TWIN_2D_DEFAULT_SNAP, enabled: false },
    })

    grab(wrapper, 'a', down(150, 150))
    fire('pointermove', 183, 167)
    fire('pointerup', 183, 167)

    expect(lastMark('a')).toMatchObject({ x: 133, y: 117 })
    wrapper.unmount()
  })

  it('按住 Alt 这一帧一点都不吸', () => {
    const wrapper = mountLayer()

    grab(wrapper, 'a', down(150, 150))
    fire('pointermove', 180, 170, { altKey: true })
    fire('pointerup', 180, 170, { altKey: true })

    expect(lastMark('a')).toMatchObject({ x: 130, y: 120 })
    wrapper.unmount()
  })

  it('多选时整批同走一个偏移，不各吸各的', () => {
    const wrapper = mountLayer({ selectedIds: ['a', 'b'] })

    grab(wrapper, 'a', down(150, 150))
    fire('pointermove', 180, 170)
    fire('pointerup', 180, 170)

    expect(lastMark('a')).toMatchObject({ x: 140, y: 120 })
    expect(lastMark('b')).toMatchObject({ x: 440, y: 120 })
    wrapper.unmount()
  })

  it('辅助线整条走，两个端点一起挪', () => {
    const wrapper = mountLayer({ layer: 'above' })

    grab(wrapper, 'c', down(200, 400))
    fire('pointermove', 240, 460)
    fire('pointerup', 240, 460)

    expect(lastMark('c')).toMatchObject({ x: 140, y: 460, x2: 340, y2: 460 })
    wrapper.unmount()
  })

  it('吸住层外的盒时交出参考线，松手即收', () => {
    const peers: readonly Twin2dSnapBox[] = [{ x: 500, y: 300, w: 100, h: 100 }]
    const wrapper = mountLayer({ peers })

    grab(wrapper, 'a', down(150, 150))
    fire('pointermove', 548, 150)

    expect(rec.guides.at(-1)).toEqual([
      { axis: 'x', at: 500 },
      { axis: 'y', at: 100 },
    ])

    fire('pointerup', 548, 150)

    expect(rec.guides.at(-1)).toEqual([])
    expect(lastMark('a')).toMatchObject({ x: 500 })
    wrapper.unmount()
  })
})

describe('选中', () => {
  it('抓住没选中的那一条时交代一次选中', () => {
    const wrapper = mountLayer()

    grab(wrapper, 'b', down(450, 150))
    fire('pointerup', 450, 150)

    expect(rec.picks).toEqual([{ id: 'b', additive: false }])
    wrapper.unmount()
  })

  it('抓住已经选中的那一条时不再交代，整批才拖得走', () => {
    const wrapper = mountLayer({ selectedIds: ['a', 'b'] })

    grab(wrapper, 'a', down(150, 150))
    fire('pointerup', 150, 150)

    expect(rec.picks).toEqual([])
    wrapper.unmount()
  })

  it('按住 Ctrl 点只切换去留，不起拖动', () => {
    const wrapper = mountLayer({ selectedIds: ['a'] })

    grab(wrapper, 'a', down(150, 150, { ctrlKey: true }))
    fire('pointermove', 180, 170)
    fire('pointerup', 180, 170)

    expect(rec.picks).toEqual([{ id: 'a', additive: true }])
    expect(rec.changes).toHaveLength(0)
    wrapper.unmount()
  })

  it('⌘ 与 Ctrl 同档', () => {
    const wrapper = mountLayer()

    grab(wrapper, 'a', down(150, 150, { metaKey: true }))
    fire('pointerup', 150, 150)

    expect(rec.picks).toEqual([{ id: 'a', additive: true }])
    wrapper.unmount()
  })

  it('把手只在单选时出，且只出在它自己那一层', () => {
    const single = mountLayer({ selectedIds: ['a'] })
    const many = mountLayer({ selectedIds: ['a', 'b'] })
    const other = mountLayer({ selectedIds: ['c'] })

    expect(single.find('[data-test="mark-handles"]').exists()).toBe(true)
    expect(many.find('[data-test="mark-handles"]').exists()).toBe(false)
    expect(other.find('[data-test="mark-handles"]').exists()).toBe(false)
    single.unmount()
    many.unmount()
    other.unmount()
  })
})

describe('八向缩放', () => {
  it('拖右下角只动宽高，左上角钉住', () => {
    const wrapper = mountLayer({ selectedIds: ['a'] })

    wrapper.find('[data-dir="1,1"]').element.dispatchEvent(down(300, 200))
    fire('pointermove', 337, 212)
    fire('pointerup', 337, 212)

    expect(lastMark('a')).toMatchObject({ x: 100, y: 100, w: 240, h: 120 })
    wrapper.unmount()
  })

  it('拖左上角同时挪起点与尺寸，右下角钉住', () => {
    const wrapper = mountLayer({ selectedIds: ['a'] })

    wrapper.find('[data-dir="-1,-1"]').element.dispatchEvent(down(100, 100))
    fire('pointermove', 67, 92)
    fire('pointerup', 67, 92)

    expect(lastMark('a')).toMatchObject({ x: 60, y: 100, w: 240, h: 100 })
    wrapper.unmount()
  })

  it('拖边上那一枚只动一条轴', () => {
    const wrapper = mountLayer({ selectedIds: ['a'] })

    wrapper.find('[data-dir="1,0"]').element.dispatchEvent(down(300, 150))
    fire('pointermove', 341, 260)
    fire('pointerup', 341, 260)

    expect(lastMark('a')).toMatchObject({ x: 100, y: 100, w: 240, h: 100 })
    wrapper.unmount()
  })

  it('关掉吸附时缩放也一个像素都不吸', () => {
    const wrapper = mountLayer({
      selectedIds: ['a'],
      snap: { ...TWIN_2D_DEFAULT_SNAP, enabled: false },
    })

    wrapper.find('[data-dir="1,1"]').element.dispatchEvent(down(300, 200))
    fire('pointermove', 307, 203)
    fire('pointerup', 307, 203)

    expect(lastMark('a')).toMatchObject({ w: 207, h: 103 })
    wrapper.unmount()
  })

  it('缩到反过去时被最小边长挡住，不翻面', () => {
    const wrapper = mountLayer({ selectedIds: ['a'] })

    wrapper.find('[data-dir="1,1"]').element.dispatchEvent(down(300, 200))
    fire('pointermove', -700, -700)
    fire('pointerup', -700, -700)

    expect(lastMark('a')).toMatchObject({ x: 100, y: 100, w: 8, h: 8 })
    wrapper.unmount()
  })
})

describe('端点', () => {
  it('拖终点只改那一端，起点不动', () => {
    const wrapper = mountLayer({ layer: 'above', selectedIds: ['c'] })
    const second = wrapper.findAll('[data-test="mark-endpoint"]')[1]

    second?.element.dispatchEvent(down(300, 400))
    fire('pointermove', 317, 404)
    fire('pointerup', 317, 404)

    expect(lastMark('c')).toMatchObject({ x: 100, y: 400, x2: 320, y2: 400 })
    wrapper.unmount()
  })

  it('端点跟着落点走，抓偏了也不会一路累计', () => {
    const wrapper = mountLayer({ layer: 'above', selectedIds: ['c'] })
    const first = wrapper.findAll('[data-test="mark-endpoint"]')[0]

    first?.element.dispatchEvent(down(104, 398))
    fire('pointermove', 141, 359)
    fire('pointerup', 141, 359)

    expect(lastMark('c')).toMatchObject({ x: 140, y: 360 })
    wrapper.unmount()
  })
})
