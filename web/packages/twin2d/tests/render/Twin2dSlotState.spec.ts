/**
 * @fileoverview 逐槽取数四档在画布上守的契约：一格读数的文字与它的观感由**同一条**
 * 取数通道（`readSlot` 的返回值）决定，四档各自可辨，「等首帧」与「未配来源」分得开，
 * 档位按 (节点 id, 槽键) 各查各的，而不是槽位来源的文字一概不吃档位。
 *
 * ⚠ 这一档漏了整块图照样画得出来：坏掉的那一格与从没配过的那一格长得一模一样，
 * 墙上一个字都不多说——正是本模块自报 `ownsStatusDisplay` 之后必须自己堵上的洞（§9.6）。
 */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { normalizeTwin2dConfig } from '../../src/normalize'
import Twin2dStage from '../../src/render/Twin2dStage.vue'
import type { Twin2dFitMode } from '../../src/kinds'
import type { Twin2dSlotRead, Twin2dSlotState } from '../../src/paintText'

// ⚠ 拥有 sprite 的舞台在卸载时才把文档级标记还回去，不逐条卸载会让后面的用例领不到宿主
enableAutoUnmount(afterEach)

/** 未配来源与等首帧两档的字色 */
const MUTED = 'color: var(--text-disabled)'
/** 取不到那一档的字色 */
const DANGER = 'color: var(--state-danger)'
/** 等首帧那一档的透明度 */
const FADED = 'opacity: 0.45'
/** 等首帧那一下呼吸挂的类 */
const BREATHE = 't2-anim-breathe'

/** ⚠ 容器尺寸必须显式喂：happy-dom 量不出真实布局，`getBoundingClientRect` 恒 0。 */
const BOX = { w: 800, h: 400 }

const VIEW = {
  fitMode: 'contain' as Twin2dFitMode,
  fitPadding: 4,
  animateFlow: false,
  flowSpeed: 1,
}

/**
 * 一个只画一格读数的样式：整个节点上只有这一个 `txt` 图元，于是 `.t2-prim` 就是那一格
 * 本身，四档的文字与样式都读得干干净净。
 */
const PROBE_STYLE = {
  id: 'probe',
  name: '探针',
  size: { w: 120, h: 60 },
  slots: [{ key: 'temp', label: '温度', unit: '°C', precision: 1 }],
  prims: [{ id: 'reading', kind: 'txt', src: { kind: 'slot', slot: 'temp' } }],
}

/** 槽位口径：占位符与单位都与读数本身不同字样，四档各显什么一眼分得开。 */
const SLOT_FORMAT = {
  precision: 1,
  format: 'auto' as const,
  unit: '°C',
  enumMap: {},
  placeholder: '--',
}

function readOf(
  state: Twin2dSlotState,
  patch: Partial<Twin2dSlotRead> = {},
): Twin2dSlotRead {
  return { slot: SLOT_FORMAT, value: null, state, reason: '', ...patch }
}

/** 四档的读数各造一份，值只有有值那一档才有。 */
const OK = readOf('ok', { value: 36.5 })
const UNBOUND = readOf('unbound')
const PENDING = readOf('pending')
const ERROR = readOf('error', { reason: '通道断了' })

interface Scene {
  styles?: readonly unknown[]
  nodes?: readonly unknown[]
}

function render(
  read: (nodeId: string, key: string) => Twin2dSlotRead | null,
  scene: Scene = {},
) {
  const doc = normalizeTwin2dConfig({
    canvas: { width: 400, height: 200 },
    styles: scene.styles ?? [PROBE_STYLE],
    nodes: scene.nodes ?? [{ id: 'n1', styleId: 'probe', x: 20, y: 20 }],
  })
  return mount(Twin2dStage, {
    props: {
      canvas: doc.canvas,
      nodes: doc.nodes,
      edges: doc.edges,
      marks: doc.marks,
      nodeStyles: doc.styles,
      edgeStyles: doc.edgeStyles,
      view: VIEW,
      live: { readSlot: read },
      containerSize: BOX,
    },
  })
}

