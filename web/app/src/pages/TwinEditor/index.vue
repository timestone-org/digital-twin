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
import type { BindingPayload } from '@dt/contracts'
import { collectTwinConfigIssues } from '@dt/twin-config'
import type { TwinConfig, TwinNavigationMode, Vec3 } from '@dt/twin-config'
import {
  DtPageState,
  EditorSplitter,
  useEditorPanes,
  useConfirm,
  useToast,
} from '@dt/ui'
import type { ModelAnimationEntry } from '@dt/three-core'
import { computed, ref, watch, provide } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'

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
import {
  TWIN_SELECT_MODEL,
  type TwinEntityKind,
  type TwinSelection,
} from './scripts/types'
import { useBulkParts } from './scripts/useBulkParts'
import { useGizmoMode } from './scripts/useGizmoMode'
import { useTwinAi } from './scripts/useTwinAi'
import { useTwinEditorPage } from './scripts/useTwinEditorPage'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'

// ⚠ 子编辑器也要装：直接刷新到这条路由时大屏那三页一个都没跑过，
// 不装的话模型地址解析恒回空串，画面上是一句「模型地址解析失败」
installDashboardModules()

const panes = useEditorPanes('dt.twin-editor.panes')
const gridRef = panes.hostRef

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
const configPreviewRef = ref<InstanceType<typeof TwinConfigPreview> | null>(
  null,
)
provide(TWIN_PREVIEW_INTENT, (mode) => {
  configPreviewRef.value?.showPartMode(mode)
})
const modelStatus = ref('empty')
const animationClips = ref<readonly ModelAnimationEntry[]>([])
const selectedAnimation = ref<string | null>(null)
const animationTest = ref<'live' | 'play' | 'pause' | 'reset'>('live')
const currentAnimation = computed(
  () =>
    animationClips.value.find(
      (item) => item.name === selectedAnimation.value,
    ) ?? null,
)
watch(selection, () => {
  selectedAnimation.value = null
  animationTest.value = 'live'
})
function selectAnimation(name: string): void {
  selectedAnimation.value = name
  animationTest.value = 'live'
}
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
/**
 * 当前坐标基准的原点（世界坐标）。
 * ⚠ 由视口回传而不是这里算：「模型中心」那一档取的是模型世界包围盒的中心，
 * 配置里没有这个数——右栏的坐标框与视口里的参考轴必须同源，否则两处的 0 不在一处。
 */
const frameOrigin = ref<Vec3>([0, 0, 0])
const config = computed(() => page.doc.value?.config.value ?? null)
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
  onRoamUnavailable: () => toast.error('轨迹上可用的视点不足两个，先去加几站'),
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

function select(next: TwinSelection): void {
  selectedAnimation.value = null
  animationTest.value = 'live'
  selection.value = next
  // 选中即取景：在大纲里点一个锚点，视口该把镜头带过去
  navigation.focus(next)
}

/** 信息牌走「先点位置再落牌」：进入拾取，等视口回传表面点；其余实体直接建。 */
function addEntityOf(kind: TwinEntityKind): void {
  if (kind === 'panels') {
    viewport.requestPlacePanel()
    return
  }
  actions.value?.add(kind)
}

function addFolderIn(kind: TwinEntityKind): void {
  renamingFolderId.value = actions.value?.addFolder(kind) ?? null
}

function createFolderWith(payload: { kind: TwinEntityKind; id: string }): void {
  renamingFolderId.value =
    actions.value?.addFolderWithItem(payload.kind, payload.id) ?? null
}

function applyBatchConfig(next: TwinConfig): void {
  const doc = page.doc.value
  if (doc === null) return
  const count = doc.config.value.parts.filter(
    (part) =>
      JSON.stringify(part) !==
      JSON.stringify(next.parts.find((item) => item.id === part.id)),
  ).length
  if (count === 0) return
  doc.commit(next)
  toast.success(`已更新 ${count} 个部件，可整体撤销`)
}
function applyBatchBindings(next: readonly BindingPayload[]): void {
  const doc = page.doc.value
  if (doc === null) return
  const count = next.filter(
    (item) =>
      doc.bindings.value.find((old) => old.id === item.id)?.nodeKey !==
      item.nodeKey,
  ).length
  if (count === 0) return
  doc.commitBindings(next)
  toast.success(`已替换 ${count} 条草稿绑定，可整体撤销`)
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
    :focus-mode="focusMode"
    :subtitle="page.dashboard.value?.name ?? ''"
    :back-to="backTo"
    :back-label="page.dashboard.value?.name ?? '返回大屏编辑器'"
  >
    <template #actions>
      <TwinEditorToolbar
        :is-dirty="page.doc.value?.isDirty.value ?? false"
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
      <div
        v-else
        ref="gridRef"
        class="grid min-h-0 flex-1"
        :style="panes.gridStyle.value"
      >
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
          @select-animation="selectAnimation"
          @select="select"
          @add="addEntityOf"
          @add-in-folder="actions?.add($event.kind, $event.folderId)"
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
        <EditorSplitter side="left" label="大纲栏宽度" :panes="panes" />

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
              :pick-hint="
                viewport.isPlacingPanel.value
                  ? '在模型表面点一下，新信息牌会吸附到那个点'
                  : undefined
              "
              :gizmo-mode="gizmoMode"
              :target-size="page.targetSize.value"
              :values="binding.liveValues.value"
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
            />
          </div>
          <TwinDiagnosticsPanel
            v-if="showIssues"
            class="max-h-48 shrink-0 overflow-y-auto border-t border-border-subtle"
            :issues="issues"
            @focus="select"
          />
        </div>

        <EditorSplitter side="right" label="配置栏宽度" :panes="panes" />

        <div class="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <TwinSelectionContext
            :config="config"
            :selection="selection"
            :clips="animationClips"
            :animation="selectedAnimation"
            @select="select"
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
            :is-dirty="page.doc.value?.isDirty.value ?? false"
            :test-mode="animationTest"
            @patch="actions?.patchConfig($event)"
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
            :is-dirty="page.doc.value?.isDirty.value ?? false"
            @patch="actions?.patchConfig($event)"
            @request-pick="viewport.requestPick"
            @cancel-pick="viewport.cancelPick"
            @capture-camera="viewport.captureCamera"
            @capture-part-view="viewport.capturePartView"
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
      </div>
    </div>

    <TwinBatchConfig
      v-if="config"
      :open="batchOpen"
      :config="config"
      :bindings="binding.bindings.value"
      :selection="selection"
      :animation="selectedAnimation"
      @update:open="batchOpen = $event"
      @copy="applyBatchConfig"
      @replace="applyBatchBindings"
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
