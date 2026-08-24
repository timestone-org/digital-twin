<script setup lang="ts">
/**
 * @fileoverview 孪生子编辑器：大纲（左）/ 3D 视口（中）/ 检查器（右）。
 * 编辑的是某张大屏上某个节点的那段孪生配置，落库走大屏的整树替换。
 *
 * ⚠ 这一页对「自己在编 twin-view」一无所知，也不该知道：是大屏编辑器按
 * 清单上的 `subEditor` 声明跳进来的，路由参数只有 `dashboardId` + `nodeId`。
 * ⚠ 视口里不套距离派生的显隐；左栏眼睛管本次编辑显隐，
 * 右栏「初始可见」只进持久化配置，两者不共用状态。
 */
import { collectTwinConfigIssues } from '@dt/twin-config'
import type { Vec3 } from '@dt/twin-config'
import { DtPageState, useConfirm, useToast } from '@dt/ui'
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'

import { AppShell } from '@/components/layout'

import PointPickerDialog from '@/components/binding/PointPickerDialog.vue'

import BulkPartsDialog from './components/BulkPartsDialog.vue'
import TwinDiagnosticsPanel from './components/TwinDiagnosticsPanel.vue'
import TwinEditorToolbar from './components/TwinEditorToolbar.vue'
import TwinLeftPane from './components/TwinLeftPane.vue'
import TwinRightPane from './components/TwinRightPane.vue'
import TwinViewport from './components/TwinViewport.vue'
import { createTwinEditorActions } from './scripts/twinEditorActions'
import {
  toggleEditorVisibility,
  withEditorVisibility,
} from './scripts/editorVisibility'
import { createTwinViewportOps } from './scripts/twinViewportOps'
import { useTwinBindings } from './scripts/useTwinBindings'
import {
  TWIN_SELECT_MODEL,
  type TwinEntityKind,
  type TwinSelection,
} from './scripts/types'
import { useBulkParts } from './scripts/useBulkParts'
import { useGizmoMode } from './scripts/useGizmoMode'
import { useTwinEditorPage } from './scripts/useTwinEditorPage'
import { useUnsavedGuard } from './scripts/useUnsavedGuard'

const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

const dashboardId = computed(() => String(route.params.dashboardId ?? ''))
const nodeId = computed(() => String(route.params.nodeId ?? ''))

const page = useTwinEditorPage(
  () => dashboardId.value,
  () => nodeId.value,
)

const selection = ref<TwinSelection>(TWIN_SELECT_MODEL)
const showIssues = ref(false)
/** 刚建出来的夹 id；左栏大纲拿它立刻进入就地重命名。 */
const renamingFolderId = ref<string | null>(null)
/** 模型里的全部节点名，视口加载完给的；部件检查器要用。 */
const modelNodes = ref<readonly string[]>([])
/** 视口里正在飞漫游预览；它会被用户一碰镜头就停，所以由视口回传而不是这里说了算。 */
const roamPreviewing = ref(false)
/**
 * 当前坐标基准的原点（世界坐标）。
 * ⚠ 由视口回传而不是这里算：「模型中心」那一档取的是模型世界包围盒的中心，
 * 配置里没有这个数——右栏的坐标框与视口里的参考轴必须同源，否则两处的 0 不在一处。
 */
const frameOrigin = ref<Vec3>([0, 0, 0])
/** 左栏眼睛关掉的实体；只属于本次编辑，不进文档与撤销栈。 */
const editorHidden = ref<ReadonlySet<string>>(new Set())

const config = computed(() => page.doc.value?.config.value ?? null)
const editingConfig = computed(() => {
  const current = config.value
  return current === null
    ? null
    : withEditorVisibility(current, editorHidden.value)
})
const bulk = useBulkParts(
  () => config.value,
  () => modelNodes.value,
)
const gizmoMode = useGizmoMode(() => selection.value)
const issues = computed(() =>
  config.value === null ? [] : collectTwinConfigIssues(config.value),
)
const flaggedIds = computed(
  () => new Set(issues.value.map((issue) => issue.entityId)),
)

