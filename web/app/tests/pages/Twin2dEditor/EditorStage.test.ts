/**
 * @fileoverview 契约：画布装配。层序与运行态 `Twin2dStage` 逐层对齐、sprite 宿主只挂
 * 一次、一次手势只落一步撤销（拖到一半卸载也补上那一次），命中与框选都落到同一条选中轴，
 * 从调色板拖下来的那一手落成一个吸在网格上、接着被选中的新节点。
 *
 * ⚠ 层序错了不会报错：配了 `below` 的标注在编辑器里看着在上面、上了大屏跑到下面。
 * ⚠ 逐帧落库同样不报错，只是撤销键从此按不回上一步——拖一个节点就塞进几百帧。
 * ⚠ 漏挂 sprite 时图标**静默消失**：`<use>` 元素照样在，只是解析不到任何目标。
 */
import {
  Twin2dIconSprite,
  Twin2dStage,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import EditorStage from '@/pages/Twin2dEditor/components/EditorStage.vue'
import { createTwin2dSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'
import type { Twin2dEditorSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'
import { TWIN_2D_STYLE_DRAG_MIME } from '@/pages/Twin2dEditor/scripts/paletteDrag'
import { createTwin2dDoc } from '@/pages/Twin2dEditor/scripts/twin2dDoc'
import type { Twin2dDoc } from '@/pages/Twin2dEditor/scripts/twin2dDoc'

/** 两个端口的方块：左右各一枚，拉线要从看得见的端口点起手。 */
const STYLE = {
  id: 's1',
  name: '方块',
  size: { w: 40, h: 20 },
  ports: [
    { id: 'a', name: 'A', at: { kind: 'xy', x: 0, y: 0.5 }, side: 'left' },
    { id: 'b', name: 'B', at: { kind: 'xy', x: 1, y: 0.5 }, side: 'right' },
  ],
}

/**
 * 两个节点、两条连线、上下各一条标注。
 * ⚠ 两个节点摆得远远的：挨着的话吸附会把拖动的落点牵到隔壁那条边线上。
 * ⚠ 连线故意给两条：只有一条时「换掉这一条、其余原样」的另一支永远走不到，
 * 而那一支正是「改一条把别的也改了」会现形的地方。
 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 20, showGrid: true },
  styles: [STYLE],
  nodes: [
    { id: 'n1', styleId: 's1', x: 100, y: 100, w: 40, h: 20 },
    { id: 'n2', styleId: 's1', x: 300, y: 100, w: 40, h: 20 },
  ],
  edges: [
    {
      id: 'e1',
      styleId: 'waste-heat',
      from: { nodeId: 'n1', portId: 'b' },
      to: { nodeId: 'n2', portId: 'a' },
    },
    {
      id: 'e2',
      styleId: 'steam',
      from: { nodeId: 'n2', portId: 'b' },
      to: { nodeId: 'n1', portId: 'a' },
    },
  ],
  marks: [
    { id: 'm1', kind: 'rect', x: 40, y: 400, w: 60, h: 40, zOrder: 'below' },
    { id: 'm2', kind: 'rect', x: 240, y: 400, w: 60, h: 40, zOrder: 'above' },
  ],
})

/** 事件自带的时间戳往前挪这么多，稳稳晚于任何一个处理器挂上的那一刻。 */
const STAMP_AHEAD_MS = 1000

interface Harness {
  wrapper: VueWrapper
  doc: Twin2dDoc
  selection: Twin2dEditorSelection
  /** 上抛了几次整份新配置；一次手势该只有一次。 */
  changes: () => number
}

/**
 * 把装配层挂进一份真的文档态：撤销栈是不是只加一格，这里才看得出来。
 * @param config 这一份图；不给就用上面那份
 */
function mountStage(config: Twin2dConfig = CONFIG): Harness {
  const doc = createTwin2dDoc({ config, bindings: [] })
  const selection = createTwin2dSelection()
  let seen = 0
  const host = defineComponent({
    setup() {
      return () =>
        h(EditorStage, {
          config: doc.config.value,
          selection,
          onChange: (next: Twin2dConfig) => {
            seen += 1
            doc.commit(next)
          },
        })
    },
  })
  const wrapper: VueWrapper = mount(host)
  return { wrapper, doc, selection, changes: () => seen }
}

/**
 * 两边的层名折成同一套词，好逐项比对。
 * ⚠ 比的是「编辑器这一串」与「运行态那一串」，不是各自与一份手抄的字面量：手抄的话
 * 两边一起改也照样绿，而那正是所见即所得漂掉的样子。
 */
const LAYER_ROLES: Readonly<Record<string, string>> = {
  'mark-layer:below': '下层标注',
  'edge-layer': '连线',
  'node-layer': '节点',
  'mark-layer:above': '上层标注',
  'marks-below': '下层标注',
  edges: '连线',
  nodes: '节点',
  'marks-above': '上层标注',
}

/** 编辑画布这一串。 */
function editorRoles(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[data-test="canvas-stage"] > *')
    .map((item) => {
      const layer = item.attributes('data-layer')
      const test = item.attributes('data-test') ?? ''
      return layer === undefined ? test : `${test}:${layer}`
    })
    .flatMap((key) => (key in LAYER_ROLES ? [LAYER_ROLES[key] ?? ''] : []))
}

/** 运行态舞台那一串。 */
function runtimeRoles(): string[] {
  const stage = mount(Twin2dStage, {
    props: {
      canvas: CONFIG.canvas,
      nodes: CONFIG.nodes,
      edges: CONFIG.edges,
      marks: CONFIG.marks,
      nodeStyles: CONFIG.styles,
      edgeStyles: CONFIG.edgeStyles,
      containerSize: { w: 800, h: 600 },
    },
  })
  const root: Element = stage.element
  const roles = [...root.querySelectorAll('[data-layer]')].flatMap((el) => {
    const key = el.getAttribute('data-layer') ?? ''
    return key in LAYER_ROLES ? [LAYER_ROLES[key] ?? ''] : []
  })
  stage.unmount()
  return roles
}

/** 舞台里各层的绘制序：DOM 序即层序。 */
function layerOrder(wrapper: VueWrapper): (string | undefined)[] {
  return wrapper
    .findAll('[data-test="canvas-stage"] > *')
    .map((item) => item.attributes('data-test'))
}

function nodeAt(wrapper: VueWrapper, id: string): Element {
  return wrapper.get(`[data-test="node"][data-id="${id}"]`).element
}

function portAt(wrapper: VueWrapper, nodeId: string, portId: string): Element {
  return wrapper.get(
    `[data-test="node-port"][data-node="${nodeId}"][data-id="${portId}"]`,
  ).element
}

/**
 * 一次按下。
 * ⚠ 事件必须自带一个够新的 `_vts`：画布壳在**捕获相**接了同一次按下，而 Vue 的处理器
 * 按 `_vts` 丢掉「不晚于自己挂上那一毫秒」的事件——捕获相那一下先给事件盖了戳，于是
 * 同一毫秒里刚渲染出来的节点与端口点会**静默**收不到这一按。表现是用例随机红、换个
 * 用例顺序又绿，而被测代码一个字都没错。
 * @param x 屏幕横坐标
 * @param y 屏幕纵坐标
 * @param init 修饰键一类
 */
function pointerDown(
  x: number,
  y: number,
  init: PointerEventInit,
): PointerEvent {
  const event = new PointerEvent('pointerdown', {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    ...init,
  })
  return Object.assign(event, { _vts: Date.now() + STAMP_AHEAD_MS })
}

/**
 * 按在一个元素上。
 * @param el 按在哪个元素上
 * @param x 屏幕横坐标
 * @param y 屏幕纵坐标
 * @param init 修饰键一类
 */
async function press(
  el: Element,
  x: number,
  y: number,
  init: PointerEventInit = {},
): Promise<void> {
  el.dispatchEvent(pointerDown(x, y, init))
  await nextTick()
}

function fire(
  type: 'pointermove' | 'pointerup',
  x: number,
  y: number,
  init: PointerEventInit = {},
): void {
  window.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, ...init }),
  )
}

