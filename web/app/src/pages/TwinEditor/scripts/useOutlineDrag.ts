/**
 * @fileoverview 大纲行拖进夹的 HTML5 DnD 状态：谁在拖、悬在哪个夹上。
 * 只管状态与落点合法性，真正的移入由调用方在 drop 回调里落地。
 * ⚠ 拖拽只改夹的成员表，不改文档序——它与「上移/下移」是两回事，搜索态也不禁。
 */
import { ref } from 'vue'
import type { Ref } from 'vue'

import type { TwinOutlineFolderView, TwinOutlineRow } from './outlineNodes'

interface DraggingRow {
  kind: string
  id: string
  /** 拖起时所在夹；null = 散行。 */
  folderId: string | null
}

export interface OutlineDrag {
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
): OutlineDrag {
  const dragging = ref<DraggingRow | null>(null)
  const dropFolderId = ref<string | null>(null)

  function canDrop(folder: TwinOutlineFolderView): boolean {
    const active = dragging.value
    if (active === null) return false
    // 只认同段的夹；拖回自己所在的夹是空操作，不亮环也不落
    return active.kind === folder.kind && active.folderId !== folder.id
  }

  return {
    dropFolderId,

    start: (row, folderId) => {
      dragging.value = { kind: row.kind, id: row.id, folderId }
    },

    end: () => {
      dragging.value = null
      dropFolderId.value = null
    },

    /** 落点合法才 `preventDefault`：不拦的话浏览器就不认这是一个可放置的目标。 */
    over: (folder, event) => {
      if (!canDrop(folder)) return
      event.preventDefault()
      dropFolderId.value = folder.id
    },

    drop: (folder) => {
      const active = dragging.value
      const legal = canDrop(folder)
      dragging.value = null
      dropFolderId.value = null
      if (legal && active !== null) onDropInto(folder.id, active.id)
    },
  }
}
