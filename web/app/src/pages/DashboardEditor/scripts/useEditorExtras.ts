/**
 * @fileoverview 编辑器周边件的接线：全屏预览态、画布右键菜单、导出 JSON、
 * 保存后 best-effort 截图。收在一处让页面只剩绑定；本地草稿流在 useEditorPageOps。
 */
import { ref, type Ref } from 'vue'
import type { DashboardPayload } from '@dt/contracts'
import type { DesignSize } from '@dt/runtime'

import { exportDashboard } from '@/api/dashboardTransfer'
import type { DashboardEditor } from '@/composables/useDashboardEditor'
import type {
  EditorGridConfig,
  SnapConfig,
} from '@/features/dashboard/canvasSnap'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import { downloadJson } from '@/utils/downloadJson'
import type { EditorActions } from './editorActions'
import type { ArrangeActions } from './editorArrange'
import { useEditorHotkeys } from './useEditorHotkeys'
import {
  useEditorContextMenu,
  type EditorContextMenu,
} from './useEditorContextMenu'
import { clearDraft } from './editorDraft'
import { captureThumbnail } from './editorThumbnail'

export interface EditorExtrasDeps {
  editor: DashboardEditor
  actions: EditorActions
  arrange: ArrangeActions
  dashboard: Ref<DashboardPayload | null>
  design: () => DesignSize
  snap: () => SnapConfig
  grid: () => EditorGridConfig
  zoom: Ref<CanvasZoom>
  fitScale: () => number
  /** 带确认的整批删除。 */
  removeSelected: () => void
  /** Esc 的前置出口（关挑点面板）。 */
  consumePicker: () => boolean
  /** ops.save；截图挂在它成功之后。 */
  save: () => Promise<void>
  /** 确认弹窗宿主；由页面统一注入。 */
  confirm: {
    ask: (input: {
      title: string
      message: string
      confirmText: string
      danger: boolean
    }) => Promise<boolean>
  }
  /** 截图取景元素。 */
  stageEl: () => HTMLElement | null
  /** 把节点滚进视口中央，由画布提供。 */
  centerOn: (nodeId: string) => void
  onExportFailed: (message: string) => void
}

export interface EditorExtras {
  previewOpen: Ref<boolean>
  helpOpen: Ref<boolean>
  contextMenu: EditorContextMenu
  /** 工具栏保存入口：保存成功后顺手截缩略图并清草稿。 */
  saveWithThumbnail: () => Promise<void>
  exportJson: () => Promise<void>
}

/** 右键菜单与快捷键共用同一批动作出口，删除同样先过确认弹窗。 */
function contextMenuOf(deps: EditorExtrasDeps): EditorContextMenu {
  return useEditorContextMenu({
    editor: deps.editor,
    actions: deps.actions,
    arrange: deps.arrange,
    centerOn: deps.centerOn,
    removeSelected: deps.removeSelected,
    zoom: deps.zoom,
  })
}

export function useEditorExtras(deps: EditorExtrasDeps): EditorExtras {
  const { editor, dashboard } = deps
  const previewOpen = ref(false)

  async function saveWithThumbnail(): Promise<void> {
    await deps.save()
    const current = dashboard.value
    if (current === null) return
    // 保存失败时文档仍脏，草稿留着；成功才清
    if (!editor.isDirty.value) {
      clearDraft(current.id)
      void captureThumbnail(current.id, deps.stageEl())
    }
  }

  async function exportJson(): Promise<void> {
    const current = dashboard.value
    if (current === null) return
    try {
      const payload = await exportDashboard(current.id)
      downloadJson(payload, current.name)
    } catch {
      deps.onExportFailed('导出失败，请稍后再试')
    }
  }

  // 快捷键：帮助/预览任一浮层打开时全让位，Esc 先关浮层再收挑点面板
  const { helpOpen } = useEditorHotkeys({
    editor,
    arrange: deps.arrange,
    save: () => void saveWithThumbnail(),
    removeSelected: deps.removeSelected,
    design: deps.design,
    snap: deps.snap,
    grid: deps.grid,
    zoom: deps.zoom,
    fitScale: deps.fitScale,
    escapeFirst: () => {
      if (previewOpen.value) {
        previewOpen.value = false
        return true
      }
      return deps.consumePicker()
    },
  })

  return {
    previewOpen,
    helpOpen,
    contextMenu: contextMenuOf(deps),
    saveWithThumbnail,
    exportJson,
  }
}
