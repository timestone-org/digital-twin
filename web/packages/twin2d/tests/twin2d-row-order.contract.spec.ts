/**
 * @fileoverview 契约：绑定行的**文档序**只有一处真源。行推导（`twin2dBindingRows`）、
 * 运行时缝合（`twin2dValues`）、行数与行名三张表，四者必须逐行对得上。
 *
 * ⚠ 守的是整套绑定里最安静的那个错：`fieldKey` 只带行号、不带实体，两边各算各的顺序
 * 时**每一行都会有值、每一层都不报错**，只是全都接错了对象——墙上照常刷新，用户没有
 * 任何办法看出第 7 行喂的其实是另一个节点。
 * ⚠ 扫描器自带自检：先断言这份样例真的产出了十行以上。样例一旦退化成空，下面三条
 * 断言就全都空转通过——本仓踩过这类空转。
 */
import { describe, expect, it } from 'vitest'

import {
  twin2dBindingRows,
  twin2dRowCounts,
  twin2dRowLabels,
} from '../src/bindingRows'
import { twin2dValues } from '../src/bindingValues'
import {
  TWIN_2D_EDGE_BINDING_KEY,
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_STATUS_BINDING_KEY,
} from '../src/constants'
import { normalizeTwin2dConfig } from '../src/normalize'

/** 一行落在谁身上：这三项就是这一层要守的全部。 */
interface RowSeat {
  slotKey: string
  entityId: string
  entitySlot: string
}

/**
 * 一份**足够复杂**的样例：四个节点分属三种样式、每个节点的有效槽位数各不相同，
 * 三条连线，外加派生槽、节点级 `layers` 与 `patch`、变体条件与变体补丁。
 * ⚠ 槽位数「不等」是有意的：等长时行号与节点号成整除关系，错一位也能碰巧对上。
 */
const CONFIG = normalizeTwin2dConfig({
  styles: [
    {
      id: 'pump',
      slots: [
        { key: 'rpm', label: '转速' },
        { key: 'kw', label: '功率' },
        {
          key: 'eff',
          label: '能效',
          kind: 'derived',
          expr: {
            kind: 'ratio',
            num: { kind: 'slot', slot: 'kw' },
            den: { kind: 'slot', slot: 'rpm' },
            scale: 100,
          },
        },
        { key: 'idle', label: '无人引用' },
      ],
      prims: [{ id: 't-rpm', kind: 'txt', src: { kind: 'slot', slot: 'rpm' } }],
    },
    {
      id: 'tank',
      slots: [
        { key: 'level', label: '液位' },
        { key: 'temp', label: '温度' },
        { key: 'alarm', label: '报警' },
      ],
      prims: [
        { id: 't-level', kind: 'txt', src: { kind: 'slot', slot: 'level' } },
      ],
      variants: [
        {
          id: 'hot',
          when: { kind: 'slot', slot: 'temp', op: 'gt', value: 80 },
          patch: { 't-level': { src: { kind: 'slot', slot: 'alarm' } } },
        },
      ],
    },
    {
      id: 'meter',
      slots: [{ key: 'kwh', label: '电能' }],
      prims: [
        {
          id: 'v-on',
          kind: 'vec',
          when: { kind: 'slot', slot: 'kwh', op: 'gt', value: 0 },
        },
      ],
    },
  ],
  nodes: [
    {
      id: 'n1',
      styleId: 'pump',
      label: '一号泵',
      slots: [{ key: 'vib', label: '振动' }],
      layers: [
        { id: 'l-vib', kind: 'txt', src: { kind: 'slot', slot: 'vib' } },
      ],
    },
    {
      id: 'n2',
      styleId: 'tank',
      label: '缓冲罐',
      slots: [{ key: 'press', label: '压力' }],
      patch: {
        't-level': {
          when: { kind: 'slot', slot: 'press', op: 'gte', value: 1 },
        },
      },
    },
    { id: 'n3', styleId: 'meter', label: '总表' },
    { id: 'n4', styleId: 'pump', label: '二号泵' },
  ],
  edges: [
    { id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } },
    { id: 'e2', from: { nodeId: 'n2' }, to: { nodeId: 'n3' } },
    { id: 'e3', from: { nodeId: 'n1' }, to: { nodeId: 'n4' } },
  ],
})

/** 一行 `nodeValues`：节点 id 加它的槽位键。 */
function nodeSeat(entityId: string, entitySlot: string): RowSeat {
  return { slotKey: TWIN_2D_NODE_BINDING_KEY, entityId, entitySlot }
}

/**
 * 手写的期望行序，与实现两条腿：三处推导全都跟它对，谁跑偏都当场红。
 * ⚠ `eff` 是派生槽故自己不成行，但它 `expr` 里引到的 `kw` 成行；`idle` 无人引用
 * 故不成行——这两条正是「有效槽位」筛选里最容易少扫一处的地方。
 */
