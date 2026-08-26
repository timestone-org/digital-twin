/**
 * @fileoverview 一袋模块 values 缝回实体：读数落在哪个节点的哪个槽位、状态落在哪个
 * 节点、三个子槽落在哪条连线。
 *
 * ⚠ 这一层与 `twin2dBindingRows` 必须共用同一套文档序。两边各算各的时候，每一行都会
 * 有值、每一层都不报错，但全都接错了对象——所以这里有一条用例把行与缝合结果逐行对上。
 */
import { describe, expect, it } from 'vitest'

import { twin2dBindingRows } from '../src/bindingRows'
import { twin2dValues } from '../src/bindingValues'
import { normalizeTwin2dConfig } from '../src/normalize'

/** 一枚引用某个槽键的文本图元：槽位要被静态引用到才算有效槽位（§14.2）。 */
function txt(slot: string) {
  return { id: `t-${slot}`, kind: 'txt', src: { kind: 'slot', slot } }
}

/** 一个槽位要哪几项。 */
interface SlotSpec {
  key: string
  label?: string
  unit?: string
  placeholder?: string
  kind?: string
  expr?: unknown
}

/** 一个样式：每个槽位都配一枚引用它的文本图元，于是每个非派生槽都占一行。 */
function style(id: string, slots: readonly SlotSpec[]) {
  return { id, slots, prims: slots.map((slot) => txt(slot.key)) }
}

/** 两个节点一条连线，节点上两个槽位。 */
const CONFIG = normalizeTwin2dConfig({
  styles: [
    style('s1', [
      { key: 'temp', label: '温度', unit: '℃' },
      { key: 'flow', label: '流量', unit: 'm³/h', placeholder: '未接' },
    ]),
  ],
  nodes: [
    { id: 'n1', styleId: 's1', label: '锅炉房' },
    { id: 'n2', styleId: 's1', label: '换热站' },
  ],
  edges: [{ id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } }],
})

describe('三个槽各自缝回实体', () => {
  const values = twin2dValues(CONFIG, {
    nodeValues: [{ value: 60 }, { value: 12 }, { value: 55 }, { value: 9 }],
    nodeStatus: [{ status: 1 }, { status: 3 }],
    edgeValues: [{ active: true, direction: -1, value: 42 }],
  })

  it('节点读数按「节点 × 槽位」扁平的行序落回各自的槽位', () => {
    expect([...(values.slots['n1'] ?? [])]).toEqual([
      ['temp', 60],
      ['flow', 12],
    ])
    expect([...(values.slots['n2'] ?? [])]).toEqual([
      ['temp', 55],
      ['flow', 9],
    ])
  })

  it('状态按节点文档序落回节点，原值不做任何归一', () => {
    expect(values.status).toEqual({ n1: 1, n2: 3 })
  })

  it('连线三个子槽一起落回同一条连线', () => {
    expect(values.edges).toEqual({
      e1: { active: true, direction: -1, value: 42 },
    })
  })

  it('一袋值都没给时三张表都是空的，而不是造出一堆空条目', () => {
    const empty = twin2dValues(CONFIG, {})

    expect(empty.slots).toEqual({})
    expect(empty.status).toEqual({})
    expect(empty.edges).toEqual({})
  })
})

describe('索引留空的行', () => {
  // ⚠ 一张图上四十个槽位只接三个点位是常态（isEntityPinned），空着的行不许把它
  //   后面的整体挤上来——挤上来之后每一条绑定都改喂前一个实体，而画面上一切正常
  it('空着的行不让其后的读数整体前移', () => {
    const values = twin2dValues(CONFIG, {
      nodeValues: [null, undefined, { value: 55 }],
    })

    expect(values.slots['n1']).toBeUndefined()
    expect([...(values.slots['n2'] ?? [])]).toEqual([['temp', 55]])
  })

  it('行给了却没给那个子槽，按没接数据处理', () => {
    const values = twin2dValues(CONFIG, { nodeValues: [{}, { value: 12 }] })

    expect([...(values.slots['n1'] ?? [])]).toEqual([['flow', 12]])
  })

  it('行不是对象一律按没接数据处理', () => {
    const values = twin2dValues(CONFIG, {
      nodeValues: ['60'],
      nodeStatus: [7],
    })

    expect(values.slots).toEqual({})
    expect(values.status).toEqual({})
  })

  // ⚠ 让 NaN 流下去，墙上会出现一个「NaN」而每一层都不报错
  it('非有限数按没有值处理', () => {
    const values = twin2dValues(CONFIG, {
      nodeValues: [{ value: Number.NaN }, { value: Number.POSITIVE_INFINITY }],
    })

    expect(values.slots).toEqual({})
  })

  it('显式的 0 是有值，与没接数据分得开', () => {
    const values = twin2dValues(CONFIG, {
      nodeValues: [{ value: 0 }],
      nodeStatus: [{ status: 0 }],
    })

    expect(values.slots['n1']?.get('temp')).toBe(0)
    expect(values.status).toEqual({ n1: 0 })
  })
})