/** 命中面上的一块：标注与连线都靠它接指针。 */
function hitAt(wrapper: VueWrapper, test: string, id: string): Element {
  return wrapper.get(`[data-test="${test}"][data-id="${id}"]`).element
}

/** 选中那条连线「终点」那一端的把手。 */
function endHandle(wrapper: VueWrapper): Element {
  return wrapper.get('[data-test="edge-end-handle"][data-id="to"]').element
}

/** 起手 → 走 `steps` 帧 → 松手。 */
async function dragBy(
  el: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
): Promise<void> {
  await press(el, from.x, from.y)
  for (let step = 1; step <= steps; step += 1) {
    const k = step / steps
    fire(
      'pointermove',
      from.x + (to.x - from.x) * k,
      from.y + (to.y - from.y) * k,
    )
  }
  fire('pointerup', to.x, to.y)
  await nextTick()
}

/**
 * 从调色板拖一份样式到画布上松手。
 * ⚠ 不走 `trigger`：VTU 造的是真的 `DragEvent`，而 `dataTransfer` 是它原型上的只读
 * 取值器，赋值在严格模式下直接抛。
 * ⚠ 视口是单位视口（装配层不给容器尺寸，happy-dom 量出来是 0×0），所以窗口坐标
 * 就是设计坐标。
 * @param wrapper 挂好的装配层
 * @param styleId 拖的是哪份样式
 * @param at 松手那一点
 */
