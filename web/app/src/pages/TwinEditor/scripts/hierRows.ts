/**
 * @fileoverview 钻取树摊成带缩进的行清单，供左栏层级页签渲染。
 * 判断全在这里、组件只管画，折叠、能不能挪、能不能拖进去这几条才测得动。
 */
import {
  type TwinHierNode,
  type TwinHierTreeNode,
  buildHierTree,
  childrenOf,
} from '@dt/twin-config'

import { isHierDescendant } from './hierOps'

/** 层级页签上的一行。 */
export interface TwinHierRow {
  /** ⚠ 必须带深度与位次：id 允许重复（重复由诊断报出来），只用 id 做 key 会让
   * 两行共用一个 key，Vue 的就地复用于是把这两行的展开态串在一起。 */
  key: string
  id: string
  /** 缩进层数，根是 0。 */
  depth: number
  /** 显示名；名字空着退回 id。 */
  label: string
  icon: string
  /** 名字后面的补充信息：有子层报子层数，叶子报字段数。 */
  meta: string
  hasChildren: boolean
  collapsed: boolean
  /** 有诊断问题，行上打红点。 */
  flagged: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}

/** 节点没配图标时卡片与树上都用它。 */
export const HIER_DEFAULT_ICON = 'folder'

function rowOf(
  entry: TwinHierTreeNode,
  depth: number,
  index: number,
  siblings: number,
): Omit<TwinHierRow, 'collapsed' | 'flagged'> {
  const node = entry.node
  const children = entry.children.length
  return {
    key: `${depth}:${index}:${node.id}`,
    id: node.id,
    depth,
    label: node.name === '' ? node.id : node.name,
    icon: node.icon === '' ? HIER_DEFAULT_ICON : node.icon,
    meta: children > 0 ? `${children} 子层` : `${node.fields.length} 字段`,
    hasChildren: children > 0,
    canMoveUp: index > 0,
    canMoveDown: index < siblings - 1,
  }
}

/** 一层层往下摊；折叠的那一支不往下走。 */
function pushLevel(
  out: TwinHierRow[],
  level: readonly TwinHierTreeNode[],
  depth: number,
  view: { collapsed: ReadonlySet<string>; flagged: ReadonlySet<string> },
): void {
  level.forEach((entry, index) => {
    const collapsed = view.collapsed.has(entry.node.id)
    out.push({
      ...rowOf(entry, depth, index, level.length),
      collapsed,
      flagged: view.flagged.has(entry.node.id),
    })
    if (!collapsed) pushLevel(out, entry.children, depth + 1, view)
  })
}

/**
 * 钻取树摊成行。
 * ⚠ 成环的那几个节点从任何根都走不到，这里也就列不出来——它们由诊断面板的
 * 「钻取成环」报出来，别指望在树上看见。
 * @param nodes 归一化后的全部钻取节点
 * @param collapsed 折叠起来的节点 id
 * @param flagged 有诊断问题的实体 id
 */
export function buildHierRows(
  nodes: readonly TwinHierNode[],
  collapsed: ReadonlySet<string>,
  flagged: ReadonlySet<string>,
): TwinHierRow[] {
  const out: TwinHierRow[] = []
  pushLevel(out, buildHierTree(nodes), 0, { collapsed, flagged })
  return out
}

/**
 * 这个节点能不能拖到那个节点下面。
 * ⚠ 拖进自己的子树里会立刻成环，而成环的那几层从任何根都走不到，在钻取里
 * **整片消失**——所以拖拽时就要挡住，不能等诊断事后报。
 * @param nodes 归一化后的全部钻取节点
 * @param draggingId 被拖的节点
 * @param targetId 落点节点；null = 提到顶层
 */
export function canDropHierOn(
  nodes: readonly TwinHierNode[],
  draggingId: string,
  targetId: string | null,
): boolean {
  if (draggingId === '') return false
  if (targetId === null) {
    const node = nodes.find((item) => item.id === draggingId)
    return node !== undefined && node.parentId !== null
  }
  if (draggingId === targetId) return false
  return !isHierDescendant(nodes, draggingId, targetId)
}

/**
 * 上一层的候选：全部节点减掉自己与自己的子树。
 * ⚠ 少减一条，用户就能在下拉里把自己挂到自己下面，而成环的那几层会从钻取里
 * 整片消失。
 * @param nodes 归一化后的全部钻取节点
 * @param id 正在改上一层的节点
 */
export function hierParentCandidates(
  nodes: readonly TwinHierNode[],
  id: string,
): TwinHierNode[] {
  return nodes.filter((item) => !isHierDescendant(nodes, id, item.id))
}

/** 某一层直接下级的条数，检查器要用它决定「隐藏子项列表」显不显示。 */
export function hierChildCount(
  nodes: readonly TwinHierNode[],
  id: string,
): number {
  return childrenOf(nodes, id).length
}