describe('行序与缝合同源', () => {
  /** 三个节点，中间那个多一个槽位——按「第 i 个节点」对齐就会从它之后整片错开。 */
  const MIXED = normalizeTwin2dConfig({
    styles: [
      style('two', [{ key: 'a' }, { key: 'b' }]),
      style('three', [{ key: 'x' }, { key: 'y' }, { key: 'z' }]),
    ],
    nodes: [
      { id: 'n1', styleId: 'two' },
      { id: 'n2', styleId: 'three' },
      { id: 'n3', styleId: 'two' },
    ],
  })

  const rows = twin2dBindingRows(MIXED).filter(
    (row) => row.slotKey === 'nodeValues',
  )
  const values = twin2dValues(MIXED, {
    nodeValues: rows.map((_, index) => ({ value: index })),
  })

  it('第 i 行的读数缝到的正是这一行记着的那个节点与槽位', () => {
    expect(rows).toHaveLength(7)
    expect(
      rows.map((row) => values.slots[row.entityId]?.get(row.entitySlot)),
    ).toEqual(rows.map((row) => row.index))
  })

  it('缝出来的读数条数与行数相等：没有两行挤进同一个槽位', () => {
    const stitched = Object.values(values.slots).reduce(
      (sum, slots) => sum + slots.size,
      0,
    )

    expect(stitched).toBe(rows.length)
  })
})

describe('派生槽', () => {
  const sum = {
    kind: 'sum',
    of: [
      { kind: 'slot', slot: 'temp' },
      { kind: 'slot', slot: 'flow' },
    ],
  }
  const DERIVED = normalizeTwin2dConfig({
    styles: [
      style('s1', [
        { key: 'temp' },
        { key: 'flow' },
        { key: 'total', kind: 'derived', expr: sum },
        {
          key: 'double',
          kind: 'derived',
          expr: { kind: 'scale', of: { kind: 'slot', slot: 'total' }, by: 2 },
        },
      ]),
    ],
    nodes: [{ id: 'n1', styleId: 's1' }],
  })

  it('派生槽就地求值，与实时槽摆在同一张读数表里', () => {
    const values = twin2dValues(DERIVED, {
      nodeValues: [{ value: 60 }, { value: 12 }],
    })

    expect(values.slots['n1']?.get('total')).toBe(72)
  })

  it('派生槽自己不占行：两个实时槽就只有两行', () => {
    const rows = twin2dBindingRows(DERIVED).filter(
      (row) => row.slotKey === 'nodeValues',
    )

    expect(rows.map((row) => row.entitySlot)).toEqual(['temp', 'flow'])
  })

  // ⚠ 缺一路就整式为空：两路之和会被当成总量读走，而画面上没有任何迹象说少了一路
  it('算式缺一个操作数时那一格干脆没有值', () => {
    const values = twin2dValues(DERIVED, { nodeValues: [{ value: 60 }] })

    expect(values.slots['n1']?.has('total')).toBe(false)
  })

  // ⚠ 让派生互相引用，结果就跟着槽位的文档序走，而那个顺序在编辑器里一点也看不出来
  it('派生槽只读实时槽，引另一个派生槽求不出值', () => {
    const values = twin2dValues(DERIVED, {
      nodeValues: [{ value: 60 }, { value: 12 }],
    })

    expect(values.slots['n1']?.has('double')).toBe(false)
  })
})

describe('按槽键取口径与读数', () => {
  it('绑上了的槽给口径加读数', () => {
    const values = twin2dValues(CONFIG, { nodeValues: [{ value: 60 }] })
    const read = values.readSlot('n1', 'temp')

    expect(read?.value).toBe(60)
    expect(read?.slot.unit).toBe('℃')
  })

  // ⚠ 「声明了没绑上」给的是 value: null 而不是整个 null：前者在墙上显示这个槽位
  //   自己的占位符，后者退到全局那个「—」
  it('声明了没绑上的槽给的是空读数，不是整条没有', () => {
    const read = twin2dValues(CONFIG, {}).readSlot('n1', 'flow')

    expect(read?.value).toBeNull()
    expect(read?.slot.placeholder).toBe('未接')
  })

  it('这个节点没声明的槽给 null，节点本身不在册也给 null', () => {
    const values = twin2dValues(CONFIG, {})

    expect(values.readSlot('n1', 'nope')).toBeNull()
    expect(values.readSlot('nope', 'temp')).toBeNull()
  })
})

