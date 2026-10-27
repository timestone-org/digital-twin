<script setup lang="ts">
/** @fileoverview 建模流水线的编辑、运行与回看工作面，见 docs/MODELING_DESIGN.md §9。 */
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtPageState,
  DtResizableLayout,
  useToast,
} from '@dt/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { nowStamp } from '@/utils/datetime'
import { useAuthStore } from '@/stores/auth'
import PublishTemplateButton from '../components/PublishTemplateButton.vue'

import CanvasMenu from './components/CanvasMenu.vue'
import CanvasWorkspaceBar from './components/CanvasWorkspaceBar.vue'
import ConfigEditorDialog from './components/ConfigEditorDialog.vue'
import EditorCanvas from './components/EditorCanvas.vue'
import GraphIssues from './components/GraphIssues.vue'
import OperatorPalette from './components/OperatorPalette.vue'
import ResultDialog from './components/ResultDialog.vue'
import RunControls from './components/RunControls.vue'
import RunHistory from './components/RunHistory.vue'
import ShortcutsHelp from './components/ShortcutsHelp.vue'
import { cascadeFrom } from './scripts/nodeLayout'
import { confirmReplay } from './scripts/confirmReplay'
import { progressOf } from './scripts/runProgress'
import type { CanvasPoint } from './scripts/useCanvasViewport'
import { defaultsOf, fieldsOf } from './scripts/schemaForm'
import type { CanvasHandle } from './scripts/useCanvasActions'
import { useCanvasActions } from './scripts/useCanvasActions'
import { useConfigPanel } from './scripts/useConfigPanel'
import { edgeOf } from './scripts/useCanvasWiring'
import { useCanvasMenu } from './scripts/useCanvasMenu'
import { useCanvasPage } from './scripts/useCanvasPage'
import { useCanvasSaving } from './scripts/useCanvasSaving'
import { useCanvasLeaveGuard } from './scripts/useCanvasLeaveGuard'
import { useCanvasShortcuts } from './scripts/useCanvasShortcuts'
import { useResultPanel } from './scripts/useResultPanel'

const route = useRoute()
const router = useRouter()
const page = useCanvasPage()
const auth = useAuthStore()
const toast = useToast()

// 运行计时
const tick = ref(nowStamp())
const clock = ref<ReturnType<typeof setInterval> | null>(null)

// ⚠ 手工与 EditorCanvas 的 `defineExpose` 对齐：`InstanceType<typeof 组件>` 取不到
// `defineExpose` 的类型（会塌成 any），写错了 typecheck 与 lint 都不拦
const canvasRef = ref<CanvasHandle | null>(null)
watch(
  canvasRef,
  (canvas) => {
    if (canvas === null) return
    void nextTick(() => {
      if (canvasRef.value === canvas) canvas.fit()
    })
  },
  { flush: 'post' },
)
const renameNodeId = ref<string | null>(null)
const renameDraft = ref('')
const isHistoryOpen = ref(false)
const isKeysOpen = ref(false)
/** 吸附对齐默认开着：图一多，手摆的卡片很难对齐，而歪一点点就看着乱。 */
const isSnapping = ref(true)

const pipelineId = computed(() => String(route.params['pipelineId'] ?? ''))
// 全量结果保留开关
const isKeepingFrames = ref(false)
const isReadonly = computed(
  () =>
    page.isReplaying.value ||
    page.isOpening.value ||
    !auth.can([PERMISSION_CODES.modelingManage], 'all'),
)

const config = useConfigPanel({
  graph: page.graph.graph,
  operators: page.operatorMap,
  knownColumns: page.doc.knownColumns,
  setConfig: page.graph.setConfig,
  canViewLedger: () => auth.can([PERMISSION_CODES.datasetView]),
})
const saving = useCanvasSaving(
  page,
  () => pipelineId.value,
  () => isKeepingFrames.value,
  () => config.blockReason.value,
)
useCanvasLeaveGuard(
  () => page.graph.isDirty.value || config.hasDraft.value,
  () => {
    saving.cancel()
    config.discard()
  },
)

