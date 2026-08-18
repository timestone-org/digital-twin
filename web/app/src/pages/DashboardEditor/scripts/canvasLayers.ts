/**
 * @fileoverview 画布的层坐标系：把排版结果摊成「每个节点连它所在层的原点与边界」，
 * 据此回答落点在哪个容器、参考线的候选是谁、框选套住了谁。
 * ⚠ 容器的子层原点 = 容器矩形左上角 + 内容区内缩，只加这一次；
 * 子节点自己的坐标已经是相对这个原点的了（`editorLayout` 同一条注意）。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import { resolveContentInset } from '@dt/modules'
import {
  resolveModuleConfig,
  type DesignSize,
  type GetModuleManifest,
  type ModuleRect,
  type NodeBox,
} from '@dt/runtime'

import { rectsOverlap } from '@/features/dashboard/canvasAlign'
import type {
  EditorGridConfig,
  ResizeDir,
  SnapConfig,
} from '@/features/dashboard/canvasSnap'
import { subtreeIds, topMostIds } from '@/features/dashboard/editorDoc'
import {
  contentSizeOf,
  type EditorFrame,
} from '@/features/dashboard/editorLayout'
import {
  acceptsChildren,
  isPinnedRegion,
} from '@/features/dashboard/moduleLibrary'
import type { DragItem, DragKind, DragSession, DropTarget } from './canvasDrag'

/** 清单没声明最小边长时的下限（设计像素）：拖成 0 之后就再也点不中了。 */
const MIN_SIDE_PX = 24

/** 一个节点在画布上的落位：绝对矩形 + 它所在层与它自己的子层。 */
export interface CanvasPlacement {
  node: DashboardNodePayload
  frame: EditorFrame
  /** 本层原点在画布上的绝对坐标。 */
  originX: number
  originY: number
  /** 本层边界尺寸。 */
  layer: DesignSize
  /** 容器的内容区矩形（绝对）；不接子节点的为 null。 */
  content: ModuleRect | null
  isPinned: boolean
  minW: number
  minH: number
}

/**
 * 摊平成落位表，父在子前。
 * @param input 全部节点、排版结果、顶层设计尺寸与清单解析器
 */
export function buildPlacements(input: {
  nodes: readonly DashboardNodePayload[]
  frames: readonly EditorFrame[]
  design: DesignSize
  getManifest: GetModuleManifest
}): CanvasPlacement[] {
  const byId = new Map(input.nodes.map((node) => [node.id, node] as const))
  const childLayer = new Map<string, DesignSize>()
  const placements: CanvasPlacement[] = []
  for (const frame of input.frames) {
    const node = byId.get(frame.id)
    if (node === undefined) continue
    const placement = placementOf(frame, node, input, childLayer)
    childLayer.set(
      node.id,
      placement.content ?? { width: frame.width, height: frame.height },
    )
    placements.push(placement)
  }
  return placements
}

/** 一格的落位：容器另算内容区，层边界取父节点的子层（顶层就是设计尺寸）。 */
function placementOf(
  frame: EditorFrame,
  node: DashboardNodePayload,
  input: { design: DesignSize; getManifest: GetModuleManifest },
  childLayer: ReadonlyMap<string, DesignSize>,
): CanvasPlacement {
  const manifest = input.getManifest(node.moduleType)
  const size = contentSizeOf(node, manifest)
  const parentLayer =
    node.parentId === null ? undefined : childLayer.get(node.parentId)
  return {
    node,
    frame,
    // 本层原点由排版结果反推：`frame.left = 原点 + node.x`，比再算一遍内缩稳
    originX: frame.left - node.x,
    originY: frame.top - node.y,
    layer: parentLayer ?? input.design,
    content: acceptsChildren(manifest)
      ? containerContentRect(frame, node, size, input.getManifest)
      : null,
    isPinned: isPinnedRegion(manifest),
    minW: manifest?.defaultSize.minWidth ?? MIN_SIDE_PX,
    minH: manifest?.defaultSize.minHeight ?? MIN_SIDE_PX,
  }
}