describe('槽位表从哪儿来', () => {
  it('样式落在预置库里的节点照样缝得上', () => {
    const config = normalizeTwin2dConfig({
      nodes: [{ id: 'n1', styleId: 'solar-source' }],
    })
    const rows = twin2dBindingRows(config).filter(
      (row) => row.slotKey === 'nodeValues',
    )
    const values = twin2dValues(config, {
      nodeValues: rows.map((_, index) => ({ value: index })),
    })

    expect(rows.length).toBeGreaterThan(0)
    expect(
      rows.map((row) => values.slots[row.entityId]?.get(row.entitySlot)),
    ).toEqual(rows.map((row) => row.index))
  })

  it('节点追加的槽位一起缝，同键以样式那一份的口径为准', () => {
    const config = normalizeTwin2dConfig({
      styles: [style('s1', [{ key: 'temp', unit: '℃' }])],
      nodes: [
        {
          id: 'n1',
          styleId: 's1',
          slots: [{ key: 'temp', unit: 'K' }, { key: 'extra' }],
          layers: [txt('extra')],
        },
      ],
    })
    const values = twin2dValues(config, {
      nodeValues: [{ value: 60 }, { value: 7 }],
    })

    expect([...(values.slots['n1'] ?? [])]).toEqual([
      ['temp', 60],
      ['extra', 7],
    ])
    expect(values.readSlot('n1', 'temp')?.slot.unit).toBe('℃')
  })

  // 样式悬空的节点渲染层整个不画，但状态那条数据线与它无关，照旧钉着这一行
  it('样式悬空的节点产不出读数行，状态行照旧', () => {
    const config = normalizeTwin2dConfig({
      nodes: [
        {
          id: 'n1',
          styleId: 'nope',
          slots: [{ key: 'own', placeholder: '自带' }],
        },
      ],
    })
    const values = twin2dValues(config, {
      nodeValues: [{ value: 60 }],
      nodeStatus: [{ status: 2 }],
    })

    expect(values.slots).toEqual({})
    expect(values.status).toEqual({ n1: 2 })
    expect(values.readSlot('n1', 'own')?.slot.placeholder).toBe('自带')
  })
})

describe('连线的三个子槽', () => {
  it('只绑一个子槽也进表，另外两个给 null', () => {
    const flowOnly = twin2dValues(CONFIG, { edgeValues: [{ direction: -1 }] })
    const activeOnly = twin2dValues(CONFIG, { edgeValues: [{ active: true }] })

    expect(flowOnly.edges).toEqual({
      e1: { active: null, direction: -1, value: null },
    })
    expect(activeOnly.edges).toEqual({
      e1: { active: true, direction: null, value: null },
    })
  })

  // 缺席的连线在渲染层走的正是「活跃、不反向、无标签」那一档缺省
  it('三个子槽一个都没绑的连线不进表', () => {
    const values = twin2dValues(CONFIG, { edgeValues: [{}] })

    expect(values.edges).toEqual({})
  })
})

// ⚠ 两件事，都零报错：往对象字面量上逐键赋 `__proto__` 会改到原型而不是加一个属性；
//   而普通对象上 `constructor` / `toString` / `valueOf` 读到的是原型链上的**函数**，
//   `?? null` 与渲染层的 `?? EMPTY_SLOTS` 都兜不住它，下游 `.get()` 当场 TypeError
const PROTO_NAMES: readonly string[] = [
  'constructor',
  'toString',
  'valueOf',
  '__proto__',
]

describe('实体 id 撞上原型链上的名字', () => {
  const config = normalizeTwin2dConfig({
    styles: [style('s1', [{ key: 'temp' }])],
    nodes: PROTO_NAMES.map((id) => ({ id, styleId: 's1' })),
    edges: [
      {
        id: 'constructor',
        from: { nodeId: 'constructor' },
        to: { nodeId: 'toString' },
      },
      {
        id: 'valueOf',
        from: { nodeId: 'valueOf' },
        to: { nodeId: '__proto__' },
      },
    ],
  })
  const values = twin2dValues(config, {
    nodeValues: PROTO_NAMES.map((_, index) => ({ value: index })),
    nodeStatus: PROTO_NAMES.map((_, index) => ({ status: index })),
    edgeValues: [{ active: true }, { active: false }],
  })

  it('三张表都是无原型的，`constructor` 这类键取不到原型链上的函数', () => {
    expect(Object.getPrototypeOf(values.slots)).toBeNull()
    expect(Object.getPrototypeOf(values.status)).toBeNull()
    expect(Object.getPrototypeOf(values.edges)).toBeNull()
  })

  it.each(PROTO_NAMES)('叫 %s 的节点取到的是它自己那份读数与状态', (id) => {
    expect(values.slots[id]?.get('temp')).toBe(PROTO_NAMES.indexOf(id))
    expect(values.status[id]).toBe(PROTO_NAMES.indexOf(id))
    expect(Object.hasOwn(values.slots, id)).toBe(true)
    expect(Object.hasOwn(values.status, id)).toBe(true)
  })

  it('连线表同样按 id 取到自己那条', () => {
    expect(values.edges['constructor']?.active).toBe(true)
    expect(values.edges['valueOf']?.active).toBe(false)
  })

  it('取一个不在表里的同名键给 undefined，而不是一个函数', () => {
    const empty = twin2dValues(config, {})

    for (const name of PROTO_NAMES) {
      expect(empty.slots[name]).toBeUndefined()
      expect(empty.status[name]).toBeUndefined()
      expect(empty.edges[name]).toBeUndefined()
      expect(values.edges[name] ?? null).not.toBeInstanceOf(Function)
    }
  })

  it('按 id 取口径与读数照旧取得到', () => {
    expect(values.readSlot('__proto__', 'temp')?.value).toBe(3)
  })
})