const actions = computed(() => {
  const doc = page.doc.value
  return doc === null
    ? null
    : createTwinEditorActions(doc, (next) => {
        selection.value = next
      })
})

function toggleEditorVisible(target: {
  kind: TwinEntityKind
  id: string
}): void {
  editorHidden.value = toggleEditorVisibility(editorHidden.value, target)
}

// 路由复用同一页组件时，上一段孪生的编辑隐藏态不许串到下一段。
watch([dashboardId, nodeId], () => {
  editorHidden.value = new Set()
})

// 编辑视口里的读数与大屏走同一条链路：同一个推送主题、同一份缝合
const binding = useTwinBindings(
  () => page.doc.value,
  () => dashboardId.value,
  () => page.node.value?.id ?? '',
  () => config.value,
)

const viewport = createTwinViewportOps({
  config: () => config.value,
  actions: () => actions.value,
  selection: () => selection.value,
  onRoamUnavailable: () => toast.error('轨迹上可用的视点不足两个，先去加几站'),
})

// ⚠ 模板里的 `ref="viewportRef"` 只认得顶层绑定，写成 `viewport.viewportRef`
// 会被当成一个字符串 ref 名，视口句柄永远是 null
const viewportRef = viewport.viewportRef

function select(next: TwinSelection): void {
  selection.value = next
  // 选中即取景：在大纲里点一个锚点，视口该把镜头带过去
  viewport.focus(next)
}

function addFolderIn(kind: TwinEntityKind): void {
  renamingFolderId.value = actions.value?.addFolder(kind) ?? null
}

function createFolderWith(payload: { kind: TwinEntityKind; id: string }): void {
  renamingFolderId.value =
    actions.value?.addFolderWithItem(payload.kind, payload.id) ?? null
}

async function save(): Promise<void> {
  const ok = await page.save()
  if (ok) toast.success('孪生场景已保存')
  else toast.error(page.conflict.value ?? '保存失败，请重试')
}

/** 返回大屏编辑器；外壳的返回入口按站内路径走。 */
const backTo = computed(() => `/dashboards/${dashboardId.value}/edit`)

// ⚠ 走之前必须问：这一页的改动只在内存里，直接离开就没了，且没有任何提示。
// 站内跳转拦在这里，关标签页 / 刷新那一半拦在 `useUnsavedGuard`
onBeforeRouteLeave(async () => {
  if (page.doc.value?.isDirty.value !== true) return true
  return await confirm.ask({
    title: '放弃未保存的改动',
    message: '孪生场景有改动还没保存，离开就会丢失。',
    confirmText: '离开',
    danger: true,
  })
})

useUnsavedGuard(() => page.doc.value?.isDirty.value === true)
</script>

