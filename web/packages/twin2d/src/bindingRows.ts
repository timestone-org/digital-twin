/**
 * @fileoverview 绑定行 ⇄ 2D 孪生实体的对应：三个数组槽各自摊成行，以及一个节点的
 * 「有效槽位」怎么筛。落库的 fieldKey 只带行号不带实体，行号就是文档序。
 * 逐字口径见 docs/MODULE_TWIN_2D_DESIGN.md §14.2。
 *
 * ⚠ 两边各算各的顺序时，**每一行都会有值、但全都接错了对象**——所以缝合读值与
 * 这里的行推导必须共用同一套文档序，由契约测试钉住。
 */
import type { BindingRowLabel } from '@dt/contracts'

import {
  TWIN_2D_EDGE_BINDING_KEY,
  TWIN_2D_EDGE_ROW_SLOTS,
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_STATUS_BINDING_KEY,
  edgeRowFieldKey,
  nodeRowFieldKey,
  statusRowFieldKey,
} from './constants'
import { TWIN_2D_BUILTIN_NODE_STYLE_MAP } from './presets/nodes'
import { uniqueBy } from './sanitize'
import { twin2dNodeScope, twin2dSlotRefs, twin2dStyleScope } from './slotRefs'
import type {
  Twin2dConfig,
  Twin2dEdge,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dSlot,
} from './types'

/** 一个数组绑定行落在哪个实体上。 */
export interface Twin2dBindingRow {
  /** 'nodeValues' | 'nodeStatus' | 'edgeValues' */
  slotKey: string
  index: number
  /** 落库的 fieldKey，如 `nodeValues[3].value`。 */
  fieldKey: string
  /** 这一行喂的实体 id（节点或连线）；重派按它对齐。 */
  entityId: string
  /** nodeValues 专用：这一行喂的是该节点的哪个**槽位键**；其余两个槽给空串。 */
  entitySlot: string
  /** 数组子槽名：'value' | 'status' | 'active' | 'direction'。 */
  sub: string
  /** 给人看的一行名字，绑点面板拿它当组标题。 */
  label: string
}

/**
 * 连线行挂在哪个子槽上。
 * ⚠ 取 `arrayFields` 的**第一个**：绑点面板按「组内第一个子槽的 fieldKey」取行名，
 * 挂到 `value` 上的话三个子槽都摆在那儿、组标题却是「第 N 行」（`BindingPanel` 的
 * `labelOf`）。一条连线仍然只算一行，不按子槽数翻倍。
 */
const EDGE_ROW_SUB = TWIN_2D_EDGE_ROW_SLOTS[0]

/** 三个数组槽，行数统计逐个走一遍。 */
const ARRAY_SLOTS = [
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_STATUS_BINDING_KEY,
  TWIN_2D_EDGE_BINDING_KEY,
] as const

/** 名字空着时退回 id：绑点面板上一行没有任何标识比显示 id 更糟。 */
function nameOr(name: string, fallback: string): string {
  return name.trim() === '' ? fallback : name.trim()
}

/**
 * 按 id 取节点样式的查表函数：文档里的优先，落不到才回预置库（同 id 以文档为准，§13.4）。
 *
 * ⚠ 回落必须在这里做，不能留给调用方：`nodes[].styleId` 绝大多数指的是预置样式，
 * 不回落就是整张图一行都产不出来，而面板上只表现为「这个模块没有可绑的东西」。
 * ⚠ 行推导与缝合读值**共用这一份**，不许各写各的：两边对同一个节点解出不同的样式时，
 * 行照样有、值照样缝，只是那一行的槽位在读值一侧根本不存在，于是墙上永远是占位符——
 * 与行序错位是同一类静默错。
 * @param config 归一化后的 2D 孪生配置
 */
export function twin2dStyleResolver(
  config: Twin2dConfig,
): (styleId: string) => Twin2dNodeStyle | null {
  const inDoc = new Map(config.styles.map((style) => [style.id, style]))
  return (styleId) =>
    inDoc.get(styleId) ?? TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(styleId) ?? null
}