function drop(
  wrapper: VueWrapper,
  styleId: string,
  at: { x: number; y: number },
): void {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: [TWIN_2D_STYLE_DRAG_MIME],
      dropEffect: 'none',
      getData: (key: string) =>
        key === TWIN_2D_STYLE_DRAG_MIME ? styleId : '',
    },
  })
  Object.defineProperty(event, 'clientX', { value: at.x })
  Object.defineProperty(event, 'clientY', { value: at.y })
  const host: Element = wrapper.get('[data-test="canvas-host"]').element
  host.dispatchEvent(event)
}

/** 这条连线这一刻画成什么样；命中带与可见线同一份几何，取其一即可。 */
function edgePath(wrapper: VueWrapper, id: string): string {
  return (
    wrapper.get(`[data-test="edge-hit"][data-id="${id}"]`).attributes('d') ?? ''
  )
}

/** 这条标注现在在哪。 */
function markX(doc: Twin2dDoc, id: string): number {
  return doc.config.value.marks.find((mark) => mark.id === id)?.x ?? Number.NaN
}

/** 这个节点现在在哪。 */
function xOf(doc: Twin2dDoc, id: string): number {
  return doc.config.value.nodes.find((node) => node.id === id)?.x ?? Number.NaN
}

describe('层序', () => {
  it('底下的标注、连线、节点、上面的标注按这个次序排', () => {
    const { wrapper } = mountStage()

    expect(layerOrder(wrapper)).toEqual([
      'mark-layer',
      'edge-layer',
      'node-layer',
      'mark-layer',
      'marquee',
    ])
  })

  it('两层标注各画各那一档', () => {
    const { wrapper } = mountStage()

    const layers = wrapper
      .findAll('[data-test="mark-layer"]')
      .map((item) => item.attributes('data-layer'))

    expect(layers).toEqual(['below', 'above'])
  })

  // ⚠ 编辑器另排一套的话，配 below 的标注在这里看着在上面、上了大屏跑到下面，
  // 而两边单看都对
  it('四层的先后与运行态舞台逐项相同', () => {
    const { wrapper } = mountStage()

    expect(editorRoles(wrapper)).toEqual(runtimeRoles())
  })

  it('选中一条连线时把手压在两层标注之上', async () => {
    const { wrapper, selection } = mountStage()

    selection.select('edges', 'e1')
    await nextTick()

    expect(layerOrder(wrapper)).toEqual([
      'mark-layer',
      'edge-layer',
      'node-layer',
      'mark-layer',
      'edge-handles',
      'marquee',
    ])
  })
})

describe('sprite 宿主', () => {
  it('画布里挂了一次，且只挂一次', () => {
    const { wrapper } = mountStage()

    expect(wrapper.findAllComponents(Twin2dIconSprite)).toHaveLength(1)
  })
})

