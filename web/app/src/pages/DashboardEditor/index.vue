<script setup lang="ts">
/**
 * @fileoverview 大屏编辑器：模块库 / 画布 / 图层树 / 属性与绑点四栏。
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
import { DtNotice, useConfirm, useToast } from '@dt/ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { CollectPoint } from '@/api/collect'
import {
  installDashboardDataSources,
  installDashboardModules,
} from '@/bootstrap/dashboard'
import { AppShell } from '@/components/layout'
import { useDashboardDoc } from '@/composables/useDashboardDoc'
import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { useRealtimeChannel } from '@/composables/useRealtimeChannel'
import { toLayoutInput } from '@/features/dashboard/editorDoc'
import { dashboardTopic } from '@/runtime/pointFrames'
import { createPointSubscribe } from '@/runtime/pointStream'
import EditorCanvas from './components/EditorCanvas.vue'
import EditorToolbar from './components/EditorToolbar.vue'
import InspectorPane from './components/InspectorPane.vue'
import ModuleLibrary from './components/ModuleLibrary.vue'
import PointPickerDialog from './components/PointPickerDialog.vue'
import { createEditorActions } from './editorActions'
import { useDashboardValues } from './useDashboardValues'
import { useEditorShortcuts } from './useEditorShortcuts'

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
})

useDashboardValues(() => editor.nodes.value)

const actions = createEditorActions({
  editor,
  dashboardId: () => file.dashboard.value?.id ?? null,
  getManifest,
})

const dashboardId = computed(() => String(route.params.dashboardId ?? ''))

const design = computed(() =>
  designSize(
    file.dashboard.value?.designWidth ?? 0,
    file.dashboard.value?.designHeight ?? 0,
  ),
)

const selectedManifest = computed(() =>
  editor.selected.value === null
    ? undefined
    : getManifest(editor.selected.value.moduleType),
)

async function removeNode(nodeId: string): Promise<void> {
  const ok = await confirm.ask({
    title: '删除节点',
    message: '这个节点连同它的全部子节点与绑定都会被删掉，保存后不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (ok) actions.removeNode(nodeId)
}

function removeSelected(): void {
  const nodeId = editor.selectedId.value
  if (nodeId !== null) void removeNode(nodeId)
}

useEditorShortcuts({
  undo: editor.undo,
  redo: editor.redo,
  remove: removeSelected,
})

function changeSelectedGeometry(
  geometry: { x: number; y: number; w: number; h: number },
  isContinuous: boolean,
): void {
  const nodeId = editor.selectedId.value
  if (nodeId !== null) actions.changeGeometry(nodeId, geometry, isContinuous)
}

function toggleSelectedVisible(isVisible: boolean): void {
  const nodeId = editor.selectedId.value
  if (nodeId !== null) actions.toggleVisible(nodeId, isVisible)
}

function pickPoint(point: CollectPoint): void {
  const fieldKey = pickingFieldKey.value
  if (fieldKey !== null) actions.applyPickedPoint(fieldKey, point.nodeKey)
}

function closePicker(open: boolean): void {
  if (!open) pickingFieldKey.value = null
}

async function reload(): Promise<void> {
  const loaded = await file.load(dashboardId.value)
  if (loaded !== null) editor.reset(loaded.nodes)
}

async function save(): Promise<void> {
  const current = file.dashboard.value
  if (current === null) return
  const saved = await file.save({
    expectedVersion: current.rowVersion,
    nodes: toLayoutInput(editor.nodes.value),
  })
  if (saved === null) {
    toast.error(file.conflict.value ?? file.error.value ?? '保存失败')
    return
  }
  editor.reset(saved.nodes)
  toast.success('大屏已保存')
}

watch(dashboardId, () => void reload(), { immediate: true })

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
        :is-dirty="editor.isDirty.value"
        :can-undo="editor.canUndo.value"
        :can-redo="editor.canRedo.value"
        :saving="file.saving.value"
        :has-conflict="file.conflict.value !== null"
        @undo="editor.undo"
        @redo="editor.redo"
        @reload="reload"
        @save="save"
      />
    </template>

    <div class="flex h-full min-h-0 flex-col gap-3">
      <DtNotice v-if="file.conflict.value" intent="danger" icon="alert-triangle">
        {{ file.conflict.value }}
      </DtNotice>
      <DtNotice
        v-else-if="file.error.value"
        intent="danger"
        icon="alert-circle"
      >
        {{ file.error.value }}
      </DtNotice>
      <DtNotice
        v-if="editor.layout.value.detachedIds.length > 0"
        intent="warning"
        icon="alert-triangle"
      >
        有 {{ editor.layout.value.detachedIds.length }}
        个节点的父节点不存在，它们不会被画出来。
      </DtNotice>

      <div class="grid min-h-0 flex-1 grid-cols-[15rem_1fr_20rem] gap-3">
        <section class="dt-editor__pane">
          <ModuleLibrary :manifests="manifests" @add="actions.addModule" />
        </section>

        <EditorCanvas
          class="dt-editor__pane"
          :design="design"
          :frames="editor.layout.value.frames"
          :nodes="editor.nodes.value"
          :selected-id="editor.selectedId.value"
          :get-manifest="getManifest"
          @select="editor.select"
          @change="actions.changeGeometry"
        />

        <section class="dt-editor__pane">
          <InspectorPane
            :nodes="editor.nodes.value"
            :selected-id="editor.selectedId.value"
            :selected="editor.selected.value"
            :manifest="selectedManifest"
            :get-manifest="getManifest"
            @select="editor.select"
            @toggle="actions.toggleVisible"
            @remove="removeNode"
            @config="actions.changeConfig"
            @geometry="changeSelectedGeometry"
            @visible="toggleSelectedVisible"
            @write="actions.writeBinding"
            @drop="actions.dropSlot"
            @bind="actions.bindSlot"
            @pick="pickingFieldKey = $event"
            @add-row="actions.addBindingRow"
            @remove-row="actions.removeBindingRow"
          />
        </section>
      </div>
    </div>

    <PointPickerDialog
      :model-value="pickingFieldKey !== null"
      :field-key="pickingFieldKey"
      @update:model-value="closePicker"
      @pick="pickPoint"
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
