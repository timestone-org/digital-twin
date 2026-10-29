<script setup lang="ts">
/** @fileoverview 模型部署的配置、调用说明与调用量。 */
import type {
  ModelCallStat,
  ModelDeployment,
  ModelingVersionSummary,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtNotice } from '@dt/ui'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import * as modeling from '@/api/modeling'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import ModelingNav from '../components/ModelingNav.vue'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useViewMode } from '@/composables/useViewMode'

import DeploymentAccessDrawer from './components/DeploymentAccessDrawer.vue'
import DeploymentFormDialog from './components/DeploymentFormDialog.vue'
import DeploymentTable from './components/DeploymentTable.vue'
import { useDeploymentOps } from './scripts/useDeploymentOps'

const view = useViewMode('modeling-deployments')

const rows = ref<ModelDeployment[]>([])
const versions = ref<ModelingVersionSummary[]>([])
const isVersionLoading = ref(true)
const versionError = ref<string | null>(null)
const versionRequest = useRacedFetch()
const isLoading = ref(false)
const error = ref<string | null>(null)

const isFormOpen = ref(false)
const editing = ref<ModelDeployment | null>(null)
const inspecting = ref<ModelDeployment | null>(null)
const stats = ref<ModelCallStat[]>([])
const isStatsLoading = ref(false)
const statsError = ref<string | null>(null)
const statsRequest = useRacedFetch()

const ops = useDeploymentOps(() => {
  void reload()
})

async function reload(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    rows.value = await modeling.listModelDeployments()
    if (inspecting.value !== null) await openAccess(inspecting.value)
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    isLoading.value = false
  }
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

function openForm(row: ModelDeployment | null): void {
  if (isVersionLoading.value || versionError.value !== null) return
  editing.value = row
  isFormOpen.value = true
}

async function submitForm(payload: {
  code: string
  model_version_id: string
  name: string
  max_rows_per_call: number
  rate_limit_per_minute: number
}): Promise<void> {
  const row = editing.value
  const done =
    row === null
      ? await ops.create(payload)
      : await ops.update(row.id, {
          name: payload.name,
          model_version_id: payload.model_version_id,
          max_rows_per_call: payload.max_rows_per_call,
          rate_limit_per_minute: payload.rate_limit_per_minute,
        })
  if (done !== null) isFormOpen.value = false
}

onMounted(() => {
  void reload()
  void loadVersions()
})

onBeforeUnmount(() => {
  versionRequest.cancel()
  statsRequest.cancel()
})
</script>

<template>
  <AppShell
    title="部署服务"
    subtitle="将模型版本提供给第三方调用，统一使用用户 APIKey"
    back-to="/modeling/pipelines"
  >
    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <ModelingNav />
      <DtNotice v-if="versionError" intent="warning">
        模型版本加载失败：{{ versionError }}
        <DtButton size="xs" variant="ghost" @click="void loadVersions()">
          重新加载模型版本
        </DtButton>
      </DtNotice>
      <DeploymentTable
        v-model:view="view"
        :rows="rows"
        :is-loading="isLoading"
        :error="error"
        @access="(row) => void openAccess(row)"
        @edit="(row) => openForm(row)"
        @toggle="(row, isOn) => void ops.update(row.id, { is_enabled: isOn })"
        @remove="(row) => void ops.remove(row)"
      >
        <template #toolbar>
          <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
            <DtButton
              size="sm"
              icon="plus"
              :loading="isVersionLoading"
              :disabled="isVersionLoading || versionError !== null"
              @click="openForm(null)"
            >
              开一个服务
            </DtButton>
          </PermGuard>
        </template>
      </DeploymentTable>
    </div>

    <DeploymentFormDialog
      :editing="editing"
      :is-open="isFormOpen"
      :is-busy="ops.isBusy.value"
      :versions="versions"
      @submit="(payload) => void submitForm(payload)"
      @close="isFormOpen = false"
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
