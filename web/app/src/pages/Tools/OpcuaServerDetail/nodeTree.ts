/**
 * @fileoverview 把扁平节点列表折成树。纯函数，可整体单测。
 *
 * ⚠ 父节点不在本页数据里时（分页切断了父子），子节点**必须仍然出现**，
 * 挂到根上并标出来——静默丢掉整棵子树会让人以为节点没建成功。
 */

import type { OpcuaNode } from '@dt/contracts'

export interface NodeTreeItem {
  node: OpcuaNode
  depth: number
  children: NodeTreeItem[]
  /** 父节点不在当前数据集里，这一支是被截断后挂到根上的。 */
  isOrphan: boolean
}

/**
 * @param nodes 扁平节点数组
 */
export function buildNodeTree(nodes: readonly OpcuaNode[]): NodeTreeItem[] {
  // 一次建好，顺带留一份原序数组——不用再按 id 回查，也就没有「查不到」这种
  // 逻辑上不可能、却要写一个测不到的分支去挡的情况
  const items = new Map<string, NodeTreeItem>()
  const ordered: NodeTreeItem[] = []
  for (const node of nodes) {
    const item: NodeTreeItem = {
      node,
      depth: 0,
      children: [],
      isOrphan: false,
    }
    items.set(node.id, item)
    ordered.push(item)
  }

  const roots: NodeTreeItem[] = []
  for (const item of ordered) {
    const parentId = item.node.parent_id
    const parent = parentId === null ? undefined : items.get(parentId)
    if (parent === undefined) {
      item.isOrphan = parentId !== null
      roots.push(item)
    } else {
      parent.children.push(item)
    }
  }

  const assignDepth = (list: NodeTreeItem[], depth: number): void => {
    for (const item of list) {
      item.depth = depth
      assignDepth(item.children, depth + 1)
    }
  }
  assignDepth(roots, 0)
  return roots
}

/** 深度优先摊平，用于渲染成缩进列表。 */
export function flattenNodeTree(
  roots: readonly NodeTreeItem[],
): NodeTreeItem[] {
  const out: NodeTreeItem[] = []
  const walk = (list: readonly NodeTreeItem[]): void => {
    for (const item of list) {
      out.push(item)
      walk(item.children)
    }
  }
  walk(roots)
  return out
}
