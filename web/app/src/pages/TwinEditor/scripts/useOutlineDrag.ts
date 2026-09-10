/** @fileoverview 大纲行的文件夹落点与前后插入状态。 */
import { ref } from 'vue'
import type { Ref } from 'vue'

import type { OutlinePlacement } from './outlinePlacement'
import type { TwinEntityKind } from './types'
import type { TwinOutlineFolderView, TwinOutlineRow } from './outlineNodes'

interface DraggingRow {
  kind: TwinEntityKind
  id: string
  /** 拖起时所在夹；null = 散行。 */
  folderId: string | null
}

export interface OutlineDrag {
  rowTarget: Ref<{ id: string; position: 'before' | 'after' } | null>
  overRow: (row: TwinOutlineRow, event: DragEvent) => void
  dropRow: (row: TwinOutlineRow) => void
  /** 正悬停的目标夹 id；null = 没有。 */
  dropFolderId: Ref<string | null>
  start: (row: TwinOutlineRow, folderId: string | null) => void
  end: () => void
  over: (folder: TwinOutlineFolderView, event: DragEvent) => void
  drop: (folder: TwinOutlineFolderView) => void
}

/**
 * 装上拖行入夹的状态机。
 * @param onDropInto 落进一个合法夹时回调（夹 id、行实体 id）
 */
export function useOutlineDrag(
  onDropInto: (folderId: string, itemId: string) => void,
  onPlace?: (placement: OutlinePlacement) => void,
): OutlineDrag {
  const dragging = ref<DraggingRow | null>(null)
  const dropFolderId = ref<string | null>(null)

  const rowTarget = ref<{ id: string; position: 'before' | 'after' } | null>(
    null,
  )

  function canDrop(folder: TwinOutlineFolderView): boolean {
    const active = dragging.value
    if (active === null) return false
    // 只认同段的夹；拖回自己所在的夹是空操作，不亮环也不落
    return active.kind === folder.kind && active.folderId !== folder.id
  }

  return {
    dropFolderId,
    rowTarget,
    ...createRowDrag(dragging, rowTarget, dropFolderId, onPlace),

    start: (row, folderId) => {
      dragging.value = { kind: row.kind, id: row.id, folderId }
    },

    end: () => {
      dragging.value = null
      rowTarget.value = null
      dropFolderId.value = null
    },

    /** 落点合法才 `preventDefault`：不拦的话浏览器就不认这是一个可放置的目标。 */
    over: (folder, event) => {
      rowTarget.value = null
      dropFolderId.value = null
      if (!canDrop(folder)) return
      event.preventDefault()
      dropFolderId.value = folder.id
    },

    drop: (folder) => {
      const active = dragging.value
      const legal = canDrop(folder)
      dragging.value = null
      rowTarget.value = null
      dropFolderId.value = null
      if (legal && active !== null) onDropInto(folder.id, active.id)
    },
  }
}

function createRowDrag(
  dragging: Ref<DraggingRow | null>,
  rowTarget: OutlineDrag['rowTarget'],
  dropFolderId: Ref<string | null>,
  onPlace: ((placement: OutlinePlacement) => void) | undefined,
): Pick<OutlineDrag, 'overRow' | 'dropRow'> {
  return {
    overRow: (row, event) => {
      rowTarget.value = null
      dropFolderId.value = null
      const active = dragging.value
      if (active === null || active.kind !== row.kind || active.id === row.id)
        return
      const element = event.currentTarget
      if (!(element instanceof HTMLElement)) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      rowTarget.value = {
        id: row.id,
        position:
          event.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
      }
    },
    dropRow: (row) => {
      const active = dragging.value
      const target = rowTarget.value
      dragging.value = null
      rowTarget.value = null
      dropFolderId.value = null
      if (
        active === null ||
        target?.id !== row.id ||
        active.kind !== row.kind ||
        active.id === row.id
      )
        return
      onPlace?.({
        kind: row.kind,
        id: active.id,
        targetId: row.id,
        position: target.position,
      })
    },
  }
}
