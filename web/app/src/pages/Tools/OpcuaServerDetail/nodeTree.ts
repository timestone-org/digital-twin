/**
 * @fileoverview 把扁平节点列表折成树，并算出「当前该渲染哪几行」。纯函数，可整体单测。
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
 * 摊平后的一行。渲染与键盘漫游都只认这个形状。
 *
 * ⚠ `setSize` / `posInSet` 不是可选的装饰：DOM 摊平之后，屏幕阅读器无法再
 * 从嵌套结构推断「本层共几项、这是第几项」，必须由这两个值显式给出。
 */
export interface NodeTreeRow {
  node: OpcuaNode
  depth: number
  hasChildren: boolean
  isExpanded: boolean
  isOrphan: boolean
  /** 同层兄弟的总数。 */
  setSize: number
  /** 在同层兄弟里排第几，从 1 起。 */
  posInSet: number
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

/**
 * 关键词是否命中这个节点。BrowseName、标识与完整 NodeId 都算。
 *
 * ⚠ 标识与 NodeId 也要参与匹配：现场排查时手里往往只有上位机组态里的
 * `ns=2;s=Line1.Temp`，按 BrowseName 是搜不到的。
 *
 * @param node 节点
 * @param keyword 已 trim 的关键词，空串视为全部命中
 */
export function matchesKeyword(node: OpcuaNode, keyword: string): boolean {
  const needle = keyword.toLowerCase()
  if (needle === '') return true
  return (
    node.browse_name.toLowerCase().includes(needle) ||
    node.identifier.toLowerCase().includes(needle) ||
    node.node_id.toLowerCase().includes(needle)
  )
}

/**
 * 按关键词裁剪整棵树。
 *
 * ⚠ 命中节点的**祖先必须保留**，否则搜出来的东西没有上下文，看不出它挂在
 * 哪个对象下——而地址空间里同名的 `Temperature` 常常有好几个。
 *
 * @param roots 完整树的根
 * @param keyword 关键词，空串原样返回
 */
export function filterNodeTree(
  roots: readonly NodeTreeItem[],
  keyword: string,
): NodeTreeItem[] {
  const needle = keyword.trim()
  if (needle === '') return [...roots]

  const keep = (item: NodeTreeItem, depth: number): NodeTreeItem | null => {
    const children: NodeTreeItem[] = []
    for (const child of item.children) {
      const kept = keep(child, depth + 1)
      if (kept !== null) children.push(kept)
    }
    if (children.length === 0 && !matchesKeyword(item.node, needle)) {
      return null
    }
    return { node: item.node, depth, children, isOrphan: item.isOrphan }
  }

  const out: NodeTreeItem[] = []
  for (const root of roots) {
    const kept = keep(root, 0)
    if (kept !== null) out.push(kept)
  }
  return out
}

/**
 * 当前可见的行。折叠起来的分支整枝不产出。
 *
 * @param roots 树的根
 * @param expanded 已展开的节点 id
 * @param expandAll 忽略折叠状态全部展开（搜索时用：搜出来却看不见等于没搜）
 */
export function visibleRows(
  roots: readonly NodeTreeItem[],
  expanded: ReadonlySet<string>,
  expandAll = false,
): NodeTreeRow[] {
  const out: NodeTreeRow[] = []
  const walk = (list: readonly NodeTreeItem[]): void => {
    list.forEach((item, index) => {
      const hasChildren = item.children.length > 0
      const isExpanded =
        hasChildren && (expandAll || expanded.has(item.node.id))
      out.push({
        node: item.node,
        depth: item.depth,
        hasChildren,
        isExpanded,
        isOrphan: item.isOrphan,
        setSize: list.length,
        posInSet: index + 1,
      })
      if (isExpanded) walk(item.children)
    })
  }
  walk(roots)
  return out
}

/** 树里所有「有子节点」的 id——一键展开全部时用。 */
export function expandableIds(roots: readonly NodeTreeItem[]): string[] {
  const out: string[] = []
  const walk = (list: readonly NodeTreeItem[]): void => {
    for (const item of list) {
      if (item.children.length > 0) {
        out.push(item.node.id)
        walk(item.children)
      }
    }
  }
  walk(roots)
  return out
}

/** 从根到该节点的全部祖先 id。选中深处的节点后要把这条路展开。 */
export function ancestorIds(
  roots: readonly NodeTreeItem[],
  nodeId: string,
): string[] {
  const path: string[] = []
  const walk = (list: readonly NodeTreeItem[], trail: string[]): boolean => {
    for (const item of list) {
      if (item.node.id === nodeId) {
        path.push(...trail)
        return true
      }
      if (walk(item.children, [...trail, item.node.id])) return true
    }
    return false
  }
  walk(roots, [])
  return path
}
