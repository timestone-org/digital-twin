/**
 * @fileoverview 编辑器周边件的接线：全屏预览态、画布右键菜单、导出 JSON、
 * 保存后 best-effort 截图。收在一处让页面只剩绑定；本地草稿流在 useEditorPageOps。
 */
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
  /** ops.save；截图挂在它成功之后。回执带失败原因，助手那条保存工具要如实抛。 */
  save: () => Promise<SaveOutcome>
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
  /** 清单解析器；助手的工作面要靠它读出每个画布节点是什么模块。 */
  getManifest: GetModuleManifest
  /** 当前大屏 id；助手的会话钉在它上面。 */
  dashboardId: () => string | null
  /**
   * 画布渲染用的那份快照缓存，助手读实时读数走它。
   * ⚠ 不许让助手另发一次请求：另发的话会出现「助手说有值、画面上是占位符」。
   */
  readSample: ReadPointSample
}

export interface EditorExtras {
  previewOpen: Ref<boolean>
  helpOpen: Ref<boolean>
  contextMenu: EditorContextMenu
  /** 工具栏保存入口：保存成功后顺手截缩略图并清草稿。 */
  saveWithThumbnail: () => Promise<SaveOutcome>
  exportJson: () => Promise<void>
  /**
   * 助手面板。
   * ⚠ 这套部署没装助手时 `isAvailable` 恒假，入口不出现——而不是出现一个
   * 点了报错的按钮（features/ai/ports.ts）。
   */
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
        stageEl: deps.stageEl,
        getManifest: deps.getManifest,
        readSample: deps.readSample,
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
    // 保存失败时文档仍脏，草稿留着；成功才清
    if (!deps.editor.isDirty.value) {
      clearDraft(current.id)
      void captureThumbnail(current.id, deps.stageEl())
    }
    return outcome
  }
}

export function useEditorExtras(deps: EditorExtrasDeps): EditorExtras {
  const { editor, dashboard } = deps
  const previewOpen = ref(false)
  const saveWithThumbnail = saverOf(deps)

  // ⚠ 助手那条保存工具接的是**同一个** saveWithThumbnail：另起一条的话，
  //   助手保存完的那张屏不清草稿也不换缩略图，而两处都看不出是谁少做了一步
  const ai = aiPanelOf(deps, saveWithThumbnail)

  // ⚠ 存的是 `fromExportPackage` 的产出（线形 snake_case），不是内存里的
  // camelCase 载荷：导入端的 `parseExportPackage` 只认线形，写载荷进文件
  // 会让这份包导不回来。
  async function exportJson(): Promise<void> {
    const current = dashboard.value
    if (current === null) return
    try {
      const packed = fromExportPackage(await exportDashboard(current.id))
      downloadJson(packed, current.name)
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
    ai,
  }
}
