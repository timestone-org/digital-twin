/**
 * @fileoverview 钻取树的结构操作：建根、建子、同级挪位、改父子。全是纯函数：
 * 收一份配置，回一份新配置。节点自身的属性由通用的 `updateEntity` 改。
 *
 * ⚠ 这里只动 `parentId` 与 `order`，绝不动 `hierNodes` 的**数组次序**：数组次序
 * 是绑定行的对齐口径（`hierValues[2]` 喂扁平化后的第 3 个字段），拖一下树就重排
 * 数组的话，每一条绑定都会安静地改喂另一个字段。
 */
import { type TwinConfig, type TwinHierNode, childrenOf } from '@dt/twin-config'

import { addEntity, updateEntity, type TwinIdFactory } from './entityOps'

/** 新建节点的智能默认名：根是「区域 N」，子层是「子项 N」。 */
export function hierDefaultName(
  config: TwinConfig,
  parentId: string | null,
): string {
  const count = childrenOf(config.hierNodes, parentId).length + 1
  return parentId === null ? `区域 ${count}` : `子项 ${count}`
}

/** 排在同一层最后面的次序值。 */
function nextOrder(config: TwinConfig, parentId: string | null): number {
  const siblings = childrenOf(config.hierNodes, parentId)
  return siblings.reduce((high, item) => Math.max(high, item.order + 1), 0)
}

/**
 * 新建一个钻取节点，挂在 `parentId` 下面的最后一位。
 * @param config 当前配置
 * @param parentId 上一层 id；null = 建一个根
 * @param makeId id 工厂，缺省随机
 */
export function addHierNode(
  config: TwinConfig,
  parentId: string | null,
  makeId?: TwinIdFactory,
): { config: TwinConfig; id: string } {
  const name = hierDefaultName(config, parentId)
  const order = nextOrder(config, parentId)
  const created = addEntity(config, 'hierNodes', makeId)
  return {
    config: updateEntity(created.config, 'hierNodes', created.id, {
      parentId,
      name,
      order,
    }),
    id: created.id,
  }
}

/** `ancestorId` 是不是 `id` 的祖先（`id` 自己也算）。`seen` 挡住成环。 */
export function isHierDescendant(
  nodes: readonly TwinHierNode[],
  ancestorId: string,
  id: string,
): boolean {
  const parents = new Map(nodes.map((item) => [item.id, item.parentId]))
  const seen = new Set<string>()
  let cursor: string | null = id
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === ancestorId) return true
    seen.add(cursor)
    cursor = parents.get(cursor) ?? null
  }
  return false
}

/**
 * 换一个节点的上一层，排到新一层的最后一位。
 *
 * ⚠ 拖进自己的子树里会立刻成环，而成环的那几层从任何根都走不到，
 * 在钻取里**整片消失**。所以这里直接拒绝，不留给诊断事后报。
 * @param config 当前配置
 * @param id 被拖的节点
 * @param parentId 新的上一层；null = 提到顶层
 */
export function reparentHierNode(
  config: TwinConfig,
  id: string,
  parentId: string | null,
): TwinConfig {
  const node = config.hierNodes.find((item) => item.id === id)
  if (node === undefined || node.parentId === parentId) return config
  if (parentId !== null && isHierDescendant(config.hierNodes, id, parentId)) {
    return config
  }
  return updateEntity(config, 'hierNodes', id, {
    parentId,
    order: nextOrder(config, parentId),
  })
}

/**
 * 同一层里前挪一位或后挪一位：与相邻那个交换 `order`。
 * @param config 当前配置
 * @param id 要挪的节点
 * @param delta -1 上移，1 下移
 */
export function moveHierSibling(
  config: TwinConfig,
  id: string,
  delta: number,
): TwinConfig {
  const node = config.hierNodes.find((item) => item.id === id)
  if (node === undefined) return config
  const siblings = childrenOf(config.hierNodes, node.parentId)
  const from = siblings.findIndex((item) => item.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= siblings.length) return config
  const ordered = [...siblings]
  const [moved] = ordered.splice(from, 1)
  if (moved === undefined) return config
  ordered.splice(to, 0, moved)
  // ⚠ 整层重编号，不是交换两个 order：两条 order 恰好相同时交换等于什么都没动
  return ordered.reduce(
    (next, item, index) =>
      updateEntity(next, 'hierNodes', item.id, { order: index }),
    config,
  )
}
