/**
 * @fileoverview 画布上那些「动一下就改图」的动作：对齐、分布、剪贴板、整理、
 * 微调、断线。右键菜单与快捷键**共用同一份**——两套实现迟早会各自漂移，而漂移
 * 的表现是「菜单能用、快捷键不能用」这种只在某一条路径上出现的怪事。
 */
import type { useToast } from '@dt/ui'

import { layoutGraph } from './autoLayout'
import type { GraphClip } from './clipboard'
import { clipOf, readClip, writeClip } from './clipboard'
import type { AlignKind, NodeRect } from './nodeLayout'
import { alignTo, distributeAlong } from './nodeLayout'
import type { useCanvasSelection } from './useCanvasSelection'
import type { CanvasPoint } from './useCanvasViewport'
import type { useModelingGraph } from './useModelingGraph'

/** 再制时相对原件错开多少。 */
const DUPLICATE_OFFSET = 40

/** 画布组件暴露出来的那几件事，动作要靠它拿实测几何。 */
export interface CanvasHandle {
  fit: () => void
  rects: () => NodeRect[]
  sizes: () => ReadonlyMap<string, { width: number; height: number }>
  center: () => CanvasPoint
}

export interface CanvasActionDeps {
  graph: ReturnType<typeof useModelingGraph>
  selection: ReturnType<typeof useCanvasSelection>
  /** 画布还没挂上时给 null。 */
  canvas: () => CanvasHandle | null
  toast: ReturnType<typeof useToast>
}

/** 选中的那些卡片的实测矩形。画布还没挂上时给空。 */
function selectedRects(deps: CanvasActionDeps): NodeRect[] {
  const wanted = new Set(deps.selection.selectedNodeIds.value)
  return (deps.canvas()?.rects() ?? []).filter((rect) => wanted.has(rect.id))
}

/** 一份载荷落到视野正中时，整组该平移多少。 */
function shiftToCenter(clip: GraphClip, center: CanvasPoint): CanvasPoint {
  const left = Math.min(...clip.nodes.map((node) => node.position.left))
  const top = Math.min(...clip.nodes.map((node) => node.position.top))
  return { left: center.left - left, top: center.top - top }
}

/** 对齐与等距分布。 */
function arrangeActions(deps: CanvasActionDeps) {
  return {
    align: (kind: AlignKind): void => {
      const moves = alignTo(selectedRects(deps), kind)
      if (moves.size > 0) deps.graph.moveNodes(moves)
    },
    spread: (axis: 'x' | 'y'): void => {
      const moves = distributeAlong(selectedRects(deps), axis)
      if (moves.size > 0) deps.graph.moveNodes(moves)
    },
    autoLayout: (): void => {
      const sizes = deps.canvas()?.sizes()
      if (sizes === undefined) return
      const moves = layoutGraph(deps.graph.graph.value, sizes)
      if (moves.size > 0) deps.graph.moveNodes(moves)
    },
    nudge: (deltaLeft: number, deltaTop: number): void => {
      const moves = new Map<string, CanvasPoint>()
      for (const rect of selectedRects(deps)) {
        moves.set(rect.id, {
          left: rect.left + deltaLeft,
          top: rect.top + deltaTop,
        })
      }
      if (moves.size > 0) deps.graph.moveNodes(moves)
    },
  }
}

/** 复制、粘贴、再制。 */
function clipboardActions(deps: CanvasActionDeps) {
  const { graph, selection, toast } = deps
  return {
    copy: (): void => {
      const clip = clipOf(
        graph.graph.value.nodes,
        graph.graph.value.edges,
        selection.selectedNodeIds.value,
      )
      if (clip === null) {
        toast.info('先选中要复制的节点')
        return
      }
      writeClip(clip)
      toast.success(`已复制 ${clip.nodes.length} 个节点，可粘到别的流水线里`)
    },
    paste: (): void => {
      const clip = readClip()
      if (clip === null) {
        toast.info('剪贴板里没有可粘贴的节点')
        return
      }
      const center = deps.canvas()?.center() ?? { left: 80, top: 80 }
      const pasted = graph.paste(
        clip.nodes,
        clip.edges,
        shiftToCenter(clip, center),
      )
      selection.selectNodes(pasted)
    },
    duplicate: (): void => {
      const clip = clipOf(
        graph.graph.value.nodes,
        graph.graph.value.edges,
        selection.selectedNodeIds.value,
      )
      if (clip === null) return
      const pasted = graph.paste(clip.nodes, clip.edges, {
        left: DUPLICATE_OFFSET,
        top: DUPLICATE_OFFSET,
      })
      selection.selectNodes(pasted)
    },
  }
}

/** 删除与断线。 */
function removalActions(deps: CanvasActionDeps) {
  const { graph, selection } = deps
  return {
    removeSelected: (): void => {
      graph.removeSelection(
        selection.selectedNodeIds.value,
        selection.selectedEdgeIds.value,
      )
      selection.clear()
    },
    removeEdge: (id: string): void => {
      graph.removeEdges([id])
      selection.clear()
    },
    /** 拆掉接进这个节点的全部线，好把它挪到别处重接。 */
    disconnect: (nodeId: string): void => {
      const gone = graph.graph.value.edges
        .filter((edge) => edge.to_node === nodeId)
        .map((edge) => edge.id)
      if (gone.length > 0) graph.removeEdges(gone)
    },
    selectAll: (): void => {
      selection.selectNodes(graph.nodeIds.value)
    },
  }
}

export function useCanvasActions(deps: CanvasActionDeps) {
  return {
    ...arrangeActions(deps),
    ...clipboardActions(deps),
    ...removalActions(deps),
    fit: (): void => deps.canvas()?.fit(),
    /** 剪贴板里有没有东西——右键菜单据此置灰「粘贴」。 */
    canPaste: (): boolean => readClip() !== null,
  }
}
