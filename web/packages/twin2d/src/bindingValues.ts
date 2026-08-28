/**
 * @fileoverview 模块 `values` 袋 → 三个实体钉行槽缝回实体的那一次缝合：每个节点的
 * 槽键读数（派生槽就地求值）、每个节点的状态原值、每条连线的三个子槽原值。
 *
 * ⚠ 顺序与 `twin2dBindingRows` **同源**——这里直接消费它的行，不自己再推一遍文档序。
 * 两边各算各的顺序时，每一行都会有值、每一层都不报错，但全都接错了对象，而那一类
 * 错在界面上完全看不出来（同 `bindingRemap.ts` 的文件头）。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §10.1、§14.2。
 */
import { twin2dBindingRows, twin2dStyleResolver } from './bindingRows'
import {
  TWIN_2D_EDGE_BINDING_KEY,
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_STATUS_BINDING_KEY,
} from './constants'
import { evalExpr } from './expr'
import { isRecord, toArray } from './sanitize'
import type { Twin2dBindingRow } from './bindingRows'
import type { Twin2dRowSlot } from './constants'
import type { Twin2dSlotValues } from './expr'
import type { Twin2dSlotRead } from './paintText'
import type {
  Twin2dConfig,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dSlot,
} from './types'

/** 一条连线的三个子槽读数，都是**没有归一过**的原值。 */
export interface Twin2dEdgeReading {
  /** 有流 / 通电。 */
  active: unknown
  /** 流向；负数 = 反向。 */
  direction: unknown
  /** 连线标签的读数。 */
  value: unknown
}

/**
 * 缝合好的一份运行态，键都是实体自己的 id。
 *
 * ⚠ `status` 与 `edges` 跟舞台 `live` 上的同名键**同名不同型**，这是有意的：状态要过
 * `toDeviceStatus`、连线要过活跃与方向词表，两步都在模块壳 `Component.vue` 里做
 * （§10.1、§7 #97）。整份 spread 进 `live` 会被 vue-tsc 当场打回，而不是静默把原始
 * 点位值当成已经归一的档位喂进渲染。
 */
export interface Twin2dLiveValues {
  /** 节点 id → 槽键 → 读数；派生槽已经按算式求好。 */
  slots: Readonly<Record<string, Twin2dSlotValues>>
  /** 节点 id → 状态那条数据线的原值。 */
  status: Readonly<Record<string, unknown>>
  /** 连线 id → 三个子槽的原值。 */
  edges: Readonly<Record<string, Twin2dEdgeReading>>
  /** 节点 id 加槽键 → 口径与读数；这个节点没声明这个槽时给 null。 */
  readSlot: (nodeId: string, key: string) => Twin2dSlotRead | null
}

/**
 * 第 index 行的 sub 子槽；行不是对象、那一格没给，都按无值处理。
 * ⚠ 非有限数也按无值：让 NaN 流下去，墙上会出现一个「NaN」而每一层都不报错。
 * ⚠ `sub` 收成 `Twin2dRowSlot` 而不是 string：槽键在清单与缝合两处各写一遍时，
 * 拼错的那一份既不报错也永远取不到值，收窄成联合类型才让它当场红。
 * @param rows 模块 values 里这个数组槽的整个数组
 * @param index 归一化后的文档序下标
 * @param sub 行内子槽
 */
function readRowSlot(
  rows: unknown,
  index: number,
  sub: Twin2dRowSlot,
): unknown {
  const row = toArray(rows)[index]
  if (!isRecord(row)) return undefined
  const value = row[sub]
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined
  return value
}

/**
 * 一个节点身上可用的槽位表，键是槽键。
 * ⚠ 同键以样式那一份为准（节点上的是**追加**槽位，§4.6），与 `normalizeSlots`
 * 的「同 key 只留最先一条」同一条规矩：反过来会让同一个槽在两个节点上用不同的
 * 单位与精度，而两处都零报错。
 * @param style 该节点的样式，样式悬空时给 null
 * @param node 节点实例
 */
function slotDefsOf(
  style: Twin2dNodeStyle | null,
  node: Twin2dNode,
): Map<string, Twin2dSlot> {
  const defs = new Map<string, Twin2dSlot>()
  for (const slot of [...(style?.slots ?? []), ...node.slots]) {
    if (!defs.has(slot.key)) defs.set(slot.key, slot)
  }
  return defs
}

