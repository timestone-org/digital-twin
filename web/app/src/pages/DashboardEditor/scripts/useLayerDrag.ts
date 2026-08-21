/**
 * @fileoverview 图层树的拖拽换父：把「指针落在这一行的哪一段」换算成一次 `move`。
 * 落点判定与合法性在 `layerTree.ts`，这里只管事件与那一点点拖拽态。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import { ref, type Ref } from 'vue'

import { dropPosition, resolveDrop } from './layerTree'
import type { DropPos, LayerRow } from './layerTree'

/**
 * 图层树自己的拖拽载荷类型：用自定义 MIME 而不是 text/plain，
 * 否则从别处拖进来的任意文本都会被当成一次换父。
 */
const LAYER_DRAG_MIME = 'application/x-dt-layer-node'

export interface LayerDrag {
  /** 正悬停在哪一行的哪一段，用来画插入线；没在拖是 null。 */
  dropAt: Ref<{ id: string; pos: DropPos } | null>
  onDragStart: (event: DragEvent, nodeId: string) => void
  onDragOver: (event: DragEvent, row: LayerRow) => void
  onDrop: (event: DragEvent, row: LayerRow) => void
  /** 拖到列表末尾的落区：移出所有容器，回到顶层。 */
  onRootDrop: (event: DragEvent) => void
}

/** 指针落在这一行的哪一段；行高得当场量，happy-dom 之外才有真实布局。 */
function posOf(event: DragEvent, row: LayerRow): DropPos {
  // currentTarget 是挂着本 handler 的行元素，恒为 HTMLElement；类型上只是 EventTarget | null
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return dropPosition(event.clientY - box.top, box.height, row.isContainer)
}

/** 这一次落点换算成 `move` 的入参；落点不合法给 null。 */
function targetOf(
  nodes: readonly DashboardNodePayload[],
  moving: string,
  row: LayerRow,
  pos: DropPos,
) {
  return resolveDrop(
    nodes,
    moving,
    { id: row.id, parentId: row.node.parentId },
    pos,
  )
}

/**
 * @param nodes 当前节点表，落点合法性要按它判（不能把父拖进自己的子树）
 * @param onMove 判定出一次合法换父后调用
 */
export function useLayerDrag(
  nodes: () => readonly DashboardNodePayload[],
  onMove: (nodeId: string, parentId: string | null, at?: number) => void,
): LayerDrag {
  const dragId = ref<string | null>(null)
  const dropAt = ref<{ id: string; pos: DropPos } | null>(null)

  return {
    dropAt,

    onDragStart: (event, nodeId) => {
      dragId.value = nodeId
      if (event.dataTransfer === null) return
      event.dataTransfer.setData(LAYER_DRAG_MIME, nodeId)
      event.dataTransfer.effectAllowed = 'move'
    },

    onDragOver: (event, row) => {
      const moving = dragId.value
      const pos = posOf(event, row)
      if (moving === null || targetOf(nodes(), moving, row, pos) === null) {
        dropAt.value = null
        return
      }
      event.preventDefault()
      dropAt.value = { id: row.id, pos }
    },

    onDrop: (event, row) => {
      event.preventDefault()
      const moving = dragId.value
      const pos = posOf(event, row)
      const target =
        moving === null ? null : targetOf(nodes(), moving, row, pos)
      dropAt.value = null
      dragId.value = null
      if (moving === null || target === null) return
      if (target.at === null) onMove(moving, target.parentId)
      else onMove(moving, target.parentId, target.at)
    },

    onRootDrop: (event) => {
      event.preventDefault()
      const moving = dragId.value
      dropAt.value = null
      dragId.value = null
      if (moving !== null) onMove(moving, null)
    },
  }
}