describe('一手势一步撤销', () => {
  it('拖一个节点走了很多帧，也只上抛一次整份配置', async () => {
    const { wrapper, doc, changes } = mountStage()

    await dragBy(
      nodeAt(wrapper, 'n1'),
      { x: 110, y: 110 },
      { x: 170, y: 110 },
      6,
    )

    expect(changes()).toBe(1)
    expect(xOf(doc, 'n1')).toBe(160)
  })

  it('撤销一次就回到起手之前，撤销栈上不留第二格', async () => {
    const { wrapper, doc } = mountStage()
    await dragBy(
      nodeAt(wrapper, 'n1'),
      { x: 110, y: 110 },
      { x: 170, y: 110 },
      6,
    )

    doc.undo()

    expect(xOf(doc, 'n1')).toBe(100)
    expect(doc.canUndo.value).toBe(false)
  })

  it('拖到一半被卸载，这一手照样落一次', async () => {
    const { wrapper, doc, changes } = mountStage()
    await press(nodeAt(wrapper, 'n1'), 110, 110)
    fire('pointermove', 170, 110)

    wrapper.unmount()

    expect(changes()).toBe(1)
    expect(xOf(doc, 'n1')).toBe(160)
  })

  it('点一下没挪动，撤销栈上一格都不留', async () => {
    const { wrapper, doc, changes } = mountStage()

    await press(nodeAt(wrapper, 'n1'), 110, 110)
    fire('pointerup', 110, 110)
    await nextTick()

    expect(changes()).toBe(0)
    expect(doc.canUndo.value).toBe(false)
  })
})

describe('选中', () => {
  it('按在一个节点上就选中它', async () => {
    const { wrapper, selection } = mountStage()

    await press(nodeAt(wrapper, 'n1'), 110, 110)
    fire('pointerup', 110, 110)

    expect(selection.idsOf('nodes')).toEqual(['n1'])
  })

  it('按住 ⌘ 再点一个是加选', async () => {
    const { wrapper, selection } = mountStage()
    await press(nodeAt(wrapper, 'n1'), 110, 110)
    fire('pointerup', 110, 110)

    await press(nodeAt(wrapper, 'n2'), 310, 110, { metaKey: true })
    fire('pointerup', 310, 110, { metaKey: true })

    expect(selection.idsOf('nodes')).toEqual(['n1', 'n2'])
  })

  it('在空白处拖一个框，框住的那批一起选中', async () => {
    const { wrapper, selection } = mountStage()

    await press(wrapper.get('[data-test="canvas-host"]').element, 60, 60)
    fire('pointermove', 400, 200)
    fire('pointerup', 400, 200)
    await nextTick()

    expect(selection.idsOf('nodes')).toEqual(['n1', 'n2'])
  })

  // ⚠ 样式悬空的节点在图上根本没有盒（与节点层「整个不画」同口径），框中了就等于
  // 选中了一个看不见的东西，右栏改哪一项都写不回去
  it('样式悬空的节点框不中', async () => {
    const { wrapper, selection } = mountStage(
      normalizeTwin2dConfig({
        canvas: { width: 800, height: 600, grid: 20 },
        styles: [STYLE],
        nodes: [
          { id: 'n1', styleId: 's1', x: 100, y: 100, w: 40, h: 20 },
          { id: 'n9', styleId: 'nope', x: 300, y: 300, w: 40, h: 20 },
        ],
      }),
    )

    await press(wrapper.get('[data-test="canvas-host"]').element, 60, 60)
    fire('pointermove', 700, 500)
    fire('pointerup', 700, 500)
    await nextTick()

    expect(selection.idsOf('nodes')).toEqual(['n1'])
  })

  it('点一下空白就清掉选中', async () => {
    const { wrapper, selection } = mountStage()
    selection.select('nodes', 'n1')

    await press(wrapper.get('[data-test="canvas-host"]').element, 60, 500)
    fire('pointerup', 60, 500)
    await nextTick()

    expect(selection.pick.value).toBeNull()
  })
})

