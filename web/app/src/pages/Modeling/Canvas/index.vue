<script setup lang="ts">
/**
 * @fileoverview 一条流水线的画布：摆算子、连线、配参数、跑、看结果。
 * 见 docs/MODELING_DESIGN.md §9。
 *
 * ⚠ 画布是**自绘**的，不引图编辑框架（ADR-0028 同一条理由）。手势、视口与
 * 几何都在 `scripts/` 下的几个组合式里。
 * ⚠ 「运行中」不锁编辑：运行吃的是发起那一刻**冻结的**图，改画布不影响它。
 * 锁编辑的只有回看历史与没有写权限两种。
 */
import type { ModelingGraphNode } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
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
import { formatElapsed, nowStamp } from '@/utils/datetime'
import { useAuthStore } from '@/stores/auth'

import ConfigForm from './components/ConfigForm.vue'
import EditorCanvas from './components/EditorCanvas.vue'
import OperatorPalette from './components/OperatorPalette.vue'
import ResultView from './components/ResultView.vue'
import RunHistory from './components/RunHistory.vue'
import { defaultsOf, fieldsOf } from './scripts/schemaForm'
import { useCanvasPage } from './scripts/useCanvasPage'
import { useCanvasShortcuts } from './scripts/useCanvasShortcuts'

const route = useRoute()
const router = useRouter()
const page = useCanvasPage()
const auth = useAuthStore()
const toast = useToast()

// 「已用多久」要自己走字：只靠轮询回包重算的话，两拍之间那一秒是不动的
const tick = ref(nowStamp())
const clock = ref<ReturnType<typeof setInterval> | null>(null)

const configNodeId = ref<string | null>(null)
const resultNodeId = ref<string | null>(null)
const isHistoryOpen = ref(false)

const pipelineId = computed(() => String(route.params['pipelineId'] ?? ''))
// ⚠ 只读来自两个互不相同的理由，界面上也要分开说：回看历史时给的是「回到编辑」
// 那颗按钮，没有写权限时给的是 PermGuard 的那句说明
const isReadonly = computed(
  () =>
    page.isReplaying.value ||
    !auth.can([PERMISSION_CODES.modelingManage], 'all'),
)

const configNode = computed<ModelingGraphNode | null>(
  () =>
    page.graph.graph.value.nodes.find(
      (item) => item.id === configNodeId.value,
    ) ?? null,
)
const configSpec = computed(() =>
  configNode.value === null
    ? undefined
    : page.operatorMap.value.get(configNode.value.operator),
)
const configFields = computed(() =>
  configSpec.value === undefined
    ? []
    : fieldsOf(configSpec.value.config_schema),
)
const resultPayload = computed(
  () =>
    page.runner.previews.value.get(resultNodeId.value ?? '')?.preview ?? null,
)

/** 上游取数算子选了哪张台账的哪些列——列选择器照着它列候选。 */
const columnCandidates = computed<readonly string[]>(() => {
  const sources = page.graph.graph.value.nodes.filter(
    (node) => page.operatorMap.value.get(node.operator)?.category === 'source',
  )
  const picked = sources.flatMap<string>((node) => {
    const columns = node.config['columns']
    if (!Array.isArray(columns)) return []
    return columns.filter((item): item is string => typeof item === 'string')
  })
  return [...new Set(picked)]
})

function addOperator(code: string): void {
  const spec = page.operatorMap.value.get(code)
  if (spec === undefined) return
  page.graph.addNode(
    code,
    { left: 80, top: 80 },
    defaultsOf(fieldsOf(spec.config_schema)),
  )
}

/**
 * 「第 3/8 个节点 · 已用 2m14s」。
 *
 * ⚠ 没有进度的话，一个跑三十分钟的训练与一个卡死的节点在界面上长得一模一样。
 */
const progress = computed(() => {
  const current = page.runner.run.value
  if (current === null || current.status !== 'running') return ''
  const nodes = current.nodes
  const settled = nodes.filter(
    (node) => node.status !== 'pending' && node.status !== 'running',
  ).length
  const since = current.started_at
  const spent =
    since === null ? '' : ` · 已用 ${formatElapsed(since, tick.value)}`
  return `第 ${settled + 1}/${nodes.length} 个节点${spent}`
})

