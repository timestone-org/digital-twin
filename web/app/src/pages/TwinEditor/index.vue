<script setup lang="ts">
/** @fileoverview 孪生场景子编辑器，承载配置草稿、动画与视口交互。 */
import type { BindingPayload } from '@dt/contracts'
import { collectTwinConfigIssues } from '@dt/twin-config'
import type { TwinConfig, TwinNavigationMode, Vec3 } from '@dt/twin-config'
import { DtPageState, DtResizableLayout, useConfirm, useToast } from '@dt/ui'
import { computed, ref, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useWorkspaceGuard } from '@/features/workspace/useWorkspaceGuard'
import { migrateLegacyEditorLayout } from '@/features/workspace/legacyEditorLayout'

import { installDashboardModules } from '@/bootstrap/dashboard'
import { AppShell } from '@/components/layout'

import TwinDiagnosticsPanel from './components/TwinDiagnosticsPanel.vue'
import TwinOverlays from './components/TwinOverlays.vue'
import TwinEditorToolbar from './components/TwinEditorToolbar.vue'
import TwinBatchConfig from './components/TwinBatchConfig.vue'
import TwinViewportTools from './components/TwinViewportTools.vue'
import { useTwinNavigation } from './scripts/useTwinNavigation'
import TwinLeftPane from './components/TwinLeftPane.vue'
import TwinSelectionContext from './components/TwinSelectionContext.vue'
import TwinRightPane from './components/TwinRightPane.vue'
import TwinConfigPreview from './components/TwinConfigPreview.vue'
import TwinAnimationInspector from './components/TwinAnimationInspector.vue'
import TwinViewport from './components/TwinViewport.vue'
import { createTwinEditorActions } from './scripts/twinEditorActions'
import { TWIN_PREVIEW_INTENT } from './scripts/previewIntent'
import { provideTwinMeasure } from './scripts/twinMeasure'
import { useEditorHidden } from './scripts/useEditorHidden'
import { createTwinViewportOps } from './scripts/twinViewportOps'
import { useTwinBindings } from './scripts/useTwinBindings'
import { TWIN_SELECT_MODEL } from './scripts/types'
import type { TwinEntityKind, TwinSelection } from './scripts/types'
import { useBulkParts } from './scripts/useBulkParts'
import { useGizmoMode } from './scripts/useGizmoMode'
import { useTwinAi } from './scripts/useTwinAi'
import { useTwinEditorPage } from './scripts/useTwinEditorPage'
import { useTwinAnimationSelection } from './scripts/useTwinAnimationSelection'
import { applyBatchBindings, applyBatchConfig } from './scripts/batchApply'
import { removeMissingAnimations } from './scripts/missingAnimations'
import { removeSelectedEntity } from './scripts/removeSelected'
import { useTwinShortcuts } from './scripts/useTwinShortcuts'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'

// ⚠ 子编辑器直接刷新时也必须安装模块，否则模型地址无法解析。
installDashboardModules()

migrateLegacyEditorLayout({
  previousKey: 'dt.twin-editor.panes',
  nextKey: 'dt.twin-editor.layout',
  paneIds: ['outline', 'viewport', 'inspector'],
})

const route = useRoute()
const toast = useToast()
const confirm = useConfirm()
const dashboardId = computed(() => String(route.params.dashboardId ?? ''))
const nodeId = computed(() => String(route.params.nodeId ?? ''))

const page = useTwinEditorPage(
  () => dashboardId.value,
  () => nodeId.value,
  (doc) =>
    doc.commit(
      removeMissingAnimations(doc.config.value, missingAnimations.value),
    ),
)

const selection = ref<TwinSelection>(TWIN_SELECT_MODEL)
const configPreviewRef = ref<InstanceType<typeof TwinConfigPreview> | null>(
  null,
)
provide(TWIN_PREVIEW_INTENT, (mode) => {
  configPreviewRef.value?.showPartMode(mode)
})
const showIssues = ref(false)
const focusMode = ref(false)
const batchOpen = ref(false)
/** 只管当前编辑视口；预览用的模式来自模块专属配置，二者刻意独立。 */
const editorNavigationMode = ref<TwinNavigationMode>('orbit')
/** 刚建出来的夹 id；左栏大纲拿它立刻进入就地重命名。 */
const renamingFolderId = ref<string | null>(null)
/** 模型里的全部节点名，视口加载完给的；部件检查器要用。 */
const modelNodes = ref<readonly string[]>([])
/** 视口里正在飞漫游预览；它会被用户一碰镜头就停，所以由视口回传而不是这里说了算。 */
const roamPreviewing = ref(false)
/** 视口回传的世界坐标基准原点。 */
const frameOrigin = ref<Vec3>([0, 0, 0])
const config = computed(() => page.doc.value?.config.value ?? null)
const {
  modelStatus,
  animationClips,
  selectedAnimation,
  animationTest,
  currentAnimation,
  missingAnimations,
  selectAnimation,
  resetAnimation,
} = useTwinAnimationSelection(
  () => config.value,
  () => selection.value,
)

