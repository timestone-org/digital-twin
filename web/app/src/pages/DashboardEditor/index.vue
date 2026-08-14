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

import { fetchPointHistory } from '@/api/pointHistories'
import {
  installDashboardDataSources,
  installDashboardModules,
} from '@/bootstrap/dashboard'
import { AppShell } from '@/components/layout'
import { useDashboardDoc } from '@/composables/useDashboardDoc'
import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { useDashboardValues } from '@/composables/useDashboardValues'
import { useRealtimeChannel } from '@/composables/useRealtimeChannel'
import { snapStep } from '@/features/dashboard/canvasSnap'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import { dashboardTopic } from '@/runtime/pointFrames'
import { createPointSubscribe } from '@/runtime/pointStream'
import { createEditorActions } from './editorActions'
import { createArrangeActions } from './editorArrange'
import { useEditorChrome } from './useEditorChrome'
import { useEditorExtras } from './useEditorExtras'
import { useEditorMeta } from './useEditorMeta'
import { createEditorPageOps } from './useEditorPageOps'
import { createEditorSurface } from './useEditorSurface'
import EditorCanvas from './components/EditorCanvas.vue'
import EditorNotices from './components/EditorNotices.vue'
import EditorOverlays from './components/EditorOverlays.vue'
import EditorToolbar from './components/EditorToolbar.vue'
import ChromePanel from './components/ChromePanel.vue'
import InspectorPane from './components/InspectorPane.vue'
import LeftRail from './components/LeftRail.vue'
import MultiSelectPanel from './components/MultiSelectPanel.vue'

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

installDashboardDataSources({
  subscribe: createPointSubscribe(useRealtimeChannel(), () => {
    const current = file.dashboard.value
    return current === null ? null : dashboardTopic(current.id)
  }),
  fetchHistory: fetchPointHistory,
})

useDashboardValues(() => editor.nodes.value)

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
const zoom = ref<CanvasZoom>(null)
const canvasRef = ref<InstanceType<typeof EditorCanvas> | null>(null)
const fitScale = computed(() => canvasRef.value?.fitScale ?? 1)

const arrange = createArrangeActions({
  editor,
  getManifest,
  design: () => design.value,
  steps: () => snapStep(design.value, grid.value, snap.value),
  dashboardId: () => file.dashboard.value?.id ?? null,
})

const surface = createEditorSurface({
  editor,
  actions,
  arrange,
  getManifest,
  onRejected: (message) => toast.error(message),
})

const isMultiSelecting = computed(() => editor.selectedIds.value.length > 1)

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
        :align-ready="arrange.alignReady()"
        :distribute-ready="arrange.distributeReady()"
        @undo="editor.undo"
        @redo="editor.redo"
        @reload="ops.reload"
        @save="extras.saveWithThumbnail"
        @update:zoom="zoom = $event"
        @set-snap="snap = { ...snap, ...$event }"
        @align="arrange.alignSelected"
        @distribute="arrange.distributeSelected"
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

      <div class="grid min-h-0 flex-1 grid-cols-[15rem_1fr_20rem] gap-3">
        <section class="dt-editor__pane">
          <LeftRail
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
            @center="(nodeId) => canvasRef?.centerOn(nodeId)"
            @front="surface.onFront"
            @back="surface.onBack"
          />
        </section>

        <EditorCanvas
          ref="canvasRef"
          class="dt-editor__pane"
          :design="design"
          :frames="editor.layout.value.frames"
          :nodes="editor.nodes.value"
          :selected-ids="editor.selectedIds.value"
          :get-manifest="getManifest"
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
        />

        <section class="dt-editor__pane">
          <MultiSelectPanel
            v-if="isMultiSelecting"
            :count="editor.selectedIds.value.length"
            :align-ready="arrange.alignReady()"
            :distribute-ready="arrange.distributeReady()"
            @align="arrange.alignSelected"
            @distribute="arrange.distributeSelected"
            @remove-all="ops.removeSelected"
          />
          <InspectorPane
            v-else-if="editor.selectedIds.value.length === 1"
            :selected="editor.selected.value"
            :manifest="
              editor.selected.value === null
                ? undefined
                : getManifest(editor.selected.value.moduleType)
            "
            @config="actions.changeConfig"
            @geometry="ops.changeSelectedGeometry"
            @visible="ops.toggleSelectedVisible"
            @write="actions.writeBinding"
            @drop="actions.dropSlot"
            @bind="actions.bindSlot"
            @pick="pickingFieldKey = $event"
            @add-row="actions.addBindingRow"
            @remove-row="actions.removeBindingRow"
          />
          <ChromePanel
            v-else
            :draft="meta.draft.value"
            :snap="snap"
            :grid="grid"
            :nodes="editor.nodes.value"
            :get-manifest="getManifest"
            @set-field="chrome.setField"
            @set-snap="chrome.setSnap"
            @set-grid="chrome.setGrid"
            @set-card="chrome.setCard"
            @set-interactions="chrome.setInteractions"
          />
        </section>
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
      @close-picker="ops.closePicker"
      @pick="ops.pickPoint"
      @update:help-open="extras.helpOpen.value = $event"
      @close-preview="extras.previewOpen.value = false"
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