type Wrapper = ReturnType<typeof render>

/** 那一格的内联样式串。 */
function cellStyle(wrapper: Wrapper): string {
  return wrapper.get('.t2-prim').attributes('style') ?? ''
}

/** 那一格的类名。 */
function cellClasses(wrapper: Wrapper): readonly string[] {
  return wrapper.get('.t2-prim').classes()
}

/** 一档读数在墙上的文字、样式与类名。 */
function cellOf(read: Twin2dSlotRead) {
  const wrapper = render(() => read)
  return {
    text: wrapper.get('.t2-prim').text(),
    style: cellStyle(wrapper),
    classes: cellClasses(wrapper),
  }
}

describe('逐槽取数四档各自出色', () => {
  it('有值那一档画读数与单位，档位一条样式都不改', () => {
    const cell = cellOf(OK)

    expect(cell.text).toBe('36.5°C')
    expect(cell.style).not.toContain(MUTED)
    expect(cell.style).not.toContain(DANGER)
    expect(cell.classes).not.toContain(BREATHE)
  })

  it('未配来源那一档出槽位自己的占位符，压成三级正文', () => {
    const cell = cellOf(UNBOUND)

    expect(cell.text).toBe('--')
    expect(cell.style).toContain(MUTED)
  })

  it('等首帧那一档在占位符之外还加透明度与一次呼吸', () => {
    const cell = cellOf(PENDING)

    expect(cell.text).toBe('--')
    expect(cell.style).toContain(MUTED)
    expect(cell.style).toContain(FADED)
    expect(cell.classes).toContain(BREATHE)
  })

  // ⚠ 呼吸的时长必须一并给：`animation` 简写解析不到 var() 会整条报废，
  // 表现是「类挂上了却一动不动」而不是「按缺省时长动」
  it('呼吸那一档连时长一起给，不让 animation 整条报废', () => {
    expect(cellOf(PENDING).style).toContain('--t2-anim-dur: 1600ms')
  })

  it('取不到那一档变色，并把原因挂在这一格自己的 title 上', () => {
    const wrapper = render(() => ERROR)
    const cell = wrapper.get('.t2-prim')

    expect(cell.text()).toBe('--')
    expect(cell.attributes('style')).toContain(DANGER)
    expect(cell.attributes('title')).toBe('通道断了')
  })

  // 空 title 会 hover 出一个空气泡，还不如什么都不挂
  it('说不出原因时不挂 title', () => {
    const wrapper = render(() => readOf('error'))

    expect(wrapper.get('.t2-prim').attributes('title')).toBeUndefined()
  })

  // ⚠ 取不到时把上一帧的值留在墙上，比显示占位符危险得多：谁也看不出那个数停了
  it('非有值三档一律不把读数留在墙上', () => {
    const stale = { value: 36.5 }
    const texts = [
      cellOf(readOf('unbound', stale)).text,
      cellOf(readOf('pending', stale)).text,
      cellOf(readOf('error', stale)).text,
    ]

    expect(texts).toEqual(['--', '--', '--'])
  })
})

/**
 * ⚠ 本轮的要害：这两档在墙上是**同一个占位符**，颜色与透明度是它们唯一的区分手段。
 * 少了这一层，「这一格的点位坏了」与「这一格从没配过」在图上长得一模一样。
 */
describe('等首帧与未配来源只靠观感分得开', () => {
  it('两档的字一模一样', () => {
    expect(cellOf(PENDING).text).toBe(cellOf(UNBOUND).text)
  })

  it('两档的样式不一样：透明度与呼吸只有等首帧有', () => {
    const pending = cellOf(PENDING)
    const unbound = cellOf(UNBOUND)

    expect(pending.style).not.toBe(unbound.style)
    expect(unbound.style).not.toContain(FADED)
    expect(unbound.classes).not.toContain(BREATHE)
  })

  it('取不到那一档与它们俩也不是同一个颜色', () => {
    expect(cellOf(ERROR).style).not.toContain(MUTED)
  })
})

