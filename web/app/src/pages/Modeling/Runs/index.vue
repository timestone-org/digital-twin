<script setup lang="ts">
/** @fileoverview 按工作流查看训练历史结果、直接发布与清理记录。 */
import type {
  ModelingPipelineSummary,
  ModelingRunSummary,
  ModelingRunStatus,
} from '@dt/contracts'
import {
  DtButton,
  DtCursorPager,
  DtIconButton,
  DtInput,
  DtSelect,
} from '@dt/ui'
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'
import * as modeling from '@/api/modeling'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useCursorPages } from '@/composables/useCursorPages'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useViewMode } from '@/composables/useViewMode'
import RunTable from './components/RunTable.vue'
import RunWorkflowPicker from './components/RunWorkflowPicker.vue'
import { useRunOps } from '../scripts/useRunOps'
import ModelingBatchBar from '../components/ModelingBatchBar.vue'
import { useRunBatch } from './scripts/useRunBatch'

const RunResultsDialog = defineAsyncComponent(
  () => import('./components/RunResultsDialog.vue'),
)

const viewingRun = ref<ModelingRunSummary | null>(null)
const route = useRoute()
const initialId = route.query['pipeline_id']
const pipelineId = ref(typeof initialId === 'string' ? initialId : '')
const selectedPipeline = ref<ModelingPipelineSummary | null>(null)
const isPickingWorkflow = ref(false)
const keyword = ref('')
const appliedKeyword = ref('')
const status = ref<ModelingRunStatus | ''>('')
const limit = ref(20)
const statusOptions: { value: ModelingRunStatus | ''; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '排队中' },
  { value: 'running', label: '训练中' },
  { value: 'cancelling', label: '取消中' },
  { value: 'succeeded', label: '已成功' },
  { value: 'failed', label: '已失败' },
  { value: 'cancelled', label: '已取消' },
]
const sizeOptions = [20, 50, 100, 200].map((size) => ({
  value: String(size),
  label: `${size} 条/页`,
}))
const pipelineRead = useRacedFetch()
const view = useViewMode('modeling-runs')
const runs = useCursorPages<ModelingRunSummary, string>(
  (after, signal) =>
    modeling.listModelingRunHistory(
      pipelineId.value || null,
      {
        limit: limit.value,
        ...(after === null ? {} : { after }),
        ...(appliedKeyword.value === '' ? {} : { q: appliedKeyword.value }),
        ...(status.value === '' ? {} : { status: status.value }),
      },
      signal,
    ),
  describeError,
)
const ops = useRunOps(() => void runs.refresh())
const bulk = useRunBatch(
  () => runs.items.value,
  () =>
    JSON.stringify([
      appliedKeyword.value,
      pipelineId.value,
      status.value,
      limit.value,
      runs.pageNumber.value,
    ]),
  () => runs.refresh(),
  () => runs.loading.value || ops.busyId.value !== '',
)
const canWriteRun = computed(
  () =>
    ops.busyId.value === '' &&
    !bulk.batch.isBusy.value &&
    !bulk.batch.isBlocked.value,
)
const names = computed(
  () =>
    new Map(
      selectedPipeline.value
        ? [[selectedPipeline.value.id, selectedPipeline.value.name]]
        : [],
    ),
)
const workflowLabel = computed(
  () => selectedPipeline.value?.name ?? (pipelineId.value || '全部工作流'),
)
const savedModels = computed(
  () =>
    new Set(
      runs.items.value
        .filter((row) => row.published_version_id)
        .map((row) => row.id),
    ),
)
async function search(): Promise<void> {
  appliedKeyword.value = keyword.value.trim()
  await runs.reload()
}
function setStatus(value: string): void {
  const option = statusOptions.find((item) => item.value === value)
  if (option) status.value = option.value
}
function setLimit(value: string): void {
  const next = Number(value)
  if ([20, 50, 100, 200].includes(next)) limit.value = next
}
function selectWorkflow(row: ModelingPipelineSummary | null): void {
  selectedPipeline.value = row
  pipelineId.value = row?.id ?? ''
  isPickingWorkflow.value = false
}
async function loadSelectedPipeline(): Promise<void> {
  const id = pipelineId.value
  pipelineRead.cancel()
  if (selectedPipeline.value?.id === id) return
  selectedPipeline.value = null
  if (id === '') return
  await pipelineRead.run((signal) => modeling.getModelingPipeline(id, signal), {
    ok: (row) => {
      selectedPipeline.value = row
    },
    fail: () => {},
    settled: () => {},
  })
}
async function publishRun(row: ModelingRunSummary): Promise<void> {
  if (!canWriteRun.value) return
  await ops.publish(row.id)
}
async function removeRun(row: ModelingRunSummary): Promise<void> {
  if (!canWriteRun.value) return
  await ops.remove(row)
}
watch(
  () => route.query['pipeline_id'],
  (value) => {
    viewingRun.value = null
    pipelineId.value = typeof value === 'string' ? value : ''
  },
)
watch(pipelineId, () => {
  void loadSelectedPipeline()
  void runs.reload()
})
watch([status, limit], () => void runs.reload())
onMounted(() => {
  void loadSelectedPipeline()
  void runs.reload()
})
onBeforeUnmount(() => {
  pipelineRead.cancel()
  runs.cancel()
})
</script>