/**
 * `nodeValues` 那些行缝回节点：节点 id → 槽键 → 读数。
 * @param rows 全部绑定行
 * @param bag 模块 values 里 `nodeValues` 槽的整个数组
 */
function liveReadings(
  rows: readonly Twin2dBindingRow[],
  bag: unknown,
): Map<string, Map<string, unknown>> {
  const out = new Map<string, Map<string, unknown>>()
  for (const row of rows) {
    if (row.slotKey !== TWIN_2D_NODE_BINDING_KEY) continue
    const value = readRowSlot(bag, row.index, 'value')
    if (value === undefined) continue
    const slots = out.get(row.entityId) ?? new Map<string, unknown>()
    slots.set(row.entitySlot, value)
    out.set(row.entityId, slots)
  }
  return out
}

/**
 * `nodeStatus` 那些行缝回节点：节点 id → 状态原值。
 * @param rows 全部绑定行
 * @param bag 模块 values 里 `nodeStatus` 槽的整个数组
 */
function statusReadings(
  rows: readonly Twin2dBindingRow[],
  bag: unknown,
): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const row of rows) {
    if (row.slotKey !== TWIN_2D_STATUS_BINDING_KEY) continue
    const value = readRowSlot(bag, row.index, 'status')
    if (value !== undefined) out.set(row.entityId, value)
  }
  return out
}

/**
 * 一条连线的三个子槽；一个都没绑给 null，那条连线随即按缺省（活跃、不反向）画。
 * @param bag 模块 values 里 `edgeValues` 槽的整个数组
 * @param index 连线的文档序下标
 */
function edgeReading(bag: unknown, index: number): Twin2dEdgeReading | null {
  const active = readRowSlot(bag, index, 'active')
  const direction = readRowSlot(bag, index, 'direction')
  const value = readRowSlot(bag, index, 'value')
  if (active === undefined && direction === undefined && value === undefined) {
    return null
  }
  return {
    active: active ?? null,
    direction: direction ?? null,
    value: value ?? null,
  }
}

/**
 * `edgeValues` 那些行缝回连线：连线 id → 三个子槽。
 * @param rows 全部绑定行
 * @param bag 模块 values 里 `edgeValues` 槽的整个数组
 */
function edgeReadings(
  rows: readonly Twin2dBindingRow[],
  bag: unknown,
): Map<string, Twin2dEdgeReading> {
  const out = new Map<string, Twin2dEdgeReading>()
  for (const row of rows) {
    if (row.slotKey !== TWIN_2D_EDGE_BINDING_KEY) continue
    const reading = edgeReading(bag, row.index)
    if (reading !== null) out.set(row.entityId, reading)
  }
  return out
}

/**
 * 一个节点的最终读数表：实时槽的原值，加上派生槽就地求出来的值。
 *
 * ⚠ 派生槽只读**实时槽**的值，不读别的派生槽：让派生互相引用，结果就跟着槽位的
 * 文档序走，而那个顺序在编辑器里一点也看不出来。预置库那三条派生链正是照这条写的
 * （`nodesSource.ts` 的能效链第三级只能引实时槽）。
 * ⚠ 只判 `expr`：归一化就是拿 `expr === null` 定的 `kind`，两处都判会多出一条
 * 构造上走不到的分支。
 * ⚠ 槽位表同时是 `join` 那一档的**显示口径**表：读数行拼出来的每一段按它自己那个槽
 * 的单位与精度出串（§7.4 #29）。少传这一张，墙上那一行就是几个没有单位的裸数。
 * @param defs 这个节点可用的槽位表
 * @param live 这个节点已缝好的实时读数
 */
function withDerived(
  defs: ReadonlyMap<string, Twin2dSlot>,
  live: Twin2dSlotValues | undefined,
): Twin2dSlotValues {
  const base: Twin2dSlotValues = live ?? new Map<string, unknown>()
  const out = new Map<string, unknown>(base)
  for (const slot of defs.values()) {
    if (slot.expr === null) continue
    const value = evalExpr(slot.expr, base, defs)
    if (value !== null) out.set(slot.key, value)
  }
  return out
}