describe('档位按节点 id 与槽键各查各的', () => {
  const TWO_NODES = [
    { id: 'a', styleId: 'probe', x: 20, y: 20 },
    { id: 'b', styleId: 'probe', x: 200, y: 20 },
  ]

  // ⚠ 按下标取而不按 id 取的表现是「坏掉的那一格串到隔壁节点上」，零报错
  it('只有坏掉的那个节点变色，隔壁那一格照旧', () => {
    const wrapper = render((nodeId) => (nodeId === 'b' ? ERROR : OK), {
      nodes: TWO_NODES,
    })
    const cells = wrapper.findAll('.t2-prim')

    expect(cells[0]?.attributes('style')).not.toContain(DANGER)
    expect(cells[1]?.attributes('style')).toContain(DANGER)
  })

  it('同一个节点上两个槽位各出各的档', () => {
    const style = {
      ...PROBE_STYLE,
      slots: [
        { key: 'temp', label: '温度', unit: '°C', precision: 1 },
        { key: 'flow', label: '流量', unit: 't/h', placeholder: '未接' },
      ],
      prims: [
        { id: 'a', kind: 'txt', src: { kind: 'slot', slot: 'temp' } },
        { id: 'b', kind: 'txt', src: { kind: 'slot', slot: 'flow' } },
      ],
    }

    const wrapper = render((_nodeId, key) => (key === 'flow' ? ERROR : OK), {
      styles: [style],
    })
    const cells = wrapper.findAll('.t2-prim')

    expect(cells[0]?.attributes('style')).not.toContain(DANGER)
    expect(cells[1]?.attributes('style')).toContain(DANGER)
  })
})

describe('不是槽位来源的文字一概不吃档位', () => {
  const LABEL_STYLE = {
    ...PROBE_STYLE,
    prims: [{ id: 'name', kind: 'txt', src: { kind: 'label' } }],
  }

  // 显示名是配置里写死的，没有取数这回事；跟着某个槽位一起变红只会让人去查错地方
  it('显示名那一档不出档位色', () => {
    const wrapper = render(() => ERROR, {
      styles: [LABEL_STYLE],
      nodes: [{ id: 'n1', styleId: 'probe', label: '一号站' }],
    })
    const cell = wrapper.get('.t2-prim')

    expect(cell.text()).toBe('一号站')
    expect(cell.attributes('style')).not.toContain(DANGER)
    expect(cell.attributes('title')).toBeUndefined()
  })
})

describe('档位的 title 与省略提示抢同一个属性', () => {
  const ELLIPSIS_STYLE = {
    ...PROBE_STYLE,
    prims: [
      {
        id: 'reading',
        kind: 'txt',
        src: { kind: 'slot', slot: 'temp' },
        titleAttr: true,
      },
    ],
  }

  // ⚠ 这一格坏了的原因比「这里的字被省略了」要紧得多，让档位那一份赢
  it('取不到时 title 是原因，不是被省略的那段字', () => {
    const wrapper = render(() => ERROR, { styles: [ELLIPSIS_STYLE] })

    expect(wrapper.get('.t2-prim').attributes('title')).toBe('通道断了')
  })

  it('有值时 title 照旧是完整读数', () => {
    const wrapper = render(() => OK, { styles: [ELLIPSIS_STYLE] })

    expect(wrapper.get('.t2-prim').attributes('title')).toBe('36.5°C')
  })
})

describe('没有注入取数通道时一格都不上色', () => {
  // 设计态与独立挂载走这条：一片灰的预览比「什么都不说」更容易被当成真的坏了
  it('未注入 readSlot 时那一格不出任何档位色', () => {
    const wrapper = render(() => null)
    const cell = wrapper.get('.t2-prim')

    expect(cell.text()).toBe('—')
    expect(cell.attributes('style')).not.toContain(MUTED)
    expect(cell.attributes('style')).not.toContain(DANGER)
  })
})
