/**
 * @fileoverview 画布右键菜单的状态与分发：持有落点与目标节点，按当前状态算条目，
 * 再把每一项翻成既有动作。动作表与现状取值在 `contextMenuRunners.ts`。
 */
import { computed, ref, type ComputedRef } from 'vue'

import {
  contextMenuGroups,
  type ContextMenuAction,
  type ContextMenuGroup,
} from './contextMenuItems'
import {
  RUNNERS,
  menuInputOf,
  type EditorContextMenuDeps,
} from './contextMenuRunners'

export type { EditorContextMenuDeps } from './contextMenuRunners'

/** 打开中的菜单：落点、目标节点与算好的条目；没开着为 null。 */
export interface ContextMenuState {
  at: { x: number; y: number }
  nodeId: string | null
  groups: readonly ContextMenuGroup[]
}

export interface EditorContextMenu {
  state: ComputedRef<ContextMenuState | null>
  open: (at: { x: number; y: number }, nodeId: string | null) => void
  close: () => void
  /** 执行一项并收起菜单。 */
  run: (action: ContextMenuAction) => void
}

/**
 * 装上右键菜单。
 * @param deps 编辑器、动作与画布提供的两个出口
 */
export function useEditorContextMenu(
  deps: EditorContextMenuDeps,
): EditorContextMenu {
  const at = ref<{ x: number; y: number } | null>(null)
  const nodeId = ref<string | null>(null)

  const state = computed<ContextMenuState | null>(() => {
    const point = at.value
    if (point === null) return null
    const target = nodeId.value
    return {
      at: point,
      nodeId: target,
      groups: contextMenuGroups(menuInputOf(deps, target)),
    }
  })

  function close(): void {
    at.value = null
    nodeId.value = null
  }

  return {
    state,
    open: (point, target) => {
      at.value = point
      nodeId.value = target
    },
    close,
    run: (action) => {
      const target = nodeId.value
      // 先收菜单再动手：删除会弹确认框，菜单浮在它上面会抢焦点
      close()
      RUNNERS[action](deps, target)
    },
  }
}
