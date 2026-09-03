<script setup lang="ts">
/**
 * @fileoverview 模型对外服务：开给第三方系统调的地址、密钥与调用量。
 *
 * 「部署」与「绑定」并列而不是替代：绑定把模型接进系统**内**的台账，部署把它
 * 开给系统**外**（docs/MODELING_PLATFORM_DESIGN.md D13）。
 *
 * 这一页只做编排与取数，表与弹窗各自成件。
 */
import type {
  ModelApiKey,
  ModelApiKeyMinted,
  ModelCallStat,
  ModelDeployment,
  ModelingVersionSummary,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'
import { onMounted, ref } from 'vue'

import * as modeling from '@/api/modeling'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'

import ApiKeyDrawer from './components/ApiKeyDrawer.vue'
import DeploymentFormDialog from './components/DeploymentFormDialog.vue'
import DeploymentTable from './components/DeploymentTable.vue'
import MintedKeyDialog from './components/MintedKeyDialog.vue'
import { useDeploymentOps } from './scripts/useDeploymentOps'

// 版本下拉一次取满：可上线的版本是业务级资源，量级在几十
const VERSION_PAGE_SIZE = 200

const view = useViewMode('modeling-deployments')

const rows = ref<ModelDeployment[]>([])
const versions = ref<ModelingVersionSummary[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

const isFormOpen = ref(false)
const editing = ref<ModelDeployment | null>(null)
const inspecting = ref<ModelDeployment | null>(null)
const keys = ref<ModelApiKey[]>([])
const stats = ref<ModelCallStat[]>([])
const minted = ref<ModelApiKeyMinted | null>(null)

const ops = useDeploymentOps(() => {
  void reload()
})

async function reload(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    rows.value = await modeling.listModelDeployments()
    // 打开着密钥面时同步刷一遍：撤销之后那一行的状态要当场变
    if (inspecting.value !== null) await openKeys(inspecting.value)
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    isLoading.value = false
  }
}

async function loadVersions(): Promise<void> {
  const page = await modeling.listModelingVersions({
    page: 1,
    size: VERSION_PAGE_SIZE,
  })
  versions.value = page.items
}

async function openKeys(row: ModelDeployment): Promise<void> {
  inspecting.value = row
  keys.value = await modeling.listModelApiKeys(row.id)
  stats.value = await modeling.listModelCallStats(row.id)
}

function openForm(row: ModelDeployment | null): void {
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

async function mint(name: string): Promise<void> {
  const row = inspecting.value
  if (row === null) return
  const created = await ops.mintKey(row.id, { name })
  if (created !== null) minted.value = created
}

onMounted(() => {
  void reload()
  void loadVersions()
})
</script>

<template>
  <AppShell
    title="模型服务"
    subtitle="开给第三方系统调的地址 · 密钥 · 调用量"
    back-to="/modeling/pipelines"
  >
    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <DeploymentTable
        v-model:view="view"
        :rows="rows"
        :is-loading="isLoading"
        :error="error"
        @keys="(row) => void openKeys(row)"
        @edit="(row) => openForm(row)"
        @toggle="(row, isOn) => void ops.update(row.id, { is_enabled: isOn })"
        @remove="(row) => void ops.remove(row)"
      >
        <template #toolbar>
          <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
            <DtButton size="sm" icon="plus" @click="openForm(null)">
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

    <ApiKeyDrawer
      :deployment="inspecting"
      :keys="keys"
      :stats="stats"
      :is-busy="ops.isBusy.value"
      @mint="(name) => void mint(name)"
      @revoke="
        (key) =>
          inspecting &&
          void ops.revokeKey(inspecting.id, key.id, key.name)
      "
      @close="inspecting = null"
    />

    <MintedKeyDialog :minted="minted" @close="minted = null" />
  </AppShell>
</template>