/**
 * 一张 Map 转成一张**无原型**的表，键是实体 id。
 *
 * ⚠ 必须无原型：普通对象上 `constructor` / `toString` / `valueOf` 这些键取到的是
 * 原型链上的**函数**，`?? null` 与 `?? EMPTY_SLOTS` 一个都兜不住（函数不是 nullish），
 * 于是一个 id 叫 `constructor` 的节点会让下游拿到 `Object` 构造函数，`.get(key)`
 * 当场 TypeError，整块大屏白掉。`Object.fromEntries` 只防得住写进 `__proto__`，
 * 防不住读到原型链——两件事，且后者在 `sanitize.ts` 那里是合法 id。
 * ⚠ 在产表的这一处一次修掉，不在各个消费方各加一次 `Object.hasOwn`：那样又是一份
 * 「记得就没事、忘了就白屏」。
 * @param entries 实体 id → 读数
 */
function protoFreeTable<T>(
  entries: ReadonlyMap<string, T>,
): Readonly<Record<string, T>> {
  const table: Record<string, T> = Object.fromEntries(entries)
  Object.setPrototypeOf(table, null)
  return table
}

/**
 * 一个槽位的口径与它当下的读数；这个节点没声明这个槽时给 null。
 * ⚠ 声明了但没绑上的槽给的是 `value: null` 而不是整个 null：两者在墙上不一样——
 * 前者显示这个槽位自己的占位符，后者退到全局那个「—」（`paintText` 的 slot 一档）。
 * ⚠ 档位恒 `'ok'`：缝合层只认得配置与那袋 `values`，「没配来源 / 等首帧 / 取不到」
 * 三档要 `meta.slots` 才判得出来，那是模块壳的事（§9.6）。在这里瞎猜一档的表现是
 * 编辑器预览里整张图灰着，而运行态一切正常。
 * @param defs 节点 id → 槽位表
 * @param values 节点 id → 已缝好的读数
 * @param nodeId 节点 id
 * @param key 槽键
 */
function readOf(
  defs: ReadonlyMap<string, ReadonlyMap<string, Twin2dSlot>>,
  values: ReadonlyMap<string, Twin2dSlotValues>,
  nodeId: string,
  key: string,
): Twin2dSlotRead | null {
  const slot = defs.get(nodeId)?.get(key)
  if (slot === undefined) return null
  return {
    slot,
    value: values.get(nodeId)?.get(key) ?? null,
    state: 'ok',
    reason: '',
  }
}

/**
 * 把一袋模块 `values` 缝成三路运行态。
 *
 * ⚠ 一路读数都没有的节点与连线**不进表**：渲染层对缺席的实体走的正是「这一项没有
 * 数据」那一档，凭空摆一张空表反而要每一处都再判一次空。
 * ⚠ 三张表都是**无原型**的（`protoFreeTable`）：既防住写进 `__proto__`，也防住
 * 从原型链读到 `constructor` 这类函数。
 *
 * @param config **归一化后**的 2D 孪生配置；喂原始配置会因为脏条目被丢弃而整体错位一格
 * @param values 模块 values 袋，键是绑定槽键
 */
export function twin2dValues(
  config: Twin2dConfig,
  values: Record<string, unknown>,
): Twin2dLiveValues {
  const rows = twin2dBindingRows(config)
  const styleFor = twin2dStyleResolver(config)
  const live = liveReadings(rows, values[TWIN_2D_NODE_BINDING_KEY])
  const defs = new Map<string, ReadonlyMap<string, Twin2dSlot>>()
  const read = new Map<string, Twin2dSlotValues>()
  for (const node of config.nodes) {
    const own = slotDefsOf(styleFor(node.styleId), node)
    defs.set(node.id, own)
    const slots = withDerived(own, live.get(node.id))
    if (slots.size > 0) read.set(node.id, slots)
  }
  const status = statusReadings(rows, values[TWIN_2D_STATUS_BINDING_KEY])
  const edges = edgeReadings(rows, values[TWIN_2D_EDGE_BINDING_KEY])
  return {
    slots: protoFreeTable(read),
    status: protoFreeTable(status),
    edges: protoFreeTable(edges),
    readSlot: (nodeId, key) => readOf(defs, read, nodeId, key),
  }
}
