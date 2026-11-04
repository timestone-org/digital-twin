<script setup lang="ts">
/** @fileoverview 模型部署的配置、调用说明与调用量。 */
import type {
  ModelCallStat,
  ModelDeployment,
  ModelingVersionSummary,
} from '@dt/contracts'
import { DtButton, DtNotice } from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import * as modeling from '@/api/modeling'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useViewMode } from '@/composables/useViewMode'

import DeploymentAccessDrawer from './components/DeploymentAccessDrawer.vue'
import DeploymentFormDialog from './components/DeploymentFormDialog.vue'
import DeploymentTable from './components/DeploymentTable.vue'
import { useDeploymentOps } from './scripts/useDeploymentOps'
import { useDeploymentBatch } from './scripts/useDeploymentBatch'
import ModelingBatchBar from '../components/ModelingBatchBar.vue'

const view = useViewMode('modeling-deployments')

const rows = ref<ModelDeployment[]>([])
const deploymentsRequest = useRacedFetch()
const versions = ref<ModelingVersionSummary[]>([])
const isVersionLoading = ref(true)
const versionError = ref<string | null>(null)
const versionRequest = useRacedFetch()
const isLoading = ref(false)
const error = ref<string | null>(null)

const editing = ref<ModelDeployment | null>(null)
const inspecting = ref<ModelDeployment | null>(null)
const stats = ref<ModelCallStat[]>([])
const isStatsLoading = ref(false)
const statsError = ref<string | null>(null)
const statsRequest = useRacedFetch()

const ops = useDeploymentOps(() => {
  void reload()
})
const bulk = useDeploymentBatch(
  () => rows.value,
  reload,
  () => ops.isBusy.value || isLoading.value,
)
const isWritingBlocked = computed(
  () =>
    ops.isBusy.value || bulk.batch.isBusy.value || bulk.batch.isBlocked.value,
)

async function reload(): Promise<void> {
  isLoading.value = true
  error.value = null
  await deploymentsRequest.run(
    (signal) => modeling.listModelDeployments(signal),
    {
      ok: (found) => {
        rows.value = found
        if (inspecting.value === null) return
        const selected = found.find((row) => row.id === inspecting.value?.id)
        if (selected) void openAccess(selected)
        else closeAccess()
      },
      fail: (caught) => (error.value = describeError(caught)),
      settled: () => (isLoading.value = false),
    },
  )
}

async function loadVersions(): Promise<void> {
  isVersionLoading.value = true
  versionError.value = null
  await versionRequest.run(
    (signal) => modeling.listAllModelingVersions(signal),
    {
      ok: (found) => (versions.value = found),
      fail: (caught) => {
        versions.value = []
        versionError.value = describeError(caught)
      },
      settled: () => (isVersionLoading.value = false),
    },
  )
}

async function openAccess(row: ModelDeployment): Promise<void> {
  inspecting.value = row
  stats.value = []
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
  statsRequest.cancel()
  inspecting.value = null
}

function openForm(row: ModelDeployment): void {
  if (
    isWritingBlocked.value ||
    isVersionLoading.value ||
    versionError.value !== null
  )
    return
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

onMounted(() => {
  void reload()
  void loadVersions()
})

onBeforeUnmount(() => {
  deploymentsRequest.cancel()
  versionRequest.cancel()
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
        scope-label="当前列表全部服务"
        @clear="bulk.batch.clear"
        @stop="bulk.batch.stop"
      >
        <DtButton
          size="sm"
          variant="soft"
          :disabled="!bulk.batch.canRun.value || ops.isBusy.value || isLoading"
          @click="void bulk.toggle(true)"
        >
          批量启用服务
        </DtButton>
        <DtButton
          size="sm"
          variant="soft"
          :disabled="!bulk.batch.canRun.value || ops.isBusy.value || isLoading"
          @click="void bulk.toggle(false)"
        >
          批量停用服务
        </DtButton>
        <DtButton
          size="sm"
          variant="soft"
          intent="danger"
          :disabled="!bulk.batch.canRun.value || ops.isBusy.value || isLoading"
          @click="void bulk.remove()"
        >
          批量删除服务
        </DtButton>
      </ModelingBatchBar>
      <DtNotice v-if="versionError" intent="warning">
        模型版本加载失败：{{ versionError }}
        <DtButton size="xs" variant="ghost" @click="void loadVersions()">
          重新加载模型版本
        </DtButton>
      </DtNotice>
      <DeploymentTable
        v-model:view="view"
        :selection="bulk.selection.value"
        :actions-disabled="isWritingBlocked"
        :rows="rows"
        :is-loading="isLoading"
        :error="error"
        @update:selected-ids="bulk.batch.selectedIds.value = $event"
        @access="(row) => void openAccess(row)"
        @edit="(row) => openForm(row)"
        @toggle="(row, isOn) => void toggleDeployment(row, isOn)"
        @remove="(row) => void removeDeployment(row)"
      />
    </div>

    <DeploymentFormDialog
      v-if="editing"
      :deployment="editing"
      :is-busy="isWritingBlocked"
      :versions="versions"
      @submit="(payload) => void submitForm(payload)"
      @close="editing = null"
    />

    <DeploymentAccessDrawer
      :deployment="inspecting"
      :stats="stats"
      :is-loading="isStatsLoading"
      :error="statsError"
      @close="closeAccess"
    />
  </AppShell>
</template>