/**
 * 一个节点上**静态可达**的全部槽引用；扫描面归 `slotRefs.ts` 那一份，这里只把
 * 样式与节点两个作用域并起来。
 * ⚠ 派生槽的算式按 `available` 扫：同键以样式那一份为准，节点上被压住的那条
 * 本就取不到值。
 * @param style 节点引的样式
 * @param node 节点实例
 * @param available 该节点可用的槽位（样式槽 ∪ 节点追加槽）
 */
function referencedSlots(
  style: Twin2dNodeStyle,
  node: Twin2dNode,
  available: readonly Twin2dSlot[],
): Set<string> {
  const refs = [
    ...twin2dSlotRefs({ ...twin2dStyleScope(style), slots: available }),
    ...twin2dSlotRefs({ ...twin2dNodeScope(node), slots: [] }),
  ]
  return new Set(refs.map((ref) => ref.key))
}

/**
 * 一个节点的有效槽位：`style.slots ∪ node.slots` 去掉派生槽，再只留被静态引用到的，
 * **保持文档序**（样式的槽在前，节点追加的在后；同键只留最先一条）。
 *
 * 静态可达的引用位置七处：`txt` 图元的 `slot` 来源、图元的 `when`、变体条件、变体补丁
 * 改出来的 `txt.src`、派生槽的 `expr`，以及节点级 `layers` 与 `patch` 里的以上各处。
 * 少扫一处，那个槽就永远绑不上，且零报错。
 * ⚠ 派生槽自己不成行（它没有数据来源），但它 `expr` 里引到的槽要成行。
 * ⚠ 唯一能让一个槽退出行的是把对它的引用整个删掉，而那一步由 `remapTwin2dBindings`
 * 兜住（§14.3）——所以写配置必须无条件重派绑定。
 * ⚠ 样式悬空的节点一行都不产：渲染层对这种节点是整个不画。
 * @param config 归一化后的 2D 孪生配置
 * @param nodeId 节点 id
 */
export function effectiveSlotsOf(
  config: Twin2dConfig,
  nodeId: string,
): Twin2dSlot[] {
  const node = config.nodes.find((item) => item.id === nodeId)
  if (node === undefined) return []
  const style = twin2dStyleResolver(config)(node.styleId)
  if (style === null) return []
  const available = uniqueBy([...style.slots, ...node.slots], (s) => s.key)
  const used = referencedSlots(style, node, available)
  return available.filter(
    (slot) => slot.kind !== 'derived' && used.has(slot.key),
  )
}

/** 节点读数行：节点文档序 × 该节点有效槽位文档序，扁平。 */
function nodeValueRows(config: Twin2dConfig): Twin2dBindingRow[] {
  const rows: Twin2dBindingRow[] = []
  for (const node of config.nodes) {
    for (const slot of effectiveSlotsOf(config, node.id)) {
      const index = rows.length
      rows.push({
        slotKey: TWIN_2D_NODE_BINDING_KEY,
        index,
        fieldKey: nodeRowFieldKey(index),
        entityId: node.id,
        entitySlot: slot.key,
        sub: 'value',
        label: `${nameOr(node.label, node.id)} · ${nameOr(slot.label, slot.key)}`,
      })
    }
  }
  return rows
}

/**
 * 节点状态行：一个节点一行，行数就是 `nodes.length`。
 * ⚠ 样式悬空、一个有效槽位都没有的节点照样占一行：状态是一条独立的数据线，
 * 与这个节点显示不显示读数无关（§10.1）。
 */
function nodeStatusRows(config: Twin2dConfig): Twin2dBindingRow[] {
  return config.nodes.map((node, index) => ({
    slotKey: TWIN_2D_STATUS_BINDING_KEY,
    index,
    fieldKey: statusRowFieldKey(index),
    entityId: node.id,
    entitySlot: '',
    sub: 'status',
    label: nameOr(node.label, node.id),
  }))
}