/** 容器的内容区矩形；空容器也要算得出来，所以走内缩而不是反推子节点。 */
function containerContentRect(
  frame: EditorFrame,
  node: DashboardNodePayload,
  size: DesignSize,
  getManifest: GetModuleManifest,
): ModuleRect {
  const manifest = getManifest(node.moduleType)
  const inset = resolveContentInset(
    resolveModuleConfig(manifest, node.configJson),
  )
  return {
    left: frame.left + inset.left,
    top: frame.top + inset.top,
    width: size.width,
    height: size.height,
  }
}

/** 落位 → 拖动项。 */
export function dragItemOf(placement: CanvasPlacement): DragItem {
  const { node } = placement
  return {
    nodeId: node.id,
    parentId: node.parentId,
    start: { x: node.x, y: node.y, w: node.w, h: node.h },
    originX: placement.originX,
    originY: placement.originY,
    layer: placement.layer,
    minW: placement.minW,
    minH: placement.minH,
    isPinned: placement.isPinned,
  }
}

function pointInRect(at: { x: number; y: number }, rect: ModuleRect): boolean {
  return (
    at.x >= rect.left &&
    at.x <= rect.left + rect.width &&
    at.y >= rect.top &&
    at.y <= rect.top + rect.height
  )
}

/**
 * 落点命中的**最深**容器；命中不到返回 null（= 顶层）。
 * @param excluded 拖动子树，落回自己里面会把节点挂成自己的后代
 */
export function containerAt(
  placements: readonly CanvasPlacement[],
  at: { x: number; y: number },
  excluded: ReadonlySet<string>,
): CanvasPlacement | null {
  let deepest: CanvasPlacement | null = null
  for (const placement of placements) {
    const { content } = placement
    if (content === null || !placement.frame.isVisible) continue
    if (excluded.has(placement.node.id)) continue
    if (!pointInRect(at, content)) continue
    if (deepest === null || placement.frame.depth >= deepest.frame.depth) {
      deepest = placement
    }
  }
  return deepest
}

/** 智能参考线的候选：锚点的同父兄弟（排除拖动子树）加上本层的边界矩形。 */
export function guideCandidates(
  placements: readonly CanvasPlacement[],
  anchor: DragItem,
  excluded: ReadonlySet<string>,
): ModuleRect[] {
  const found: ModuleRect[] = placements
    .filter(
      (placement) =>
        placement.node.parentId === anchor.parentId &&
        !excluded.has(placement.node.id) &&
        placement.frame.isVisible,
    )
    .map((placement) => ({
      left: placement.frame.left,
      top: placement.frame.top,
      width: placement.frame.width,
      height: placement.frame.height,
    }))
  found.push({
    left: anchor.originX,
    top: anchor.originY,
    width: anchor.layer.width,
    height: anchor.layer.height,
  })
  return found
}

/**
 * 落点所在的层：命中容器就取它的内容区，命中不到就是顶层。
 * @param excluded 拖动子树；落回自己里面会把节点挂成自己的后代
 */
export function dropTargetOf(input: {
  placements: readonly CanvasPlacement[]
  at: { x: number; y: number }
  excluded: ReadonlySet<string>
  design: DesignSize
}): DropTarget {
  const target = containerAt(input.placements, input.at, input.excluded)
  const content = target?.content ?? null
  if (target === null || content === null) {
    return { parentId: null, originX: 0, originY: 0, layer: input.design }
  }
  return {
    parentId: target.node.id,
    originX: content.left,
    originY: content.top,
    layer: { width: content.width, height: content.height },
  }
}

/** 某个容器的内容区矩形；不是容器或找不到就是 null。 */
export function contentRectOf(
  placements: readonly CanvasPlacement[],
  nodeId: string | null,
): ModuleRect | null {
  if (nodeId === null) return null
  return placements.find((item) => item.node.id === nodeId)?.content ?? null
}