describe('拉一条新连线', () => {
  it('从端口拉到另一个节点上就多出一条', async () => {
    const { wrapper, doc, selection } = mountStage()
    selection.select('nodes', 'n1')
    await nextTick()

    await dragBy(
      portAt(wrapper, 'n1', 'b'),
      { x: 140, y: 110 },
      { x: 320, y: 110 },
      3,
    )

    expect(doc.config.value.edges).toHaveLength(3)
  })

  it('拉到空白处什么都不落', async () => {
    const { wrapper, doc, selection } = mountStage()
    selection.select('nodes', 'n1')
    await nextTick()

    await dragBy(
      portAt(wrapper, 'n1', 'b'),
      { x: 140, y: 110 },
      { x: 600, y: 500 },
      3,
    )

    expect(doc.config.value.edges).toHaveLength(2)
    expect(doc.canUndo.value).toBe(false)
  })
})

describe('标注', () => {
  it('按在一条标注上就选中它', async () => {
    const { wrapper, selection } = mountStage()

    await press(hitAt(wrapper, 'mark-hit', 'm1'), 70, 420)
    fire('pointerup', 70, 420)
    await nextTick()

    expect(selection.idsOf('marks')).toEqual(['m1'])
  })

  it('拖一条标注走了很多帧，也只上抛一次整份配置', async () => {
    const { wrapper, doc, changes } = mountStage()

    await dragBy(
      hitAt(wrapper, 'mark-hit', 'm1'),
      { x: 70, y: 420 },
      { x: 130, y: 420 },
      5,
    )

    expect(changes()).toBe(1)
    expect(markX(doc, 'm1')).toBe(100)
  })
})

describe('连线', () => {
  it('按在一条连线上就选中它', async () => {
    const { wrapper, selection } = mountStage()

    await press(hitAt(wrapper, 'edge-hit', 'e1'), 200, 110)
    fire('pointerup', 200, 110)
    await nextTick()

    expect(selection.idsOf('edges')).toEqual(['e1'])
  })

  it('双击线上一点就插一个拐点', async () => {
    const { wrapper, doc } = mountStage()

    hitAt(wrapper, 'edge-hit', 'e1').dispatchEvent(
      Object.assign(
        new MouseEvent('dblclick', {
          clientX: 220,
          clientY: 110,
          bubbles: true,
        }),
        { _vts: Date.now() + STAMP_AHEAD_MS },
      ),
    )
    await nextTick()

    expect(doc.config.value.edges[0]?.waypoints).toHaveLength(1)
    expect(doc.config.value.edges[1]?.waypoints).toHaveLength(0)
  })

  it('拖一端的把手时连线跟着草稿走，不是只有把手在动', async () => {
    const { wrapper, selection } = mountStage()
    selection.select('edges', 'e1')
    await nextTick()
    const before = wrapper
      .get('[data-test="edge-hit"][data-id="e1"]')
      .attributes('d')

    await press(endHandle(wrapper), 300, 110)
    fire('pointermove', 320, 130)
    await nextTick()

    expect(
      wrapper.get('[data-test="edge-hit"][data-id="e1"]').attributes('d'),
    ).not.toBe(before)
  })

  it('拖一端的把手，一手势也只落一步撤销', async () => {
    const { wrapper, doc, selection, changes } = mountStage()
    selection.select('edges', 'e1')
    await nextTick()

    await dragBy(endHandle(wrapper), { x: 300, y: 110 }, { x: 320, y: 120 }, 4)

    expect(changes()).toBe(1)
    expect(doc.config.value.edges[0]?.to.portId).toBe('')
  })
})

describe('调色板拖放', () => {
  it('松手就在落点上加一个节点，落点吸到网格上', async () => {
    const { wrapper, doc, changes } = mountStage()

    drop(wrapper, 's1', { x: 247, y: 133 })
    await nextTick()

    const added = doc.config.value.nodes.at(-1)
    expect(doc.config.value.nodes).toHaveLength(3)
    expect(added?.styleId).toBe('s1')
    // 40×20 的盒摆到指针正中是 (227, 123)，吸到 (220, 120)
    expect({ x: added?.x, y: added?.y }).toEqual({ x: 220, y: 120 })
    expect(changes()).toBe(1)
  })

  it('新加的那一个接着被选中，右栏不会还停在上一个上', async () => {
    const { wrapper, doc, selection } = mountStage()
    selection.select('nodes', 'n1')

    drop(wrapper, 's1', { x: 247, y: 133 })
    await nextTick()

    expect(selection.idsOf('nodes')).toEqual([
      doc.config.value.nodes.at(-1)?.id,
    ])
  })

  it('落在画布外的那一手夹到整只盒都在画布里', async () => {
    const { wrapper, doc } = mountStage()

    drop(wrapper, 's1', { x: 9000, y: -400 })
    await nextTick()

    const added = doc.config.value.nodes.at(-1)
    expect({ x: added?.x, y: added?.y }).toEqual({
      x: CONFIG.canvas.width - STYLE.size.w,
      y: 0,
    })
  })

  it('样式落不到就整手作废，撤销栈上也不多一格', async () => {
    const { wrapper, doc, changes } = mountStage()

    drop(wrapper, '没这份样式', { x: 247, y: 133 })
    await nextTick()

    expect(doc.config.value.nodes).toHaveLength(2)
    expect(changes()).toBe(0)
  })
})

