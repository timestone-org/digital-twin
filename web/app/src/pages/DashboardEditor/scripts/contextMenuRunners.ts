/**
 * @fileoverview 右键菜单的两张表：每一项翻成哪个既有动作，以及算条目要喂进去的现状。
 * 状态与分发在 `useEditorContextMenu.ts`。
 * ⚠ 菜单与快捷键必须落到同一个动作函数上，各写一份的话两条路径会各自漂移，
 * 而界面上看不出差别。
 */
import type { Ref } from 'vue'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import { layerPositionOf } from '@/features/dashboard/editorDoc'
import type { ContextMenuAction, ContextMenuInput } from './contextMenuItems'
import type { EditorActions } from './editorActions'
import type { ArrangeActions } from './editorArrange'
import { modLabel } from './shortcuts'

export interface EditorContextMenuDeps {
  editor: DashboardEditor
  actions: EditorActions
  arrange: ArrangeActions
  /** 把节点滚进视口中央，由画布提供。 */
  centerOn: (nodeId: string) => void
  /** 带确认弹窗的整批删除，与 Delete 键同一个出口。 */
  removeSelected: () => void
  zoom: Ref<CanvasZoom>
}

type Runner = (deps: EditorContextMenuDeps, nodeId: string | null) => void

/** 每个动作各指向一个既有出口；层序与删除按选中集走，居中与显隐按落点节点走。 */
export const RUNNERS: Record<ContextMenuAction, Runner> = {
  front: (deps) => {
    deps.arrange.bringSelectedToFront()
  },
  back: (deps) => {
    deps.arrange.sendSelectedToBack()
  },
  forward: (deps) => {
    deps.arrange.bringSelectedForward()
  },
  backward: (deps) => {
    deps.arrange.sendSelectedBackward()
  },
  center: (deps, nodeId) => {
    if (nodeId !== null) deps.centerOn(nodeId)
  },
  copy: (deps) => {
    deps.arrange.copySelected()
  },
  remove: (deps) => {
    deps.removeSelected()
  },
  hide: (deps, nodeId) => {
    if (nodeId !== null) deps.actions.toggleVisible(nodeId, false)
  },
  paste: (deps) => {
    deps.arrange.pasteClipboard()
  },
  'select-all': (deps) => {
    deps.arrange.selectAllTop()
  },
  fit: (deps) => {
    deps.zoom.value = null
  },
}

/** 修饰键展示名；`navigator.platform` 在部分浏览器已废弃，拼上 userAgent 兜底。 */
function platformMod(): string {
  if (typeof navigator === 'undefined') return modLabel('')
  return modLabel(`${navigator.platform} ${navigator.userAgent}`)
}

function isNodeVisible(
  editor: DashboardEditor,
  nodeId: string | null,
): boolean {
  if (nodeId === null) return true
  return (
    editor.nodes.value.find((node) => node.id === nodeId)?.isVisible ?? false
  )
}

/** 目标节点上下还有没有兄弟：独苗一个的层里，四个层序项全该置灰。 */
function layerReach(
  editor: DashboardEditor,
  nodeId: string | null,
): { canForward: boolean; canBackward: boolean } {
  const layer =
    nodeId === null ? null : layerPositionOf(editor.nodes.value, nodeId)
  if (layer === null || layer.index < 0) {
    return { canForward: false, canBackward: false }
  }
  return {
    canForward: layer.index < layer.total - 1,
    canBackward: layer.index > 0,
  }
}

/**
 * 算条目要用到的当下现状。
 * @param deps 编辑器与动作
 * @param nodeId 右键落点上的节点；空白处为 null
 */
export function menuInputOf(
  deps: EditorContextMenuDeps,
  nodeId: string | null,
): ContextMenuInput {
  return {
    nodeId,
    isNodeVisible: isNodeVisible(deps.editor, nodeId),
    ...layerReach(deps.editor, nodeId),
    canCopy: deps.arrange.canCopy(),
    canPaste: deps.arrange.canPaste(),
    canSelectAll: deps.editor.nodes.value.some(
      (node) => node.parentId === null,
    ),
    isFitted: deps.zoom.value === null,
    mod: platformMod(),
  }
}