/** 画布上一格的渲染入参：选中态、钉位方向与层叠顺序。 */
export interface CanvasItem {
  placement: CanvasPlacement
  isSelected: boolean
  /** 钉位节点只许动一条边：贴顶的给下边、贴底的给上边。 */
  pinnedEdge: 'top' | 'bottom' | null
  zIndex: number
}

/** 选中的节点抬到最上面，免得被没选中的兄弟盖住抓不着。 */
const SELECTED_Z_BOOST = 10000

export function renderItems(
  placements: readonly CanvasPlacement[],
  selectedIds: readonly string[],
): CanvasItem[] {
  const selected = new Set(selectedIds)
  return placements.map((placement) => {
    const isSelected = selected.has(placement.node.id)
    return {
      placement,
      isSelected,
      // 按位置判定钉在哪边，不认具体的区域名——认了具体取值编辑器就又认识某个模块了
      pinnedEdge: !placement.isPinned
        ? null
        : placement.frame.top <= 0
          ? 'bottom'
          : 'top',
      zIndex:
        placement.frame.depth * 100 +
        placement.node.zIndex +
        (isSelected ? SELECTED_Z_BOOST : 0),
    }
  })
}

/** 画布当前的文档态：拖动要用到的那几项，画布组件的 props 直接满足它。 */
export interface CanvasDocument {
  nodes: readonly DashboardNodePayload[]
  selectedIds: readonly string[]
  snap: SnapConfig
  grid: EditorGridConfig
}

/**
 * 起一次拖动会话：按下的若是多选集里的一个就整体拖最上层那些，否则只拖它自己。
 * @param input 落位表、被按下的那个、这次手势与当前文档态
 */
export function buildSession(input: {
  placements: readonly CanvasPlacement[]
  placement: CanvasPlacement
  kind: DragKind
  dir: ResizeDir
  event: PointerEvent
  doc: CanvasDocument
}): DragSession {
  const { doc } = input
  const anchor = dragItemOf(input.placement)
  const wasMulti =
    doc.selectedIds.length > 1 && doc.selectedIds.includes(anchor.nodeId)
  const items =
    input.kind === 'move' && wasMulti
      ? batchItems(input.placements, doc, anchor)
      : [anchor]
  const excluded = new Set(
    items.flatMap((item) => subtreeIds(doc.nodes, item.nodeId)),
  )
  return {
    kind: input.kind,
    dir: input.dir,
    clientX: input.event.clientX,
    clientY: input.event.clientY,
    anchor,
    items,
    excluded,
    candidates: guideCandidates(input.placements, anchor, excluded),
    snap: doc.snap,
    grid: doc.grid,
    wasMulti,
    moved: false,
  }
}

/** 整体拖动的成员：最上层的那些选中根，钉位节点不跟着走。 */
function batchItems(
  placements: readonly CanvasPlacement[],
  doc: CanvasDocument,
  anchor: DragItem,
): DragItem[] {
  const byId = new Map(placements.map((item) => [item.node.id, item] as const))
  const items = topMostIds(doc.nodes, doc.selectedIds)
    .map((id) => byId.get(id))
    .filter(
      (item): item is CanvasPlacement => item !== undefined && !item.isPinned,
    )
    .map(dragItemOf)
  return items.some((item) => item.nodeId === anchor.nodeId) ? items : [anchor]
}

/** 与框**相交**（不必被套住）的可见节点 id。 */
export function marqueeHits(
  placements: readonly CanvasPlacement[],
  box: NodeBox,
): string[] {
  return placements
    .filter(
      (placement) =>
        placement.frame.isVisible &&
        rectsOverlap(box, {
          x: placement.frame.left,
          y: placement.frame.top,
          w: placement.frame.width,
          h: placement.frame.height,
        }),
    )
    .map((placement) => placement.node.id)
}
