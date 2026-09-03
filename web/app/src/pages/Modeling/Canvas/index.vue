<script setup lang="ts">
/**
 * @fileoverview 一条流水线的画布：摆算子、连线、配参数、跑、看结果。
 * 见 docs/MODELING_DESIGN.md §9。
 *
 * ⚠ 画布是**自绘**的，不引图编辑框架（ADR-0028 同一条理由）。手势、视口与
 * 几何都在 `scripts/` 下的那几个组合式里。
 * ⚠ 「运行中」不锁编辑：运行吃的是发起那一刻**冻结的**图，改画布不影响它。
 * 锁编辑的只有回看历史与没有写权限两种。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtPageState,
  DtTag,
  useToast,
} from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { nowStamp } from '@/utils/datetime'
import { useAuthStore } from '@/stores/auth'

import CanvasMenu from './components/CanvasMenu.vue'
import ConfigForm from './components/ConfigForm.vue'
import EditorCanvas from './components/EditorCanvas.vue'
import GraphIssues from './components/GraphIssues.vue'
import OperatorPalette from './components/OperatorPalette.vue'
import ResultDialog from './components/ResultDialog.vue'
import RunControls from './components/RunControls.vue'
import RunHistory from './components/RunHistory.vue'
import ShortcutsHelp from './components/ShortcutsHelp.vue'
import { cascadeFrom } from './scripts/nodeLayout'
import { progressOf } from './scripts/runProgress'
import type { CanvasPoint } from './scripts/useCanvasViewport'
import { defaultsOf, fieldsOf } from './scripts/schemaForm'
import type { CanvasHandle } from './scripts/useCanvasActions'
import { useCanvasActions } from './scripts/useCanvasActions'
import { useConfigPanel } from './scripts/useConfigPanel'
import { edgeOf } from './scripts/useCanvasWiring'
import { useCanvasMenu } from './scripts/useCanvasMenu'
import { useCanvasPage } from './scripts/useCanvasPage'
import { useCanvasShortcuts } from './scripts/useCanvasShortcuts'
import { useResultPanel } from './scripts/useResultPanel'

const route = useRoute()
const router = useRouter()
const page = useCanvasPage()
const auth = useAuthStore()
const toast = useToast()

// 「已用多久」要自己走字：只靠轮询回包重算的话，两拍之间那一秒是不动的
const tick = ref(nowStamp())
const clock = ref<ReturnType<typeof setInterval> | null>(null)

// ⚠ 手工与 EditorCanvas 的 `defineExpose` 对齐：`InstanceType<typeof 组件>` 取不到
// `defineExpose` 的类型（会塌成 any），写错了 typecheck 与 lint 都不拦
const canvasRef = ref<CanvasHandle | null>(null)
const renameNodeId = ref<string | null>(null)
const renameDraft = ref('')
const isHistoryOpen = ref(false)
const isKeysOpen = ref(false)
/** 吸附对齐默认开着：图一多，手摆的卡片很难对齐，而歪一点点就看着乱。 */
const isSnapping = ref(true)

const pipelineId = computed(() => String(route.params['pipelineId'] ?? ''))
// ⚠ 只读来自两个互不相同的理由，界面上也要分开说：回看历史时给的是「回到编辑」
// 那颗按钮，没有写权限时给的是 PermGuard 的那句说明
// 这次运行要不要留全量结果。⚠ 默认关，理由见上面那条注释
const isKeepingFrames = ref(false)

const isReadonly = computed(
  () =>
    page.isReplaying.value ||
    !auth.can([PERMISSION_CODES.modelingManage], 'all'),
)

const config = useConfigPanel({
  graph: page.graph.graph,
  operators: page.operatorMap,
  knownColumns: page.doc.knownColumns,
  setConfig: page.graph.setConfig,
  canViewLedger: () => auth.can([PERMISSION_CODES.datasetView]),
})

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
  previewOf: (id) => page.runner.previews.value.get(id)?.preview,
  loadPreview: page.runner.loadPreview,
  exportedPortsOf: (id) =>
    page.runner.previews.value.get(id)?.exported_ports ?? [],
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

async function saveGraph(): Promise<void> {
  if (await page.doc.save(page.graph.graph.value)) page.graph.markSaved()
}

/**
 * 存图 → 校验 → 起一次运行。
 *
 * ⚠ 校验要在前端这一步拦下来：后端那条 400 只带一句「流水线还有问题」，逐条
 * 定位信息在信封的 details 里，而 `describeError` 只取 message。
 */
async function runOnce(): Promise<void> {
  if (
    page.graph.isDirty.value &&
    !(await page.doc.save(page.graph.graph.value))
  )
    return
  page.graph.markSaved()
  page.stopChecking()
  if (!(await page.doc.validate(page.graph.graph.value))) {
    toast.warning(
      page.issueViews.value[0]?.message ?? '流水线还有问题，先改好再运行',
    )
    return
  }
  await page.runner.start(pipelineId.value, isKeepingFrames.value)
  await page.loadRuns(pipelineId.value)
}

