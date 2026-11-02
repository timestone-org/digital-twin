/** @fileoverview 编辑器周边接线：预览、右键菜单、导出、保存截图、助手与快捷键。 */
import type { ReadRenderedSeries } from '@/runtime/renderedSeries'
import { ref, type Ref } from 'vue'
import type { DashboardPayload } from '@dt/contracts'
import type { DesignSize, GetModuleManifest } from '@dt/runtime'

import { exportDashboard } from '@/api/dashboardTransfer'
import { fromExportPackage } from '@/api/dashboardTransferWire'
import { useAiPanel, type AiPanel } from '@/composables/useAiPanel'
import type { DashboardEditor } from '@/composables/useDashboardEditor'
import type {
  EditorGridConfig,
  SnapConfig,
} from '@/features/dashboard/canvasSnap'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import type { SaveOutcome } from '@/features/ai/saveTool'
import type { ReadPointSample } from '@/runtime/bindingReader'
import { downloadJson } from '@/utils/downloadJson'
import { createEditorSurface } from './aiSurface'
import type { MetaChrome } from './aiSurfaceTypes'
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
  /** 整屏外观缺省与联动规则的读写口；助手那两半改的是元数据轴。 */
  chrome: MetaChrome
  dashboard: Ref<DashboardPayload | null>
  design: () => DesignSize
  snap: () => SnapConfig
  grid: () => EditorGridConfig
  zoom: Ref<CanvasZoom>
  fitScale: () => number
  /** 带确认的整批删除。 */
  removeSelected: () => void
  /** 进某个节点的子编辑器；右键菜单那条走它，与属性面板同一个出口。 */
  openSubEditor: (nodeId: string) => void
  /** Esc 的前置出口（关挑点面板）。 */
  consumePicker: () => boolean
  /** ops.save；截图挂在它成功之后。回执带失败原因，助手那条保存工具要如实抛。 */
  save: () => Promise<SaveOutcome>
  isMetaDirty: () => boolean
  /** 确认弹窗宿主；由页面统一注入。 */
  confirm: {
    ask: (input: {
      title: string
      message: string
      confirmText: string
      danger: boolean
    }) => Promise<boolean>
  }
  stageEl: () => HTMLElement | null
  centerOn: (nodeId: string) => void
  onExportFailed: (message: string) => void
  getManifest: GetModuleManifest
  dashboardId: () => string | null
  /** 助手与画布共用快照缓存，避免两处读数不一致。 */
  readSeries?: ReadRenderedSeries
  readSample: ReadPointSample
}

export interface EditorExtras {
  exportOpen: Ref<boolean>
  previewOpen: Ref<boolean>
  helpOpen: Ref<boolean>
  contextMenu: EditorContextMenu
  /** 工具栏保存入口：保存成功后顺手截缩略图并清草稿。 */
  saveWithThumbnail: () => Promise<SaveOutcome>
  exportJson: () => void
  confirmExport: (includePointBindings: boolean) => Promise<void>
  /** 未部署助手时入口隐藏，见 features/ai/ports.ts。 */
  ai: AiPanel
}

/**
 * 助手的工作面要认得画布节点是什么模块，所以清单解析器也要给它。
 * @param deps 页面周边件的依赖
 * @param save 工具栏那条保存路径；`dashboard.save` 走的就是它
 */
function aiPanelOf(
  deps: EditorExtrasDeps,
  save: () => Promise<SaveOutcome>,
): AiPanel {
  return useAiPanel({
    surface: () =>
      createEditorSurface({
        editor: deps.editor,
        actions: deps.actions,
        arrange: deps.arrange,
        chrome: deps.chrome,
        stageEl: deps.stageEl,
        getManifest: deps.getManifest,
        readSample: deps.readSample,
        ...(deps.readSeries === undefined
          ? {}
          : { readSeries: deps.readSeries }),
        save,
        savedVersion: () => deps.dashboard.value?.rowVersion ?? null,
      }),
    refId: deps.dashboardId,
  })
}

/** 右键菜单与快捷键共用同一批动作出口，删除同样先过确认弹窗。 */
function contextMenuOf(deps: EditorExtrasDeps): EditorContextMenu {
  return useEditorContextMenu({
    editor: deps.editor,
    actions: deps.actions,
    arrange: deps.arrange,
    getManifest: deps.getManifest,
    openSubEditor: deps.openSubEditor,
    centerOn: deps.centerOn,
    removeSelected: deps.removeSelected,
    zoom: deps.zoom,
  })
}

/** 工具栏那条保存：存上了就清草稿并顺手截一张缩略图。 */
function saverOf(deps: EditorExtrasDeps): () => Promise<SaveOutcome> {
  return async () => {
    const outcome = await deps.save()
    const current = deps.dashboard.value
    if (current === null) return outcome
    // ⚠ 元数据保存失败时节点树仍可能干净，必须同时检查保存回执。
    if (outcome.isSaved && !deps.editor.isDirty.value && !deps.isMetaDirty()) {
      clearDraft(current.id)
      void captureThumbnail(current.id, deps.stageEl())
    }
    return outcome
  }
}

export function useEditorExtras(deps: EditorExtrasDeps): EditorExtras {
  const previewOpen = ref(false)
  const exportOpen = ref(false)
  const saveWithThumbnail = saverOf(deps)

  // ⚠ 助手与工具栏共用保存出口，确保清草稿与缩略图一致
  const ai = aiPanelOf(deps, saveWithThumbnail)

  // ⚠ 导入只认 snake_case，落盘必须经过 fromExportPackage
  async function confirmExport(includePointBindings: boolean): Promise<void> {
    if (!exportOpen.value) return
    exportOpen.value = false
    const current = deps.dashboard.value
    if (current === null) return
    try {
      const packed = fromExportPackage(
        await exportDashboard(current.id, { includePointBindings }),
      )
      downloadJson(packed, current.name)
    } catch {
      deps.onExportFailed('导出失败，请稍后再试')
    }
  }

  // 快捷键：帮助/预览任一浮层打开时全让位，Esc 先关浮层再收挑点面板
  const { helpOpen } = useEditorHotkeys({
    editor: deps.editor,
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
    exportOpen,
    previewOpen,
    helpOpen,
    contextMenu: contextMenuOf(deps),
    saveWithThumbnail,
    exportJson: () => {
      exportOpen.value = true
    },
    confirmExport,
    ai,
  }
}
