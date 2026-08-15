/**
 * @fileoverview 图层树的纯逻辑：把排版摊平表按折叠状态摊成一张行清单，
 * 以及把一次拖放换算成 `moveNode` 的入参。
 * ⚠ 落位下标按**去掉被拖节点之后**的同层序列算：`moveNode` 也是先摘再插，
 * 两边口径不一致时，同层内往前拖会稳定地差一格。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'

import type { EditorFrame } from '@/features/dashboard/editorLayout'
import { nodeLabelOf } from '@/features/dashboard/nodeLabel'

/** 祖先链遍历的护栏，脏数据成环时不至于转不出来。 */
const MAX_WALK = 64

/** 图层树里的一行。 */
export interface LayerRow {
  id: string
  depth: number
  node: DashboardNodePayload
  label: string
  icon: string
  isContainer: boolean
  hasChildren: boolean
  /** 自己或祖先被隐藏，画布上看不见。 */
  isDimmed: boolean
}

/** 落点相对目标行的位置。 */
export type DropPos = 'before' | 'inside' | 'after'

/** 一次拖放换算出的落位：`at` 为 null 表示排到目标层最上面。 */
export interface DropTarget {
  parentId: string | null
  at: number | null
}

/** 一行的静态部分。 */
function rowOf(
  frame: EditorFrame,
  node: DashboardNodePayload,
  getManifest: GetModuleManifest,
  hasChildren: boolean,
): LayerRow {
  const manifest = getManifest(node.moduleType)
  return {
    id: frame.id,
    depth: frame.depth,
    node,
    label: nodeLabelOf(node, getManifest),
    icon: manifest?.icon ?? 'layout-grid',
    isContainer: manifest?.isContainer === true,
    hasChildren,
    isDimmed: !frame.isVisible,
  }
}

/**
 * 摊成行清单：折叠掉的子树整段不出现。
 * ⚠ 同层**按 z 倒序**列：排在上面的行就是画布上盖在上面的那个，
 * 顺着列的话「往上拖」得到的是往下压，这条视觉约定错了整棵树都读反。
 * @param collapsed 已折叠的节点 id
 */
export function layerRows(
  frames: readonly EditorFrame[],
  nodes: readonly DashboardNodePayload[],
  getManifest: GetModuleManifest,
  collapsed: ReadonlySet<string>,
): LayerRow[] {
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  const byParent = new Map<string | null, EditorFrame[]>()
  for (const frame of frames) {
    const node = byId.get(frame.id)
    if (node === undefined) continue
    const bucket = byParent.get(node.parentId)
    if (bucket === undefined) byParent.set(node.parentId, [frame])
    else bucket.push(frame)
  }
  const rows: LayerRow[] = []
  const walk = (parentId: string | null): void => {
    const bucket = byParent.get(parentId) ?? []
    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      const frame = bucket[index]
      const node = frame === undefined ? undefined : byId.get(frame.id)
      if (frame === undefined || node === undefined) continue
      rows.push(rowOf(frame, node, getManifest, byParent.has(frame.id)))
      if (!collapsed.has(frame.id)) walk(frame.id)
    }
  }
  walk(null)
  return rows
}

/** 目标是不是拖动节点自己或它的后代——挪进自己的子树会造出一个环。 */
export function isOwnSubtree(
  nodes: readonly DashboardNodePayload[],
  candidate: string | null,
  rootId: string,
): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  let cursor = candidate
  for (let step = 0; cursor !== null && step < MAX_WALK; step += 1) {
    if (cursor === rootId) return true
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return false
}

/**
 * 指针落在行的哪一段：容器行按三等分（中段 = 进容器），其余按二等分。
 * @param offsetY 指针相对行顶的偏移
 */
export function dropPosition(
  offsetY: number,
  height: number,
  isContainer: boolean,
): DropPos {
  if (isContainer) {
    if (offsetY < height / 3) return 'before'
    return offsetY > (height * 2) / 3 ? 'after' : 'inside'
  }
  return offsetY < height / 2 ? 'before' : 'after'
}

/** 一次拖放的落位；不合法（自己、或自己的子树）返回 null。 */
export function resolveDrop(
  nodes: readonly DashboardNodePayload[],
  movingId: string,
  target: { id: string; parentId: string | null },
  pos: DropPos,
): DropTarget | null {
  if (movingId === target.id) return null
  if (pos === 'inside') {
    return isOwnSubtree(nodes, target.id, movingId)
      ? null
      : { parentId: target.id, at: null }
  }
  if (isOwnSubtree(nodes, target.parentId, movingId)) return null
  const order = nodes
    .filter((node) => node.parentId === target.parentId && node.id !== movingId)
    .sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.id.localeCompare(right.id),
    )
    .map((node) => node.id)
  const index = order.indexOf(target.id)
  if (index < 0) return null
  // ⚠ 树是倒序列的：落在目标行**上方**要的是更靠上的层，也就是 z 序里排在它后面
  return { parentId: target.parentId, at: pos === 'before' ? index + 1 : index }
}