/** 一端显示成哪个名字：节点名，空着退回节点 id。 */
function endpointName(config: Twin2dConfig, nodeId: string): string {
  const node = config.nodes.find((item) => item.id === nodeId)
  return nameOr(node?.label ?? '', nodeId)
}

/** 一条连线的行名：两端的节点名。 */
function edgeLabel(config: Twin2dConfig, edge: Twin2dEdge): string {
  const from = endpointName(config, edge.from.nodeId)
  const to = endpointName(config, edge.to.nodeId)
  return `${from} → ${to}`
}

/**
 * 连线读数行：一条连线一行，行数就是 `edges.length`。
 * ⚠ 这里不再按「两端在不在册」筛一次：指向不存在节点的连线归一化时就整条丢了，
 * 再筛一次只会与 §14.2 的「行数 = edges.length」错开一格。
 */
function edgeValueRows(config: Twin2dConfig): Twin2dBindingRow[] {
  return config.edges.map((edge, index) => ({
    slotKey: TWIN_2D_EDGE_BINDING_KEY,
    index,
    fieldKey: edgeRowFieldKey(index, EDGE_ROW_SUB),
    entityId: edge.id,
    entitySlot: '',
    sub: EDGE_ROW_SUB,
    label: edgeLabel(config, edge),
  }))
}

/**
 * 一份配置摊成全部绑定行，顺序与运行时缝合读值的顺序**逐行相同**。
 * ⚠ 喂归一化**输出**：喂原始配置会因为脏条目被丢弃而让其后每一行整体错位一格。
 * @param config 归一化后的 2D 孪生配置
 */
export function twin2dBindingRows(config: Twin2dConfig): Twin2dBindingRow[] {
  return [
    ...nodeValueRows(config),
    ...nodeStatusRows(config),
    ...edgeValueRows(config),
  ]
}

/**
 * 绑定行的组标题表，键是 fieldKey。绑点面板直接用。
 * ⚠ `id` 给的就是 `entityId`——与图上选中实体时显示的那一份逐字相同。两边显示不同的
 * 标识时，用户没有任何办法确认第 7 行绑的到底是哪个实体，只能一行行数。
 * @param config 归一化后的 2D 孪生配置
 */
export function twin2dRowLabels(
  config: Twin2dConfig,
): Readonly<Record<string, BindingRowLabel>> {
  const labels: Record<string, BindingRowLabel> = {}
  for (const row of twin2dBindingRows(config)) {
    labels[row.fieldKey] = { title: row.label, id: row.entityId }
  }
  return labels
}

/**
 * 三个数组槽各应有几行，键是槽键。绑点面板据它把行钉在实体上。
 * ⚠ 一个实体都没有的槽也要出现在表里、值为 0：漏掉的键会被面板当成「行数由用户手工
 * 增删」，于是摆出一个加了也喂不到任何东西的「新增一行」。
 * @param config 归一化后的 2D 孪生配置
 */
export function twin2dRowCounts(
  config: Twin2dConfig,
): Readonly<Record<string, number>> {
  const rows = twin2dBindingRows(config)
  const counts: Record<string, number> = {}
  for (const slotKey of ARRAY_SLOTS) {
    counts[slotKey] = rows.filter((row) => row.slotKey === slotKey).length
  }
  return counts
}

/**
 * 某个实体占了哪几行：节点给它的读数行加那一条状态行，连线给它自己那一行。
 * 绑点面板据它只摆这一个实体的行。
 * ⚠ 行里带的是**行号**（`index` 与 `fieldKey`），过滤之后不许重新编号：数组绑定的
 * fieldKey 是 `槽[行号].子键`，按过滤后的位置重编会让每一条绑定改喂另一个实体。
 * @param config 归一化后的 2D 孪生配置
 * @param entityId 节点 id 或连线 id
 */
export function twin2dRowsOfEntity(
  config: Twin2dConfig,
  entityId: string,
): Twin2dBindingRow[] {
  return twin2dBindingRows(config).filter((row) => row.entityId === entityId)
}