/**
 * 回看某一次运行。
 *
 * ⚠ 运行 id 进地址栏：不进的话「把这次跑的结果发给同事看」只能靠口述第几条，
 * 而刷新一下就回到编辑态了。
 */
async function pickRun(runId: string): Promise<void> {
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

onMounted(async () => {
  clock.value = setInterval(() => (tick.value = nowStamp()), 1000)
  void config.loadTables()
  await page.open(pipelineId.value)
  // 带着 ?run_id= 进来的（同事发过来的链接、或刷新）直接落到只读回看
  const wanted = route.query['run_id']
  if (typeof wanted === 'string' && wanted !== '') await page.replay(wanted)
})
</script>

<template>
  <AppShell
    :title="page.doc.pipeline.value?.name ?? '画布'"
    :subtitle="page.doc.pipeline.value?.code ?? ''"
    back-to="/modeling/pipelines"
  >
    <template #actions>
      <DtTag v-if="page.isReplaying.value" intent="info" size="sm">
        正在回看历史运行
      </DtTag>
      <span v-if="progress" class="dt-ml-page__progress">{{ progress }}</span>
      <DtButton
        v-if="page.isReplaying.value"
        variant="ghost"
        size="sm"
        icon="undo"
        @click="void leaveReplay()"
      >
        回到编辑
      </DtButton>
      <DtButton
        class="dt-ml-page__terse"
        variant="ghost"
        size="sm"
        icon="keyboard"
        title="快捷键与手势"
        @click="isKeysOpen = true"
      >
        快捷键
      </DtButton>
      <DtButton
        class="dt-ml-page__terse"
        variant="ghost"
        size="sm"
        icon="list-checks"
        title="运行历史"
        @click="isHistoryOpen = true"
      >
        运行历史
      </DtButton>
      <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
        <DtButton
          class="dt-ml-page__terse"
          variant="ghost"
          size="sm"
          icon="undo"
          title="撤销（⌘Z）"
          :disabled="isReadonly || !page.graph.canUndo.value"
          @click="page.graph.undo()"
        >
          撤销
        </DtButton>
        <DtButton
          class="dt-ml-page__terse"
          variant="ghost"
          size="sm"
          icon="redo"
          title="重做（⌘⇧Z）"
          :disabled="isReadonly || !page.graph.canRedo.value"
          @click="page.graph.redo()"
        >
          重做
        </DtButton>
        <DtButton
          class="dt-ml-page__terse"
          variant="ghost"
          size="sm"
          icon="save"
          title="保存"
          :disabled="isReadonly || !page.graph.isDirty.value"
          :loading="page.doc.isSaving.value"
          @click="void saveGraph()"
        >
          保存
        </DtButton>
      </PermGuard>
      <PermGuard :codes="[PERMISSION_CODES.modelingRun]" explain>
        <RunControls
          v-model:is-keeping-frames="isKeepingFrames"
          :is-running="page.runner.run.value?.status === 'running'"
          :is-readonly="isReadonly"
          :is-starting="page.runner.isStarting.value"
          @run="void runOnce()"
          @cancel="void page.runner.cancel()"
        />
      </PermGuard>
    </template>

    <DtPageState
      v-if="page.doc.isLoading.value || page.doc.error.value"
      :loading="page.doc.isLoading.value"
      :error="page.doc.error.value"
      :empty="false"
    />
    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div v-else class="dt-ml-page flex h-full min-h-0">
      <OperatorPalette
        :operators="page.operators.value"
        :is-readonly="isReadonly"
        @pick="addOperator"
      />
      <div class="dt-ml-page__main">
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
    </div>

    <CanvasMenu :menu="menu.menu.value" @pick="menu.run" @close="menu.close" />

    <DtModal
      :model-value="config.node.value !== null"
      :title="config.spec.value?.name ?? '参数'"
      :description="config.spec.value?.description"
      width="34rem"
      @update:model-value="config.close"
    >
      <ConfigForm
        v-if="config.node.value"
        :fields="config.fields.value"
        :config="config.node.value.config"
        :options="config.options.value"
        :is-readonly="isReadonly"
        @change="config.setValue"
        @reload-tables="config.loadTables"
      />
    </DtModal>

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
      :payload="result.payload.value"
      :labels="result.labels.value"
      :run-id="page.runner.run.value?.id"
      :node-id="result.nodeId.value"
      :exported-ports="result.exportedPorts.value"
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
  &__progress {
    color: var(--text-secondary);
    font-family: var(--font-digit);
    font-size: var(--ctl-hint-fs-sm);
    white-space: nowrap;
  }

  // 顶栏在 2xl 以下摆不开八颗按钮；这几颗都带图标与 title，缩成只有图标
  @media (width < 96rem) {
    &__terse :deep(.dt-btn__label) {
      display: none;
    }
  }

  &__main {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    min-height: 0;
    // 只留左侧一格：画布框的上下边要与算子面板的外描边齐平
    padding: 0 0 0 0.75rem;
  }

  &__canvas {
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
}
</style>
