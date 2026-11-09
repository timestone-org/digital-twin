<script setup lang="ts">
/** @fileoverview 模型部署的配置、调用说明与调用量。 */
import type { ModelCallStat, ModelDeployment } from '@dt/contracts'
import { DtButton } from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import * as modeling from '@/api/modeling'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { BizError } from '@/api/client'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useViewMode } from '@/composables/useViewMode'

import DeploymentAccessDrawer from './components/DeploymentAccessDrawer.vue'
import DeploymentFormDialog from './components/DeploymentFormDialog.vue'
import DeploymentTable from './components/DeploymentTable.vue'
import { useDeploymentOps } from './scripts/useDeploymentOps'
import { useDeploymentBatch } from './scripts/useDeploymentBatch'
import ModelingBatchBar from '../components/ModelingBatchBar.vue'
import { reloadModelingPage } from '../scripts/reloadModelingPage'
import ServiceFilters from './components/ServiceFilters.vue'

const view = useViewMode('modeling-deployments')

const appliedQuery = ref('')
const status = ref('all')
const list = useAsyncList<ModelDeployment>((query, signal) =>
  modeling.listModelDeploymentsPage(
    {
      ...query,
      q: appliedQuery.value,
      isEnabled:
        status.value === 'all' ? undefined : status.value === 'enabled',
    },
    signal,
  ),
)
const scope = computed(
  () =>
    `${list.pager.value.page}:${list.pager.value.size}:${appliedQuery.value}:${status.value}`,
)

const editing = ref<ModelDeployment | null>(null)
const inspecting = ref<ModelDeployment | null>(null)
const stats = ref<ModelCallStat[]>([])
const isStatsLoading = ref(false)
const statsError = ref<string | null>(null)
const statsRequest = useRacedFetch()
const inspectionRequest = useRacedFetch()

const ops = useDeploymentOps(() => {
  void reload()
})
const bulk = useDeploymentBatch(
  () => list.items.value,
  reload,
  () => ops.isBusy.value || list.loading.value || editing.value !== null,
  () => scope.value,
)
const isWritingBlocked = computed(
  () =>
    ops.isBusy.value || bulk.batch.isBusy.value || bulk.batch.isBlocked.value,
)

async function reload(): Promise<void> {
  await reloadModelingPage(list)
  const current = inspecting.value
  if (list.error.value !== null || current === null) return
  const selected = list.items.value.find((row) => row.id === current.id)
  if (selected) await openAccess(selected)
  else await refreshInspection(current.id)
}
async function refreshInspection(id: string): Promise<void> {
  await inspectionRequest.run(
    (signal) => modeling.getModelDeployment(id, signal),
    {
      ok: (row) => {
        if (inspecting.value?.id === id) void openAccess(row)
      },
      fail: (caught) => {
        if (caught instanceof BizError && caught.status === 404) closeAccess()
        else statsError.value = `服务详情刷新失败：${describeError(caught)}`
      },
      settled: () => {},
    },
  )
}

async function openAccess(row: ModelDeployment): Promise<void> {
  inspectionRequest.cancel()
  inspecting.value = row
  stats.value = []
  await loadStats(row)
}

/** 拉这个部署近一个月的调用量；试算之后也重拉一次。 */
async function loadStats(row: ModelDeployment): Promise<void> {
  statsError.value = null
  isStatsLoading.value = true
  await statsRequest.run(
    (signal) => modeling.listModelCallStats(row.id, signal),
    {
      ok: (found) => (stats.value = found),
      fail: (caught) => (statsError.value = describeError(caught)),
      settled: () => (isStatsLoading.value = false),
    },
  )
}

function closeAccess(): void {
  inspectionRequest.cancel()
  statsRequest.cancel()
  inspecting.value = null
}

function openForm(row: ModelDeployment): void {
  if (isWritingBlocked.value) return
  editing.value = row
}

async function toggleDeployment(
  row: ModelDeployment,
  isOn: boolean,
): Promise<void> {
  if (isWritingBlocked.value) return
  await ops.update(row.id, { is_enabled: isOn })
}

async function removeDeployment(row: ModelDeployment): Promise<void> {
  if (isWritingBlocked.value) return
  await ops.remove(row)
}

async function submitForm(payload: {
  model_version_id: string
  name: string
  max_rows_per_call: number
  rate_limit_per_minute: number
}): Promise<void> {
  const row = editing.value
  if (row === null || isWritingBlocked.value) return
  const done = await ops.update(row.id, payload)
  if (done !== null) editing.value = null
}

async function search(query: string): Promise<void> {
  appliedQuery.value = query.trim()
  await list.reloadFromFirstPage()
}
async function filterStatus(value: string): Promise<void> {
  if (!['all', 'enabled', 'disabled'].includes(value)) return
  status.value = value
  await list.reloadFromFirstPage()
}
watch(scope, () => {
  editing.value = null
  closeAccess()
})
onMounted(() => void list.reload())

onBeforeUnmount(() => {
  inspectionRequest.cancel()
  statsRequest.cancel()
})
</script>

<template>
  <AppShell
    title="已发布模型"
    subtitle="每个工作流使用一个固定发布入口，查看当前模型与调用说明"
    back-to="/modeling/pipelines"
  >
    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <ModelingBatchBar
        v-if="bulk.selection.value"
        :selected-count="bulk.batch.selectedCount.value"
        :state="bulk.batch.state.value"
        scope-label="当前页服务"
        @clear="bulk.batch.clear"
        @stop="bulk.batch.stop"
      >
        <DtButton
          size="sm"
          variant="soft"
          :disabled="
            !bulk.batch.canRun.value || ops.isBusy.value || list.loading.value
          "
          @click="void bulk.toggle(true)"
        >
          批量启用服务
        </DtButton>
        <DtButton
          size="sm"
          variant="soft"
          :disabled="
            !bulk.batch.canRun.value || ops.isBusy.value || list.loading.value
          "
          @click="void bulk.toggle(false)"
        >
          批量停用服务
        </DtButton>
        <DtButton
          size="sm"
          variant="soft"
          intent="danger"
          :disabled="
            !bulk.batch.canRun.value || ops.isBusy.value || list.loading.value
          "
          @click="void bulk.remove()"
        >
          批量删除服务
        </DtButton>
      </ModelingBatchBar>
      <DeploymentTable
        v-model:view="view"
        :selection="bulk.selection.value"
        :actions-disabled="isWritingBlocked"
        :rows="list.items.value"
        :is-loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        @update:selected-ids="bulk.batch.selectedIds.value = $event"
        @access="(row) => void openAccess(row)"
        @edit="(row) => openForm(row)"
        @toggle="(row, isOn) => void toggleDeployment(row, isOn)"
        @remove="(row) => void removeDeployment(row)"
        @update:page="void list.goToPage($event)"
        @update:size="void list.setSize($event)"
        @retry="void list.reload()"
      >
        <template #toolbar
          ><ServiceFilters
            :status="status"
            :disabled="bulk.batch.isBusy.value || ops.isBusy.value"
            @search="void search($event)"
            @status="void filterStatus($event)"
        /></template>
      </DeploymentTable>
    </div>

    <DeploymentFormDialog
      v-if="editing"
      :deployment="editing"
      :is-busy="isWritingBlocked"
      @submit="(payload) => void submitForm(payload)"
      @close="editing = null"
    />

    <DeploymentAccessDrawer
      :deployment="inspecting"
      :stats="stats"
      :is-loading="isStatsLoading"
      :error="statsError"
      @close="closeAccess"
      @called="inspecting && void loadStats(inspecting)"
    />
  </AppShell>
</template>