const EXPECTED: readonly RowSeat[] = [
  nodeSeat('n1', 'rpm'),
  nodeSeat('n1', 'kw'),
  nodeSeat('n1', 'vib'),
  nodeSeat('n2', 'level'),
  nodeSeat('n2', 'temp'),
  nodeSeat('n2', 'alarm'),
  nodeSeat('n2', 'press'),
  nodeSeat('n3', 'kwh'),
  nodeSeat('n4', 'rpm'),
  nodeSeat('n4', 'kw'),
  { slotKey: TWIN_2D_STATUS_BINDING_KEY, entityId: 'n1', entitySlot: '' },
  { slotKey: TWIN_2D_STATUS_BINDING_KEY, entityId: 'n2', entitySlot: '' },
  { slotKey: TWIN_2D_STATUS_BINDING_KEY, entityId: 'n3', entitySlot: '' },
  { slotKey: TWIN_2D_STATUS_BINDING_KEY, entityId: 'n4', entitySlot: '' },
  { slotKey: TWIN_2D_EDGE_BINDING_KEY, entityId: 'e1', entitySlot: '' },
  { slotKey: TWIN_2D_EDGE_BINDING_KEY, entityId: 'e2', entitySlot: '' },
  { slotKey: TWIN_2D_EDGE_BINDING_KEY, entityId: 'e3', entitySlot: '' },
]

/** 期望里属于某个数组槽的那几行。 */
function expectedOf(slotKey: string): RowSeat[] {
  return EXPECTED.filter((seat) => seat.slotKey === slotKey)
}

/**
 * 一袋标记值：第 i 行装的是带行号的字符串，于是缝合把它放到哪个实体上一目了然。
 * ⚠ 行数按**手写期望**铺而不按 `twin2dRowCounts`：拿被测量自己当尺子，量出来永远是准的。
 */
const BAG: Record<string, unknown> = {
  [TWIN_2D_NODE_BINDING_KEY]: expectedOf(TWIN_2D_NODE_BINDING_KEY).map(
    (_seat, index) => ({ value: `v${index}` }),
  ),
  [TWIN_2D_STATUS_BINDING_KEY]: expectedOf(TWIN_2D_STATUS_BINDING_KEY).map(
    (_seat, index) => ({ status: `s${index}` }),
  ),
  [TWIN_2D_EDGE_BINDING_KEY]: expectedOf(TWIN_2D_EDGE_BINDING_KEY).map(
    (_seat, index) => ({
      active: `a${index}`,
      direction: `d${index}`,
      value: `w${index}`,
    }),
  ),
}

const LIVE = twin2dValues(CONFIG, BAG)

/**
 * 标记里的行号；不是这一批的标记给 null。
 * @param value 缝合结果里读出来的那个值
 * @param prefix 这一批标记的前缀
 */
function markIndex(value: unknown, prefix: string): number | null {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null
  const index = Number(value.slice(prefix.length))
  return Number.isInteger(index) ? index : null
}

/**
 * 按行号把落点排回一条数组。
 * ⚠ 撞号当场炸：两行落到同一个行号上时，排完的数组反而会短一截，
 * 与期望比长度只报「少了一行」，看不出真正发生的是两行挤在了一处。
 * @param pairs 行号与落点的配对
 */
function seatsByIndex(
  pairs: readonly (readonly [number, RowSeat])[],
): RowSeat[] {
  const byIndex = new Map<number, RowSeat>()
  for (const [index, seat] of pairs) {
    expect(byIndex.has(index)).toBe(false)
    byIndex.set(index, seat)
  }
  return [...byIndex.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, seat]) => seat)
}

/** 缝合真正把 `nodeValues` 的第 i 行放到了哪个节点的哪个槽位。 */
function consumedNodeSeats(): RowSeat[] {
  const pairs: [number, RowSeat][] = []
  for (const [entityId, slots] of Object.entries(LIVE.slots)) {
    for (const [entitySlot, value] of slots) {
      const index = markIndex(value, 'v')
      if (index !== null) pairs.push([index, nodeSeat(entityId, entitySlot)])
    }
  }
  return seatsByIndex(pairs)
}

/** 缝合真正把 `nodeStatus` 的第 i 行放到了哪个节点。 */
function consumedStatusSeats(): RowSeat[] {
  const pairs: [number, RowSeat][] = []
  for (const [entityId, value] of Object.entries(LIVE.status)) {
    const index = markIndex(value, 's')
    if (index === null) continue
    pairs.push([
      index,
      { slotKey: TWIN_2D_STATUS_BINDING_KEY, entityId, entitySlot: '' },
    ])
  }
  return seatsByIndex(pairs)
}

/**
 * 缝合真正把 `edgeValues` 的第 i 行放到了哪条连线。
 * ⚠ 三个子槽的行号一并核对：只搬 `active` 时另外两项会留在旧行号上，
 * 于是同一条线的流向与标签从此喂给另一条线（§14.1）。
 */