<template>
  <AppShell
    title="训练记录"
    subtitle="查看每次训练的配置、结果和模型；训练成功后可直接发布"
    back-to="/modeling/pipelines"
  >
    <div class="flex h-full min-h-0 flex-col gap-3">
      <ModelingBatchBar
        v-if="bulk.selection.value"
        :selected-count="bulk.batch.selectedCount.value"
        :state="bulk.batch.state.value"
        scope-label="当前页训练记录"
        @clear="bulk.batch.clear"
        @stop="bulk.batch.stop"
      >
        <DtButton
          v-if="bulk.canCancel.value"
          size="sm"
          variant="soft"
          :disabled="
            !bulk.batch.canRun.value ||
            runs.loading.value ||
            ops.busyId.value !== ''
          "
          @click="void bulk.cancel()"
        >
          批量取消训练
        </DtButton>
        <DtButton
          v-if="bulk.canRemove.value"
          size="sm"
          variant="soft"
          intent="danger"
          :disabled="
            !bulk.batch.canRun.value ||
            runs.loading.value ||
            ops.busyId.value !== ''
          "
          @click="void bulk.remove()"
        >
          批量删除记录
        </DtButton>
      </ModelingBatchBar>
      <RunTable
        v-model:view="view"
        :selection="bulk.selection.value"
        :rows="runs.items.value"
        :pipeline-names="names"
        :published-run-ids="savedModels"
        :can-publish="canWriteRun"
        :is-loading="runs.loading.value"
        class="min-h-0 flex-1"
        :error="runs.problem.value"
        @update:selected-ids="bulk.batch.selectedIds.value = $event"
        @retry="void runs.refresh()"
        @detail="viewingRun = $event"
        @publish="void publishRun($event)"
        @remove="void removeRun($event)"
      >
        <template #toolbar>
          <form
            class="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            @submit.prevent="void search()"
          >
            <DtInput
              v-model="keyword"
              class="w-80 max-w-full min-w-0 flex-none"
              aria-label="搜索训练记录"
              type="search"
              size="sm"
              placeholder="工作流、创建者或训练 UUID"
              :maxlength="128"
            />
            <DtButton type="submit" size="sm" variant="ghost">搜索</DtButton>
            <DtButton
              variant="outline"
              class="max-w-64"
              size="sm"
              aria-label="筛选工作流"
              :title="workflowLabel"
              @click="isPickingWorkflow = true"
            >
              {{ workflowLabel }}
            </DtButton>
            <DtSelect
              :model-value="status"
              aria-label="训练状态"
              :options="statusOptions"
              size="sm"
              @update:model-value="setStatus"
            />
            <DtIconButton
              size="sm"
              variant="ghost"
              icon="refresh-cw"
              label="刷新训练状态"
              :loading="runs.loading.value"
              @click="void runs.refresh()"
            />
          </form>
        </template>
        <template #pagination>
          <div class="dt-data-view__pager flex flex-wrap items-center gap-3">
            <DtCursorPager
              class="min-w-0 flex-1"
              :page="runs.pageNumber.value"
              :count="runs.items.value.length"
              :has-prev="runs.hasPrev.value"
              :has-next="runs.hasNext.value"
              :loading="runs.loading.value || bulk.batch.isBusy.value"
              aria-label="训练记录分页"
              @prev="void runs.prev()"
              @next="void runs.next()"
            />
            <DtSelect
              :model-value="String(limit)"
              :options="sizeOptions"
              aria-label="每页条数"
              size="sm"
              :display="{ searchable: false }"
              @update:model-value="setLimit"
            />
          </div>
        </template>
      </RunTable>
    </div>
    <RunResultsDialog
      v-if="viewingRun"
      :run="viewingRun"
      :pipeline-name="
        viewingRun.pipeline_name ?? names.get(viewingRun.pipeline_id) ?? ''
      "
      @close="viewingRun = null"
    />
    <RunWorkflowPicker
      v-if="isPickingWorkflow"
      :selected-id="pipelineId"
      @select="selectWorkflow"
      @close="isPickingWorkflow = false"
    />
  </AppShell>
</template>