/**
 * 转过 90° 的一份：连线端点要跟着节点的位姿走，跟手时也一样。
 * ⚠ 转过的节点最容易在「跟手」这件事上出错：端口世界坐标要过一遍位姿变换，
 * 而把草稿只喂给节点层的话，转过的那个节点连手都跟不上。
 */
const TURNED: Twin2dConfig = normalizeTwin2dConfig({
  ...CONFIG,
  nodes: [
    { id: 'n1', styleId: 's1', x: 100, y: 100, w: 40, h: 20, rotate: 90 },
    { id: 'n2', styleId: 's1', x: 300, y: 100, w: 40, h: 20 },
  ],
})

describe('拖节点时连线跟手', () => {
  // ⚠ 只把草稿留在节点层里的话，整个拖动过程中连线还按旧位置画，松手才跳一次
  it('拖动途中连线就跟着走，这时还一次都没落库', async () => {
    const { wrapper, changes } = mountStage()
    const before = edgePath(wrapper, 'e1')

    await press(nodeAt(wrapper, 'n1'), 110, 110)
    fire('pointermove', 170, 110)
    await nextTick()

    expect(edgePath(wrapper, 'e1')).not.toBe(before)
    expect(changes()).toBe(0)
  })

  // 跟手画的与落库画的是同一份几何：差一点点的话没人看得出来，但松手会「跳一下」
  it('跟手画出来的与松手落库之后画出来的一模一样', async () => {
    const { wrapper } = mountStage()

    await press(nodeAt(wrapper, 'n1'), 110, 110)
    fire('pointermove', 170, 110)
    await nextTick()
    const during = edgePath(wrapper, 'e1')
    fire('pointerup', 170, 110)
    await nextTick()

    expect(edgePath(wrapper, 'e1')).toBe(during)
  })

  it('两头都在拖的那条线也跟手，两端一起挪', async () => {
    const { wrapper, selection, changes } = mountStage()
    selection.selectMany('nodes', ['n1', 'n2'], false)
    await nextTick()
    const before = { e1: edgePath(wrapper, 'e1'), e2: edgePath(wrapper, 'e2') }

    await press(nodeAt(wrapper, 'n1'), 110, 110)
    fire('pointermove', 110, 170)
    await nextTick()

    expect(edgePath(wrapper, 'e1')).not.toBe(before.e1)
    expect(edgePath(wrapper, 'e2')).not.toBe(before.e2)
    expect(changes()).toBe(0)
  })

  it('转过 90° 的节点跟手画出来的也与落库之后一致', async () => {
    const { wrapper } = mountStage(TURNED)

    await press(nodeAt(wrapper, 'n1'), 110, 110)
    fire('pointermove', 170, 150)
    await nextTick()
    const during = edgePath(wrapper, 'e1')
    fire('pointerup', 170, 150)
    await nextTick()

    expect(edgePath(wrapper, 'e1')).toBe(during)
  })

  it('松手之后回到文档态，草稿不会赖着不走', async () => {
    const { wrapper, doc } = mountStage()
    await dragBy(
      nodeAt(wrapper, 'n1'),
      { x: 110, y: 110 },
      { x: 170, y: 110 },
      4,
    )
    const after = edgePath(wrapper, 'e1')

    doc.undo()
    await nextTick()

    expect(edgePath(wrapper, 'e1')).not.toBe(after)
  })
})
