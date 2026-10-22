/** @fileoverview 地址空间展开行的扁平索引与虚拟窗口。 */
import type { TreeNode } from './browseTree'

export const BROWSE_ROW_HEIGHT = 32
export const BROWSE_OVERSCAN = 6
export const BROWSE_INITIAL_HEIGHT = 480

export type BrowseRow =
  | {
      kind: 'node'
      key: string
      node: TreeNode
      depth: number
      path: readonly string[]
    }
  | { kind: 'error'; key: string; node: TreeNode; depth: number }
  | {
      kind: 'more'
      key: string
      address: string | null
      name: string
      isLoading: boolean
      depth: number
    }

/** 只索引展开着的节点，避免递归组件为整棵子树创建 DOM。 */
export function visibleBrowseRows(
  roots: readonly TreeNode[],
  nextToken: string | null,
  isLoadingMore: boolean,
): BrowseRow[] {
  const rows: BrowseRow[] = []
  const pending: BrowseRow[] = []
  if (nextToken !== null) {
    pending.push(moreRow(null, '根节点', isLoadingMore, []))
  }
  pushNodes(pending, roots, [])
  while (pending.length > 0) {
    const row = pending.pop()
    if (row === undefined) break
    rows.push(row)
    if (row.kind !== 'node') continue
    const node = row.node
    if (node.isOpen) {
      if (node.nextToken !== null || node.isIncomplete) {
        pending.push(moreRow(node.address, node.name, node.isLoading, row.path))
      }
      pushNodes(pending, node.children ?? [], row.path)
    }
    if (node.error !== null) {
      pending.push({
        kind: 'error',
        key: rowKey('error', row.path),
        node,
        depth: row.depth + 1,
      })
    }
  }
  return rows
}

function pushNodes(
  pending: BrowseRow[],
  nodes: readonly TreeNode[],
  parentPath: readonly string[],
): void {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node !== undefined) {
      const path = [...parentPath, node.address]
      pending.push({
        kind: 'node',
        key: rowKey('node', path),
        node,
        depth: parentPath.length,
        path,
      })
    }
  }
}

function moreRow(
  address: string | null,
  name: string,
  isLoading: boolean,
  path: readonly string[],
): BrowseRow {
  return {
    kind: 'more',
    key: rowKey('more', path),
    address,
    name,
    isLoading,
    depth: path.length,
  }
}

// ⚠ OPC UA 多父引用共享寻址串，挂载身份必须包含祖先路径。
function rowKey(kind: BrowseRow['kind'], path: readonly string[]): string {
  return `${kind}:${JSON.stringify(path)}`
}

/** 取当前视口及前后缓冲行；数据缩短时把窗口夹回有效范围。 */
export function browseWindow(
  total: number,
  scrollTop: number,
  height: number,
): { start: number; end: number } {
  const safeTop = Math.max(
    0,
    Math.min(scrollTop, total * BROWSE_ROW_HEIGHT - height),
  )
  return {
    start: Math.max(
      0,
      Math.floor(safeTop / BROWSE_ROW_HEIGHT) - BROWSE_OVERSCAN,
    ),
    end: Math.min(
      total,
      Math.ceil((safeTop + height) / BROWSE_ROW_HEIGHT) + BROWSE_OVERSCAN,
    ),
  }
}