const actions = useCanvasActions({
  graph: page.graph,
  selection: page.selection,
  canvas: () => canvasRef.value,
  toast,
})

const menu = useCanvasMenu({
  actions,
  selection: page.selection,
  graph: page.graph.graph,
  isReadonly: () => isReadonly.value,
  hasResult: (id) => page.runtime.value.get(id)?.hasResult === true,
  onRename: (id) => openRename(id),
  onOpenConfig: (id) => config.open(id),
  onOpenResult: (id) => void result.open(id),
})

const result = useResultPanel({
  graph: page.graph.graph,
  operators: page.operatorMap,
  nodeRunOf: (id) => page.runner.previews.value.get(id),
  loadPreview: page.runner.loadPreview,
  runGraph: () => page.runner.run.value?.graph ?? null,
})

/** 点问题条里的卡片名：选中它并把参数面板开在那一项上。 */
function focusIssue(nodeId: string): void {
  page.selection.select({ kind: 'node', id: nodeId })
  config.open(nodeId)
}

/** 点算子面板：落在视野正中，连着点几次就错开一点，免得叠在一起。 */
function addOperator(code: string): void {
  const at = canvasRef.value?.center() ?? { left: 80, top: 80 }
  dropOperator(code, cascadeFrom(at, page.graph.graph.value.nodes.length))
}

/** 拖进画布：落在指针指的那一点。 */
function dropOperator(code: string, at: CanvasPoint): void {
  const spec = page.operatorMap.value.get(code)
  if (spec === undefined) return
  const id = page.graph.addNode(
    code,
    at,
    defaultsOf(fieldsOf(spec.config_schema)),
  )
  page.selection.select({ kind: 'node', id })
}

const progress = computed(() => progressOf(page.runner.run.value, tick.value))

function openRename(nodeId: string): void {
  const node = page.graph.graph.value.nodes.find((item) => item.id === nodeId)
  renameDraft.value = node?.alias ?? ''
  renameNodeId.value = nodeId
}

function applyRename(): void {
  const id = renameNodeId.value
  if (id !== null) page.graph.setAlias(id, renameDraft.value.trim())
  renameNodeId.value = null
}

/** 回看运行并把运行 id 写入地址栏，供刷新与分享恢复。 */
async function pickRun(runId: string): Promise<void> {
  if (
    !(await confirmReplay(
      page.graph.isDirty.value || config.hasDraft.value,
      page.isReplaying.value,
    ))
  )
    return
  config.discard()
  isHistoryOpen.value = false
  await router.replace({ query: { ...route.query, run_id: runId } })
  await page.replay(runId)
}

async function leaveReplay(): Promise<void> {
  const query = { ...route.query }
  delete query['run_id']
  await router.replace({ query })
  page.backToEditing(page.doc.pipeline.value?.graph ?? null)
}

/** 选中的头一个节点；改名与「回车看参数」都对着它。 */
function firstSelected(): string | null {
  return page.selection.selectedNodeIds.value[0] ?? null
}

useCanvasShortcuts({
  removeSelected: actions.removeSelected,
  undo: () => page.graph.undo(),
  redo: () => page.graph.redo(),
  clearSelection: () => page.selection.clear(),
  selectAll: actions.selectAll,
  copy: actions.copy,
  paste: actions.paste,
  duplicate: actions.duplicate,
  nudge: actions.nudge,
  fit: actions.fit,
  rename: () => {
    const id = firstSelected()
    if (id !== null) openRename(id)
  },
  openConfig: () => {
    const id = firstSelected()
    if (id !== null) config.open(id)
  },
  canEdit: () => !isReadonly.value,
})

onBeforeUnmount(() => {
  if (clock.value !== null) clearInterval(clock.value)
})