const isDirty = computed(
  () =>
    (page.doc.value?.isDirty.value ?? false) ||
    missingAnimations.value.size > 0,
)

const hidden = useEditorHidden(
  () => config.value,
  () => `${dashboardId.value}/${nodeId.value}`,
)
const bulk = useBulkParts(
  () => config.value,
  () => modelNodes.value,
)
const gizmoMode = useGizmoMode(
  () => selection.value,
  () => config.value,
)
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
})

// ⚠ 模板里的 `ref="viewportRef"` 只认得顶层绑定，写成 `viewport.viewportRef`
// 会被当成一个字符串 ref 名，视口句柄永远是 null
const viewportRef = viewport.viewportRef
const navigation = useTwinNavigation(
  viewportRef,
  () => selection.value,
  hidden.reset,
)

// 右栏那几个距离阈值旁边的「量当前距离」按它取数
provideTwinMeasure(viewport.measureDistance)

// 助手：改配置 + 绑点 + 读数 + 保存 + 截视口（WebGL 走场景登记的快照替身，
// 见 captureWithGl）。⚠ 选中要透进去：用户在大纲里点了一个说「把这个接上」，
// 快照里没有选中的话，模型只能挑一个它自己觉得像的去改
const ai = useTwinAi(
  page,
  binding,
  () => config.value,
  () => selection.value,
  () => viewportRef.value?.stageEl() ?? null,
)

// 换了选中就断开检查器的合并段：回到同一个字段再改，是另一次编辑
watch(selection, () => page.doc.value?.endMerge())

function select(next: TwinSelection): void {
  resetAnimation()
  selection.value = next
}

/** 锚点和信息牌先拾取位置，再创建并归夹。 */
function addEntityOf(kind: TwinEntityKind, folderId?: string): void {
  viewport.cancelPick()
  if (kind === 'anchors' || kind === 'panels') {
    viewport.requestPlace(kind, folderId)
    return
  }
  actions.value?.add(kind, folderId)
}

function addFolderIn(kind: TwinEntityKind): void {
  renamingFolderId.value = actions.value?.addFolder(kind) ?? null
}

function createFolderWith(payload: { kind: TwinEntityKind; id: string }): void {
  renamingFolderId.value =
    actions.value?.addFolderWithItem(payload.kind, payload.id) ?? null
}

function onBatchConfig(next: TwinConfig): void {
  const doc = page.doc.value
  const count = doc === null ? 0 : applyBatchConfig(doc, next)
  if (count > 0) toast.success(`已更新 ${count} 个部件，可整体撤销`)
}
function onBatchBindings(next: readonly BindingPayload[]): void {
  const doc = page.doc.value
  const count = doc === null ? 0 : applyBatchBindings(doc, next)
  if (count > 0) toast.success(`已替换 ${count} 条草稿绑定，可整体撤销`)
}

async function save(): Promise<void> {
  const ok = await page.save()
  if (ok) toast.success('孪生场景已保存')
  else if (page.conflict.value !== null) await offerReload(page.conflict.value)
  else toast.error('保存失败，请重试')
}

/** 版本冲突后给一条出路：按最新那一版重读，代价是这里没保存的改动。 */
async function offerReload(conflict: string): Promise<void> {
  const ok = await confirm.ask({
    title: '大屏在别处被改过',
    message: `${conflict}重新加载会丢弃这里还没保存的改动。`,
    confirmText: '重新加载',
    danger: true,
  })
  if (ok) await page.reload()
}

useTwinShortcuts({
  handlers: {
    save: () => {
      if (isDirty.value && !page.saving.value) void save()
    },
    undo: () => page.doc.value?.undo(),
    redo: () => page.doc.value?.redo(),
    remove: () =>
      void removeSelectedEntity({
        config: config.value,
        selection: selection.value,
        ask: confirm.ask,
        remove: (kind, id) => actions.value?.remove(kind, id),
      }),
  },
  suspended: () =>
    viewport.isPicking.value || batchOpen.value || bulk.open.value,
})