function openConfig(nodeId: string): void {
  configNodeId.value = nodeId
}

async function openResult(nodeId: string): Promise<void> {
  resultNodeId.value = nodeId
  await page.runner.loadPreview(nodeId)
}

function setConfigValue(key: string, value: unknown): void {
  const node = configNode.value
  if (node === null) return
  page.graph.setConfig(node.id, { ...node.config, [key]: value })
}

async function saveGraph(): Promise<void> {
  if (await page.doc.save(page.graph.graph.value)) page.graph.markSaved()
}

async function runOnce(): Promise<void> {
  if (
    page.graph.isDirty.value &&
    !(await page.doc.save(page.graph.graph.value))
  )
    return
  page.graph.markSaved()
  await page.runner.start(pipelineId.value)
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

useCanvasShortcuts({
  removeSelected: () => {
    page.graph.removeSelection(
      page.selection.selectedNodeIds.value,
      page.selection.selectedEdgeIds.value,
    )
    page.selection.clear()
  },
  undo: () => page.graph.undo(),
  clearSelection: () => page.selection.clear(),
  canEdit: () => !isReadonly.value,
})

onBeforeUnmount(() => {
  if (clock.value !== null) clearInterval(clock.value)
})

onMounted(async () => {
  clock.value = setInterval(() => (tick.value = nowStamp()), 1000)
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
        variant="ghost"
        size="sm"
        icon="list-checks"
        @click="isHistoryOpen = true"
      >
        运行历史
      </DtButton>
      <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
        <DtButton
          variant="ghost"
          size="sm"
          icon="save"
          :disabled="isReadonly || !page.graph.isDirty.value"
          :loading="page.doc.isSaving.value"
          @click="void saveGraph()"
        >
          保存
        </DtButton>
      </PermGuard>
      <PermGuard :codes="[PERMISSION_CODES.modelingRun]" explain>
        <DtButton
          v-if="page.runner.run.value?.status === 'running'"
          size="sm"
          icon="power-off"
          @click="void page.runner.cancel()"
        >
          取消运行
        </DtButton>
        <DtButton
          v-else
          size="sm"
          icon="play"
          :disabled="isReadonly"
          :loading="page.runner.isStarting.value"
          @click="void runOnce()"
        >
          运行
        </DtButton>
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
        <DtNotice
          v-if="page.doc.issues.value.length > 0"
          intent="warning"
          icon="alert-triangle"
        >
          {{ page.doc.issues.value.map((issue) => issue.message).join('；') }}
        </DtNotice>
        <EditorCanvas
          class="dt-ml-page__canvas"
          :graph="page.graph.graph.value"
          :operators="page.operatorMap.value"
          :runtime="page.runtime.value"
          :selection="{
            nodes: page.selection.selectedNodeIds.value,
            edges: page.selection.selectedEdgeIds.value,
          }"
          :is-readonly="isReadonly"
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
          @connect="
            (from, to) =>
              page.graph.addEdge({
                id: `${from.node}:${from.port}->${to.node}:${to.port}`,
                from_node: from.node,
                from_port: from.port,
                to_node: to.node,
                to_port: to.port,
              })
          "
          @reject="(reason) => toast.warning(reason)"
          @open-config="openConfig"
          @open-result="(id) => void openResult(id)"
        />
      </div>
    </div>

    <DtModal
      :model-value="configNode !== null"
      :title="configSpec?.name ?? '参数'"
      :description="configSpec?.description"
      width="32rem"
      @update:model-value="configNodeId = null"
    >
      <ConfigForm
        v-if="configNode"
        :fields="configFields"
        :config="configNode.config"
        :columns="columnCandidates"
        :tables="[]"
        :is-readonly="isReadonly"
        @change="setConfigValue"
      />
    </DtModal>

    <DtModal
      :model-value="resultPayload !== null"
      title="这一步的结果"
      width="52rem"
      @update:model-value="resultNodeId = null"
    >
      <ResultView v-if="resultPayload" :payload="resultPayload" />
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
  }

  &__main {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    min-height: 0;
    padding: 0.5rem;
  }

  &__canvas {
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
}
</style>