onMounted(() => {
  clock.value = setInterval(() => (tick.value = nowStamp()), 1000)
  void config.loadTables()
})

watch(
  pipelineId,
  async (id) => {
    const wanted = route.query['run_id']
    if (!(await page.open(id)) || pipelineId.value !== id) return
    // 带着 ?run_id= 进来的（同事发过来的链接、或刷新）直接落到只读回看
    if (typeof wanted === 'string' && wanted !== '') await page.replay(wanted)
  },
  { immediate: true },
)
</script>

<template>
  <AppShell
    :title="page.doc.pipeline.value?.name ?? '画布'"
    :subtitle="page.doc.pipeline.value?.code ?? ''"
    back-to="/modeling/pipelines"
  >
    <template #actions>
      <DtButton
        v-if="page.isReplaying.value"
        variant="ghost"
        size="sm"
        icon="undo"
        @click="void leaveReplay()"
      >
        回到编辑
      </DtButton>
      <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
        <DtButton
          variant="outline"
          size="sm"
          :disabled="
            isReadonly ||
            !page.graph.isDirty.value ||
            config.blockReason.value !== '' ||
            saving.isPreparingRun.value
          "
          :loading="page.doc.isSaving.value"
          intent="primary"
          icon="save"
          aria-label="保存"
          @click="void saving.save()"
          >保存</DtButton
        >
      </PermGuard>
      <PermGuard :codes="[PERMISSION_CODES.modelingRun]" explain>
        <RunControls
          v-model:is-keeping-frames="isKeepingFrames"
          :is-running="
            ['pending', 'running', 'cancelling'].includes(
              page.runner.run.value?.status ?? '',
            )
          "
          :is-readonly="isReadonly || config.blockReason.value !== ''"
          :is-starting="
            page.runner.isStarting.value ||
            saving.isPreparingRun.value ||
            page.doc.isSaving.value
          "
          @run="void saving.run()"
          @cancel="void page.runner.cancel()"
        />
      </PermGuard>
    </template>

    <CanvasWorkspaceBar
      v-if="!page.isOpening.value && !page.doc.error.value"
      :state="{
        isReadonly,
        isReplaying: page.isReplaying.value,
        isDirty: page.graph.isDirty.value || config.hasDraft.value,
        canUndo: page.graph.canUndo.value,
        canRedo: page.graph.canRedo.value,
        canConfigure: page.selection.selectedNodeIds.value.length === 1,
        nodeCount: page.graph.graph.value.nodes.length,
        progress,
      }"
      @undo="page.graph.undo()"
      @redo="page.graph.redo()"
      @configure="
        firstSelected() !== null && config.open(firstSelected() ?? '')
      "
      @history="isHistoryOpen = true"
      @shortcuts="isKeysOpen = true"
    >
      <PublishTemplateButton
        :pipeline="page.doc.pipeline.value"
        :disabled="
          isReadonly || page.graph.isDirty.value || config.hasDraft.value
        "
      />
    </CanvasWorkspaceBar>
    <DtPageState
      v-if="page.isOpening.value || page.doc.error.value"
      :loading="page.isOpening.value"
      :error="page.doc.error.value"
      :empty="false"
    />
    <DtResizableLayout
      v-else
      class="dt-ml-page h-full min-h-0 flex-1"
      storage-key="dt.modeling-canvas.layout"
      :stack-at="640"
      :panes="[
        { id: 'operators', label: '算子库', size: 18, minSize: 180 },
        { id: 'canvas', label: '建模画布', size: 82, minSize: 320 },
      ]"
    >
      <template #operators>
        <OperatorPalette
          style="width: 100%; min-height: 0; flex: 1"
          :operators="page.operators.value"
          :is-readonly="isReadonly"
          @pick="addOperator"
        />
      </template>
      <template #canvas>
        <div class="dt-ml-page__main">
          <DtNotice v-if="config.blockReason.value" intent="warning">
            {{ config.blockReason.value }}；请先改正或应用参数，再保存或运行。
          </DtNotice>
          <p class="m-0 text-caption text-text-secondary">
            双击节点配置参数 → 点击运行自动保存并校验 →
            点击节点上的「结果」查看输出
          </p>
          <GraphIssues
            v-if="page.issueViews.value.length > 0"
            :issues="page.issueViews.value"
            @pick="focusIssue"
          />
          <DtNotice
            v-else-if="page.graph.graph.value.nodes.length === 0 && !isReadonly"
            intent="info"
            icon="circle-question"
          >
            把左边的算子拖到画布上开始；连线是从卡片右侧的圆点拉到下游那张卡片上，
            松手落在卡片任意位置都算。选中多个之后右键可以对齐。
          </DtNotice>
          <EditorCanvas
            ref="canvasRef"
            class="dt-ml-page__canvas"
            :graph="page.graph.graph.value"
            :operators="page.operatorMap.value"
            :runtime="page.runtime.value"
            :selection="{
              nodes: page.selection.selectedNodeIds.value,
              edges: page.selection.selectedEdgeIds.value,
            }"
            :is-readonly="isReadonly"
            :is-snapping="isSnapping"
            @pick-node="
              (id, additive) =>
                additive
                  ? page.selection.toggle({ kind: 'node', id })
                  : page.selection.select({ kind: 'node', id })
            "
            @pick-edge="(id) => page.selection.select({ kind: 'edge', id })"
            @pick-nothing="page.selection.clear"
            @box-select="page.selection.selectNodes"
            @move-nodes="page.graph.moveNodes"
            @connect="(out, into) => page.graph.addEdge(edgeOf(out, into))"
            @remove-edge="actions.removeEdge"
            @reject="(reason) => toast.warning(reason)"
            @open-config="config.open"
            @open-result="(id) => void result.open(id)"
            @drop-operator="dropOperator"
            @open-menu="menu.open"
            @auto-layout="actions.autoLayout"
            @toggle-snap="isSnapping = !isSnapping"
          />
        </div>
      </template>
    </DtResizableLayout>

    <CanvasMenu :menu="menu.menu.value" @pick="menu.run" @close="menu.close" />

    <ConfigEditorDialog
      :node="config.node.value"
      :operator="config.spec.value"
      :fields="config.fields.value"
      :options="config.options.value"
      :is-readonly="isReadonly"
      @change="config.setValue"
      @status="config.setStatus"
      @reload-tables="config.loadTables"
      @close="config.close"
    />

    <DtModal
      :model-value="renameNodeId !== null"
      title="给这一步改个名"
      description="留空就用算子本来的名字。"
      width="22rem"
      @update:model-value="renameNodeId = null"
    >
      <DtInput
        v-model="renameDraft"
        label="显示名"
        placeholder="例如：剔除异常行"
        @keyup.enter="applyRename"
      />
      <template #footer>
        <DtButton variant="ghost" @click="renameNodeId = null">取消</DtButton>
        <DtButton @click="applyRename">改名</DtButton>
      </template>
    </DtModal>

    <ResultDialog
      :detail="result.detail.value"
      :labels="result.labels.value"
      :run-id="page.runner.run.value?.id"
      :node-id="result.nodeId.value"
      :config="result.config.value"
      @close="result.close"
    />

    <DtModal v-model="isKeysOpen" title="快捷键与手势" width="34rem">
      <ShortcutsHelp />
    </DtModal>

    <DtModal v-model="isHistoryOpen" title="运行历史" width="26rem">
      <RunHistory
        :runs="page.runs.value"
        :current-id="page.runner.run.value?.id ?? null"
        @pick="(id) => void pickRun(id)"
      />
    </DtModal>
  </AppShell>
</template>

<style scoped lang="scss">
.dt-ml-page {
  &__main {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    min-height: 0;
  }
  &__canvas {
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
}
</style>