/** 返回大屏编辑器；外壳的返回入口按站内路径走。 */
const backTo = computed(() => `/dashboards/${dashboardId.value}/edit`)

// ⚠ 切换页签保留草稿；关闭时必须确认，浏览器刷新由 useUnsavedGuard 拦截。
useWorkspaceGuard(async () => {
  if (page.doc.value?.isDirty.value !== true) return true
  return await confirm.ask({
    title: '放弃未保存的改动',
    message: '孪生场景存在未保存的更改，离开后将丢失。',
    confirmText: '离开',
    danger: true,
  })
})

useUnsavedGuard(() => page.doc.value?.isDirty.value === true)
</script>

<template>
  <AppShell
    title="孪生编辑器"
    :focus-mode="focusMode"
    :subtitle="page.dashboard.value?.name ?? ''"
    :back-to="backTo"
    :back-label="page.dashboard.value?.name ?? '返回大屏编辑器'"
  >
    <template #actions>
      <TwinEditorToolbar
        :is-dirty="isDirty"
        :focus-mode="focusMode"
        :can-batch="config !== null"
        :is-saving="page.saving.value"
        :can-undo="page.doc.value?.canUndo.value ?? false"
        :can-redo="page.doc.value?.canRedo.value ?? false"
        :issue-count="issues.length"
        :navigation-mode="editorNavigationMode"
        @toggle-focus="focusMode = !focusMode"
        @batch="batchOpen = true"
        @save="save"
        @undo="page.doc.value?.undo()"
        @redo="page.doc.value?.redo()"
        @toggle-issues="showIssues = !showIssues"
        @update:navigation-mode="editorNavigationMode = $event"
      />
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <DtPageState
        v-if="
          page.loading.value || page.error.value !== null || config === null
        "
        :loading="page.loading.value"
        :error="page.error.value"
        :empty="false"
      />
      <DtResizableLayout
        v-else
        class="min-h-0 flex-1"
        :panes="[
          { id: 'outline', label: '大纲', size: 1, minSize: 220 },
          { id: 'viewport', label: '视口', size: 3, minSize: 320 },
          { id: 'inspector', label: '配置', size: 1.2, minSize: 280 },
        ]"
        :stack-at="1000"
        storage-key="dt.twin-editor.layout"
      >
        <template #outline>
          <TwinLeftPane
            :bindings="binding.bindings.value"
            :animations="{
              clips: animationClips,
              selected: selectedAnimation,
              status: modelStatus,
            }"
            class="min-h-0 min-w-0 flex-1 overflow-hidden"
            :config="hidden.config.value ?? config"
            :selection="selectedAnimation === null ? selection : null"
            :flagged-ids="flaggedIds"
            :renaming-folder-id="renamingFolderId"
            @focus="navigation.focus($event)"
            @select-animation="selectAnimation"
            @select="select"
            @add="addEntityOf"
            @add-in-folder="addEntityOf($event.kind, $event.folderId)"
            @place="actions?.place($event)"
            @bulk-add="bulk.openBlank()"
            @remove="actions?.remove($event.kind, $event.id)"
            @duplicate="actions?.duplicate($event.kind, $event.id)"
            @move="actions?.move($event.kind, $event.id, $event.delta)"
            @toggle-editor-visible="hidden.toggle"
            @add-folder="addFolderIn"
            @rename-folder="actions?.renameFolder($event.id, $event.name)"
            @remove-folder="actions?.removeFolder($event)"
            @move-into-folder="
              actions?.moveIntoFolder($event.folderId, $event.id)
            "
            @remove-from-folder="actions?.removeFromFolder($event)"
            @create-folder-with-item="createFolderWith"
          />
        </template>
        <template #viewport>
          <div class="flex min-h-0 min-w-0 flex-col">
            <!-- 画中画钉在视口这一块上，诊断面板展开时不会被它压住 -->
            <div class="relative flex min-h-0 flex-1">
              <TwinViewportTools
                :isolated="navigation.isolated.value"
                :can-isolate="
                  selection.kind === 'parts' && modelStatus === 'ready'
                "
                :can-back="navigation.canBack.value"
                @focus="navigation.focus(selection)"
                @overview="navigation.focus(TWIN_SELECT_MODEL)"
                @isolate="navigation.toggleIsolation"
                @reset="navigation.reset"
                @back="navigation.back"
              />
              <TwinViewport
                ref="viewportRef"
                class="min-h-0 flex-1"
                :config="hidden.config.value ?? config"
                :selection="selection"
                :pick-mode="viewport.pickMode.value"
                :navigation-mode="editorNavigationMode"
                :pick-hint="viewport.placementHint.value"
                :gizmo-mode="gizmoMode"
                :target-size="page.targetSize.value"
                :values="binding.liveValues.value"
                :data-warning="binding.datasetWarning.value"
                @select="selection = $event ?? TWIN_SELECT_MODEL"
                @pick-node="viewport.onPickNode"
                @pick-position="viewport.onPickPosition"
                @cancel-pick="viewport.cancelPick"
                @model-nodes="modelNodes = $event"
                @model-animations="animationClips = $event"
                @status="modelStatus = $event"
                @frame-origin="frameOrigin = $event"
                @roam-preview="roamPreviewing = $event"
                @entity-transform="actions?.transformEntity($event)"
                @entity-transform-end="actions?.endTransform()"
                @marquee-nodes="viewport.onSelectNodes"
              />
              <TwinConfigPreview
                ref="configPreviewRef"
                :node="page.node.value"
                :config="config"
                :selection="selection"
                :animation="currentAnimation"
                :test-mode="animationTest"
                :bindings="binding.bindings.value"
                :read-binding="binding.readBinding"
                @roam-playing="roamPreviewing = $event"
                @part-detail-view="viewport.savePartDetailView"
              />
            </div>
            <TwinDiagnosticsPanel
              v-if="showIssues"
              class="max-h-48 shrink-0 overflow-y-auto border-t border-border-subtle"
              :issues="issues"
              @focus="select"
            />
          </div>
        </template>
        <template #inspector>
          <div class="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <TwinSelectionContext
              :config="config"
              :selection="selection"
              :clips="animationClips"
              :animation="selectedAnimation"
              @select="select"
              @focus="navigation.focus($event)"
              @select-animation="selectAnimation"
            />
            <TwinAnimationInspector
              v-if="selectedAnimation !== null"
              class="min-h-0 flex-1"
              :config="config"
              :clip="selectedAnimation"
              :bindings="binding.bindings.value"
              :value="binding.liveValues.value?.animations?.[selectedAnimation]"
              :available="currentAnimation !== null"
              :is-dirty="isDirty"
              :test-mode="animationTest"
              @patch="actions?.patchInspector($event)"
              @pick="binding.pickingFieldKey.value = $event"
              @drop="binding.drop"
              @test="animationTest = $event"
            />
            <TwinRightPane
              v-else
              v-model:gizmo-mode="gizmoMode"
              class="min-h-0 min-w-0 overflow-hidden"
              :config="config"
              :selection="selection"
              :model-nodes="modelNodes"
              :picking="viewport.isPicking.value"
              :roam-previewing="roamPreviewing"
              :frame-origin="frameOrigin"
              :bindings="binding.bindings.value"
              :is-dirty="isDirty"
              @patch="actions?.patchInspector($event)"
              @request-pick="viewport.requestPick"
              @cancel-pick="viewport.cancelPick"
              @capture-camera="viewport.captureCamera"
              @capture-part-view="viewport.capturePartView"
              @edit-part-detail-view="
                configPreviewRef?.editPartDetailView($event)
              "
              @select-part="select({ kind: 'parts', id: $event })"
              @preview-roam="configPreviewRef?.playRoam()"
              @stop-roam-preview="configPreviewRef?.stopRoam()"
              @write-binding="binding.write"
              @drop-binding="binding.drop"
              @add-binding="binding.bind"
              @pick-point="binding.pickingFieldKey.value = $event"
              @remove-binding-row="binding.removeRow"
            />
          </div>
        </template>
      </DtResizableLayout>
    </div>

    <TwinBatchConfig
      v-if="config"
      :open="batchOpen"
      :config="config"
      :bindings="binding.bindings.value"
      :selection="selection"
      :animation="selectedAnimation"
      @update:open="batchOpen = $event"
      @copy="onBatchConfig"
      @replace="onBatchBindings"
    />
    <TwinOverlays
      :bulk="bulk"
      :binding="binding"
      :ai="ai"
      @add-parts="actions?.addParts($event)"
      @update:bulk-open="bulk.open.value = $event"
    />
  </AppShell>
</template>