<template>
  <AppShell
    title="孪生编辑器"
    :subtitle="page.dashboard.value?.name ?? ''"
    :back-to="backTo"
    :back-label="page.dashboard.value?.name ?? '返回大屏编辑器'"
  >
    <template #actions>
      <TwinEditorToolbar
        :is-dirty="page.doc.value?.isDirty.value ?? false"
        :is-saving="page.saving.value"
        :can-undo="page.doc.value?.canUndo.value ?? false"
        :can-redo="page.doc.value?.canRedo.value ?? false"
        :issue-count="issues.length"
        @save="save"
        @undo="page.doc.value?.undo()"
        @redo="page.doc.value?.redo()"
        @toggle-issues="showIssues = !showIssues"
      />
    </template>

    <div class="flex h-full flex-col">
      <DtPageState
        v-if="
          page.loading.value || page.error.value !== null || config === null
        "
        :loading="page.loading.value"
        :error="page.error.value"
        :empty="false"
      />
      <div v-else class="flex min-h-0 flex-1">
        <TwinLeftPane
          class="w-64 shrink-0 border-r border-border-subtle"
          :config="editingConfig ?? config"
          :selection="selection"
          :flagged-ids="flaggedIds"
          :renaming-folder-id="renamingFolderId"
          @select="select"
          @add="actions?.add($event)"
          @bulk-add="bulk.openBlank()"
          @remove="actions?.remove($event.kind, $event.id)"
          @duplicate="actions?.duplicate($event.kind, $event.id)"
          @move="actions?.move($event.kind, $event.id, $event.delta)"
          @toggle-editor-visible="toggleEditorVisible"
          @add-folder="addFolderIn"
          @rename-folder="actions?.renameFolder($event.id, $event.name)"
          @remove-folder="actions?.removeFolder($event)"
          @move-into-folder="
            actions?.moveIntoFolder($event.folderId, $event.id)
          "
          @remove-from-folder="actions?.removeFromFolder($event)"
          @create-folder-with-item="createFolderWith"
          @add-hier="actions?.addHier($event)"
          @move-hier="actions?.moveHier($event.id, $event.delta)"
          @reparent-hier="actions?.reparentHier($event.id, $event.parentId)"
        />

        <div class="flex min-w-0 flex-1 flex-col">
          <TwinViewport
            ref="viewportRef"
            class="min-h-0 flex-1"
            :config="editingConfig ?? config"
            :selection="selection"
            :pick-mode="viewport.pickMode.value"
            :gizmo-mode="gizmoMode"
            :target-size="page.targetSize.value"
            :values="binding.liveValues.value"
            @select="selection = $event ?? TWIN_SELECT_MODEL"
            @pick-node="viewport.onPickNode"
            @pick-position="viewport.onPickPosition"
            @model-nodes="modelNodes = $event"
            @frame-origin="frameOrigin = $event"
            @roam-preview="roamPreviewing = $event"
            @entity-transform="actions?.transformEntity($event)"
            @entity-transform-end="actions?.endTransform()"
            @marquee-nodes="bulk.openWith($event)"
          />
          <TwinDiagnosticsPanel
            v-if="showIssues"
            class="max-h-48 shrink-0 overflow-y-auto border-t border-border-subtle"
            :issues="issues"
            @focus="select"
          />
        </div>

        <TwinRightPane
          v-model:gizmo-mode="gizmoMode"
          class="w-80 shrink-0 border-l border-border-subtle"
          :config="config"
          :selection="selection"
          :model-nodes="modelNodes"
          :picking="viewport.isPicking.value"
          :roam-previewing="roamPreviewing"
          :frame-origin="frameOrigin"
          :bindings="binding.bindings.value"
          :is-dirty="page.doc.value?.isDirty.value ?? false"
          @patch="actions?.patchConfig($event)"
          @request-pick="viewport.requestPick"
          @cancel-pick="viewport.cancelPick"
          @capture-camera="viewport.captureCamera"
          @capture-hier-view="viewport.captureHierView"
          @preview-roam="viewport.previewRoam"
          @stop-roam-preview="viewport.stopRoamPreview"
          @write-binding="binding.write"
          @drop-binding="binding.drop"
          @add-binding="binding.bind"
          @pick-point="binding.pickingFieldKey.value = $event"
          @remove-binding-row="binding.removeRow"
        />
      </div>
    </div>

    <BulkPartsDialog
      :open="bulk.open.value"
      :candidates="bulk.candidates.value"
      :preselect="bulk.preselect.value"
      @update:open="bulk.open.value = $event"
      @confirm="actions?.addParts($event)"
    />

    <PointPickerDialog
      :model-value="binding.pickingFieldKey.value !== null"
      :field-key="binding.pickingFieldKey.value"
      @update:model-value="binding.closePicker"
      @pick="binding.pickPoint"
    />
  </AppShell>
</template>
