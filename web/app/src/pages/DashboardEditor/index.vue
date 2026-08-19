<script setup lang="ts">
/**
 * @fileoverview 大屏编辑器：模块库与图层树（左）/ 画布（中）/ 属性与绑点（右）。
 *
 * ⚠ 整树替换必带 `expected_version`，409 走「重新加载」而不是静默覆盖（ADR-0012）。
 * ⚠ 节点与绑定的 id 由前端**创建时**给一次就不再变，保存前后顺序也不变——
 * 后端按 id 三路比对、按固定序返回，两边任一处重排都会让 diff 失去意义。
 * ⚠ 加载防竞态收在 `useDashboardDoc`：大屏可以被连着切，慢的那次后返回会把
 * 新屏的内容覆盖成旧屏的，且没有任何报错。
 */
import type { ModuleManifest } from '@dt/contracts'
import { getModule, listModules } from '@dt/modules'
import { designSize } from '@dt/runtime'
import { useConfirm, useToast } from '@dt/ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { installDashboardModules } from '@/bootstrap/dashboard'
import { AppShell } from '@/components/layout'
import { useDashboardDoc } from '@/composables/useDashboardDoc'
import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { snapStep } from '@/features/dashboard/canvasSnap'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import { createEditorActions } from './scripts/editorActions'
import { useEditorDataSources } from './scripts/useEditorDataSources'
import { createArrangeActions } from './scripts/editorArrange'
import { useEditorChrome } from './scripts/useEditorChrome'
import { useEditorExtras } from './scripts/useEditorExtras'
import { useEditorMeta } from './scripts/useEditorMeta'
import { createEditorPageOps } from './scripts/useEditorPageOps'
import { createEditorInspector } from './scripts/useEditorInspector'
import { useEditorPanes } from './scripts/useEditorPanes'
import { createEditorSurface } from './scripts/useEditorSurface'
import EditorCanvas from './components/EditorCanvas.vue'
import EditorNotices from './components/EditorNotices.vue'
import EditorOverlays from './components/EditorOverlays.vue'
import EditorToolbar from './components/EditorToolbar.vue'
import EditorSplitter from './components/EditorSplitter.vue'
import LeftRail from './components/LeftRail.vue'
import RightRail from './components/RightRail.vue'

const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

installDashboardModules()

const manifests = listModules()
const getManifest = (moduleType: string): ModuleManifest | undefined =>
  getModule(moduleType)

const file = useDashboardDoc()
const editor = useDashboardEditor(getManifest)
const pickingFieldKey = ref<string | null>(null)

useEditorDataSources(file.dashboard, () => editor.nodes.value)

const dashboardId = computed(() => String(route.params.dashboardId ?? ''))

const design = computed(() =>
  designSize(
    file.dashboard.value?.designWidth ?? 0,
    file.dashboard.value?.designHeight ?? 0,
  ),
)

const actions = createEditorActions({
  editor,
  dashboardId: () => file.dashboard.value?.id ?? null,
  getManifest,
  design: () => design.value,
})

const meta = useEditorMeta(file.dashboard)
const chrome = useEditorChrome(file.dashboard, meta)
const { snap, grid } = chrome

// 左右两栏可拖拽改宽；宽度记在本机，取值域见 paneWidths
const panes = useEditorPanes()
const gridRef = panes.hostRef

const zoom = ref<CanvasZoom>(null)
const canvasRef = ref<InstanceType<typeof EditorCanvas> | null>(null)
const fitScale = computed(() => canvasRef.value?.fitScale ?? 1)
const centerOn = (nodeId: string): void =>
  void canvasRef.value?.centerOn(nodeId)

const arrange = createArrangeActions({
  editor,
  getManifest,
  design: () => design.value,
  steps: () => snapStep(design.value, grid.value, snap.value),
  dashboardId: () => file.dashboard.value?.id ?? null,
  chrome,
  notify: (message) => toast.success(message),
})

const surface = createEditorSurface({
  editor,
  actions,
  arrange,
  getManifest,
  onRejected: (message) => toast.error(message),
})

const inspector = createEditorInspector({
  editor,
  actions,
  surface,
  meta,
  centerOn,
})

const ops = createEditorPageOps({
  editor,
  actions,
  arrange,
  file,
  meta,
  confirm,
  toast,
  dashboardId: () => dashboardId.value,
  pickingFieldKey,
})

const extras = useEditorExtras({
  editor,
  actions,
  arrange,
  dashboard: file.dashboard,
  design: () => design.value,
  snap: () => snap.value,
  grid: () => grid.value,
  zoom,
  fitScale: () => fitScale.value,
  save: () => ops.save(),
  removeSelected: () => void ops.removeSelected(),
  consumePicker: () => ops.consumePicker(),
  confirm,
  stageEl: () => canvasRef.value?.stageRef ?? null,
  centerOn,
  onExportFailed: (message) => toast.error(message),
})