function consumedEdgeSeats(): RowSeat[] {
  const pairs: [number, RowSeat][] = []
  for (const [entityId, reading] of Object.entries(LIVE.edges)) {
    const index = markIndex(reading.active, 'a')
    expect(markIndex(reading.direction, 'd')).toBe(index)
    expect(markIndex(reading.value, 'w')).toBe(index)
    if (index === null) continue
    pairs.push([
      index,
      { slotKey: TWIN_2D_EDGE_BINDING_KEY, entityId, entitySlot: '' },
    ])
  }
  return seatsByIndex(pairs)
}

describe('扫描器自检：样例真的产出了足够多的行', () => {
  it('手写期望与实际行数都在十行以上，三条断言才不是空转', () => {
    expect(EXPECTED.length).toBeGreaterThan(10)
    expect(twin2dBindingRows(CONFIG).length).toBeGreaterThan(10)
  })

  it('三个数组槽各自都有行，且节点的槽位数彼此不等', () => {
    const counts = twin2dRowCounts(CONFIG)

    expect(Object.values(counts).every((count) => count > 0)).toBe(true)
    expect([
      expectedOf(TWIN_2D_NODE_BINDING_KEY).filter(
        (seat) => seat.entityId === 'n1',
      ).length,
      expectedOf(TWIN_2D_NODE_BINDING_KEY).filter(
        (seat) => seat.entityId === 'n2',
      ).length,
      expectedOf(TWIN_2D_NODE_BINDING_KEY).filter(
        (seat) => seat.entityId === 'n3',
      ).length,
    ]).toEqual([3, 4, 1])
  })
})

describe('行序与缝合消费的顺序同源', () => {
  it('行推导给出的落点与手写期望逐行相同', () => {
    expect(
      twin2dBindingRows(CONFIG).map((row) => ({
        slotKey: row.slotKey,
        entityId: row.entityId,
        entitySlot: row.entitySlot,
      })),
    ).toEqual(EXPECTED)
  })

  it('节点读数缝到的槽位与行推导逐行相同', () => {
    expect(consumedNodeSeats()).toEqual(expectedOf(TWIN_2D_NODE_BINDING_KEY))
  })

  it('节点状态缝到的节点与行推导逐行相同', () => {
    expect(consumedStatusSeats()).toEqual(
      expectedOf(TWIN_2D_STATUS_BINDING_KEY),
    )
  })

  it('连线三个子槽缝到的连线与行推导逐行相同', () => {
    expect(consumedEdgeSeats()).toEqual(expectedOf(TWIN_2D_EDGE_BINDING_KEY))
  })

  it('三个槽合起来看，缝合消费到的顺序与行推导整条相同', () => {
    const declared = twin2dBindingRows(CONFIG).map((row) => ({
      slotKey: row.slotKey,
      entityId: row.entityId,
      entitySlot: row.entitySlot,
    }))

    expect([
      ...consumedNodeSeats(),
      ...consumedStatusSeats(),
      ...consumedEdgeSeats(),
    ]).toEqual(declared)
  })

  it('行号自己也对得上：第 i 行的 index 就是 i', () => {
    const rows = twin2dBindingRows(CONFIG)
    const byKey = new Map<string, number[]>()
    for (const row of rows) {
      byKey.set(row.slotKey, [...(byKey.get(row.slotKey) ?? []), row.index])
    }

    for (const [slotKey, indexes] of byKey) {
      expect(indexes).toEqual(expectedOf(slotKey).map((_seat, at) => at))
    }
  })
})

describe('行数表与行名表跟着同一份行走', () => {
  it('三个槽的行数与按 slotKey 分组的条数逐项相等', () => {
    const rows = twin2dBindingRows(CONFIG)
    const counts = twin2dRowCounts(CONFIG)

    expect(counts).toEqual({
      [TWIN_2D_NODE_BINDING_KEY]: rows.filter(
        (row) => row.slotKey === TWIN_2D_NODE_BINDING_KEY,
      ).length,
      [TWIN_2D_STATUS_BINDING_KEY]: rows.filter(
        (row) => row.slotKey === TWIN_2D_STATUS_BINDING_KEY,
      ).length,
      [TWIN_2D_EDGE_BINDING_KEY]: rows.filter(
        (row) => row.slotKey === TWIN_2D_EDGE_BINDING_KEY,
      ).length,
    })
    expect(Object.values(counts).reduce((sum, one) => sum + one, 0)).toBe(
      rows.length,
    )
  })

  it('行名表的键集合与全部行的 fieldKey 集合逐项相等', () => {
    const rows = twin2dBindingRows(CONFIG)
    const fieldKeys = rows.map((row) => row.fieldKey)

    expect(Object.keys(twin2dRowLabels(CONFIG)).sort()).toEqual(
      [...fieldKeys].sort(),
    )
    expect(new Set(fieldKeys).size).toBe(rows.length)
  })

  it('行名表每一条的实体 id 与那一行的实体逐条相同', () => {
    const labels = twin2dRowLabels(CONFIG)

    expect(
      twin2dBindingRows(CONFIG).map((row) => labels[row.fieldKey]?.id ?? ''),
    ).toEqual(EXPECTED.map((seat) => seat.entityId))
  })
})
