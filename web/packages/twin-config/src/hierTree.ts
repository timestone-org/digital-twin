/**
 * @fileoverview 钻取节点的树推导：建树、取子项、求路径、摊平字段。
 * 编辑器画树、运行态画卡片、绑定行派发三处共用同一套次序，各算各的必然漂。
 */
import type { TwinHierNode, TwinPanelField } from './types'

/** 建好的一层：节点本身加它的子树。 */
export interface TwinHierTreeNode {
  node: TwinHierNode
  children: TwinHierTreeNode[]
}

/** 摘要卡片默认摊开的字段条数。 */
export const HIER_SUMMARY_FALLBACK_COUNT = 2

/** 同级次序：`order` 小的在前，相同时按文档序——`sort` 本身不保证这一点。 */
function bySiblingOrder(nodes: readonly TwinHierNode[]): TwinHierNode[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((left, right) =>
      left.node.order === right.node.order
        ? left.index - right.index
        : left.node.order - right.node.order,
    )
    .map((entry) => entry.node)
}

/**
 * 某一层的子项，按同级次序。
 * ⚠ `parentId` 指向一个**不存在**的节点时，那一条按根处理：否则它会从整棵树里
 * 消失，而用户在清单里明明还看得见它。悬空由 `collectTwinConfigIssues` 报出来。
 * @param nodes 归一化后的全部钻取节点
 * @param parentId 上一层的 id；null = 取根
 */
export function childrenOf(
  nodes: readonly TwinHierNode[],
  parentId: string | null,
): TwinHierNode[] {
  const known = new Set(nodes.map((item) => item.id))
  const matched = nodes.filter((item) =>
    parentId === null
      ? item.parentId === null || !known.has(item.parentId)
      : item.parentId === parentId,
  )
  return bySiblingOrder(matched)
}

/** 一层层往下接，`seen` 拦住成环那几条，免得递归下不来。 */
function subtreeOf(
  nodes: readonly TwinHierNode[],
  parent: TwinHierNode,
  seen: Set<string>,
): TwinHierTreeNode {
  const children: TwinHierTreeNode[] = []
  for (const child of childrenOf(nodes, parent.id)) {
    if (seen.has(child.id)) continue
    seen.add(child.id)
    children.push(subtreeOf(nodes, child, seen))
  }
  return { node: parent, children }
}

/**
 * 全部钻取节点建成一棵（或几棵）树。
 *
 * ⚠ 成环的那几个节点从根走不到，于是整体不出现在结果里——这是刻意的：
 * 硬要把它们接上会让建树无限递归，整页直接白屏。环由
 * `collectTwinConfigIssues` 的 `hier-cycle` 响亮报出来。
 * @param nodes 归一化后的全部钻取节点
 */
export function buildHierTree(
  nodes: readonly TwinHierNode[],
): TwinHierTreeNode[] {
  const seen = new Set<string>()
  const roots: TwinHierTreeNode[] = []
  for (const root of childrenOf(nodes, null)) {
    if (seen.has(root.id)) continue
    seen.add(root.id)
    roots.push(subtreeOf(nodes, root, seen))
  }
  return roots
}

/**
 * 根到这个节点的整条链（含它自己），面包屑按它画。
 * ⚠ 往上走时要防环：`A → B → A` 这样一条链会让循环永远退不出去。
 * 遇到重复即停，产出的是从「环里最先遇到的那个」到当前节点的一段。
 * @param nodes 归一化后的全部钻取节点
 * @param id 当前节点 id
 */
export function hierAncestors(
  nodes: readonly TwinHierNode[],
  id: string,
): TwinHierNode[] {
  const byId = new Map(nodes.map((item) => [item.id, item]))
  const chain: TwinHierNode[] = []
  const seen = new Set<string>()
  let cursor = byId.get(id)
  while (cursor !== undefined && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    chain.unshift(cursor)
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
  }
  return chain
}

/**
 * 根到这个节点的名字数组，钻取页标题与面包屑用；名字空着退回 id。
 * @param nodes 归一化后的全部钻取节点
 * @param id 当前节点 id
 */
export function hierPathOf(
  nodes: readonly TwinHierNode[],
  id: string,
): string[] {
  return hierAncestors(nodes, id).map((item) =>
    item.name === '' ? item.id : item.name,
  )
}

/**
 * 这一层实际要孤立出来的 3D 节点名：自己配了就用自己的，没配就取全部子孙的并集。
 *
 * ⚠ 「空 = 取子孙并集」不是省事的默认值，是层级的常态：厂区、车间这种上层
 * 本来就没有属于自己的几何。留空当成「没有几何」会让上层钻进去看见一片空白。
 * ⚠ `seen` 挡住成环：环上一路往下会永远走不完。
 * @param nodes 归一化后的全部钻取节点
 * @param id 这一层的节点 id
 */
export function hierEffectiveNodes(
  nodes: readonly TwinHierNode[],
  id: string,
): string[] {
  const node = nodes.find((item) => item.id === id)
  if (node === undefined) return []
  if (node.nodes.length > 0) return [...node.nodes]
  const collected = new Set<string>()
  const seen = new Set<string>([id])
  const queue = [...childrenOf(nodes, id)]
  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined || seen.has(next.id)) continue
    seen.add(next.id)
    for (const name of next.nodes) collected.add(name)
    queue.push(...childrenOf(nodes, next.id))
  }
  return [...collected]
}

/** 钻取字段在整份配置里的位置：节点 + 字段 + 扁平化后的行号。 */
export interface FlatHierField {
  nodeId: string
  field: TwinPanelField
  /** `<节点 id>::<字段 key>`，实时值按它索引。 */
  valueKey: string
}

/**
 * 把所有钻取节点的字段按**文档序**摊平。
 * ⚠ 用文档序不是树序：树序会随「拖一下改父子」整体重排，而那会静默地把每一条
 * 绑定改喂另一个字段。文档序只有增删才动，编辑器跟着重派一次就对齐了。
 * @param nodes 归一化后的全部钻取节点
 */
export function flattenHierFields(
  nodes: readonly TwinHierNode[],
): FlatHierField[] {
  return nodes.flatMap((node) =>
    node.fields.map((field) => ({
      nodeId: node.id,
      field,
      valueKey: `${node.id}::${field.key}`,
    })),
  )
}

/**
 * 摘要卡片上要显示的字段：勾了哪几个就是哪几个，一个都没勾时取前两个。
 * ⚠ 勾中的 key 在 `fields` 里找不到就跳过，不留空位——那种 key 只可能来自
 * 「字段改了 key 而勾选没跟着改」，摆一个空行只会让人以为读数没上来。
 * @param node 归一化后的钻取节点
 */
export function hierSummaryFields(node: TwinHierNode): TwinPanelField[] {
  if (node.summaryFieldKeys.length === 0) {
    return node.fields.slice(0, HIER_SUMMARY_FALLBACK_COUNT)
  }
  const byKey = new Map(node.fields.map((field) => [field.key, field]))
  const picked: TwinPanelField[] = []
  for (const key of node.summaryFieldKeys) {
    const field = byKey.get(key)
    if (field !== undefined) picked.push(field)
  }
  return picked
}