watch(dashboardId, () => void ops.reload(), { immediate: true })

onUnmounted(file.dispose)
</script>

<template>
  <AppShell
    :title="file.dashboard.value?.name ?? '大屏编辑器'"
    subtitle="拖模块、配属性、绑点位"
    back-to="/dashboards"
    back-label="大屏列表"
  >
    <template #actions>
      <EditorToolbar
        :is-dirty="editor.isDirty.value || meta.isDirty.value"
        :can-undo="editor.canUndo.value"
        :can-redo="editor.canRedo.value"
        :saving="file.saving.value"
        :has-conflict="file.conflict.value !== null"
        :zoom="zoom"
        :fit-scale="fitScale"
        :snap="snap"
        @undo="editor.undo"
        @redo="editor.redo"
        @reload="ops.reload"
        @save="extras.saveWithThumbnail"
        @update:zoom="zoom = $event"
        @set-snap="snap = { ...snap, ...$event }"
        @tidy="arrange.tidyTopLevel"
        @help="extras.helpOpen.value = true"
        @preview="extras.previewOpen.value = true"
        @export="extras.exportJson"
      />
    </template>

    <div class="flex h-full min-h-0 flex-col gap-3">
      <EditorNotices
        :conflict="file.conflict.value"
        :error="file.error.value"
        :detached-count="editor.layout.value.detachedIds.length"
      />

      <div
        ref="gridRef"
        class="grid min-h-0 flex-1"
        :style="panes.gridStyle.value"
      >
        <LeftRail
          class="dt-editor__pane"
          :manifests="manifests"
          :frames="editor.layout.value.frames"
          :nodes="editor.nodes.value"
          :selected-ids="editor.selectedIds.value"
          :get-manifest="getManifest"
          @add="ops.addModule"
          @select="surface.onSelect"
          @toggle="actions.toggleVisible"
          @remove="ops.removeNode"
          @rename="surface.onRename"
          @move="surface.onMove"
          @center="centerOn"
        />

        <EditorSplitter side="left" label="模块栏宽度" :panes="panes" />

        <EditorCanvas
          ref="canvasRef"
          class="dt-editor__pane"
          :design="design"
          :frames="editor.layout.value.frames"
          :nodes="editor.nodes.value"
          :selected-ids="editor.selectedIds.value"
          :get-manifest="getManifest"
          :card-chrome="inspector.cardChrome.value"
          :snap="snap"
          :grid="grid"
          :zoom="zoom"
          @select="surface.onSelect"
          @marquee="surface.onMarquee"
          @change="actions.changeGeometry"
          @change-batch="surface.onChangeBatch"
          @drop-node="surface.onDropNode"
          @add-at="surface.onAddAt"
          @update:zoom="zoom = $event"
          @canvas-menu="extras.contextMenu.open"
        />

        <EditorSplitter side="right" label="配置栏宽度" :panes="panes" />

        <RightRail
          class="dt-editor__pane"
          :selected-ids="editor.selectedIds.value"
          :selected="editor.selected.value"
          :nodes="editor.nodes.value"
          :get-manifest="getManifest"
          :rules="chrome.rules.value"
          :draft="meta.draft.value"
          :snap="snap"
          :grid="grid"
          :align-ready="arrange.alignReady()"
          :distribute-ready="arrange.distributeReady()"
          @align="arrange.alignSelected"
          @distribute="arrange.distributeSelected"
          @remove-all="ops.removeSelected"
          @config="actions.changeConfig"
          @geometry="ops.changeSelectedGeometry"
          @visible="ops.toggleSelectedVisible"
          @rename="inspector.rename"
          @order="inspector.order"
          @preset="inspector.applyPreset"
          @interactions="chrome.setInteractions"
          @write="actions.writeBinding"
          @drop="actions.dropSlot"
          @bind="actions.bindSlot"
          @pick="pickingFieldKey = $event"
          @add-row="actions.addBindingRow"
          @remove-row="actions.removeBindingRow"
          @set-field="chrome.setField"
          @set-snap="chrome.setSnap"
          @set-grid="chrome.setGrid"
          @set-card="chrome.setCard"
        />
      </div>
    </div>

    <EditorOverlays
      :picking-field-key="pickingFieldKey"
      :help-open="extras.helpOpen.value"
      :preview-open="extras.previewOpen.value"
      :nodes="editor.nodes.value"
      :design="design"
      :get-manifest="getManifest"
      :chrome-json="meta.draft.value?.chromeJson ?? {}"
      :context-menu="extras.contextMenu.state.value"
      @close-picker="ops.closePicker"
      @pick="ops.pickPoint"
      @update:help-open="extras.helpOpen.value = $event"
      @close-preview="extras.previewOpen.value = false"
      @menu-pick="extras.contextMenu.run"
      @close-menu="extras.contextMenu.close"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.dt-editor__pane {
  min-height: 0;
  padding: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
  overflow: hidden;
}
</style>
