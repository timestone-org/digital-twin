<script setup lang="ts">
/**
 * @fileoverview 模型库：已发布的版本、它们绑到哪条台账公式上，以及启停与换绑。
 * 见 docs/MODELING_DESIGN.md §6。
 *
 * 两张表各自成件（`components/`），这一页只做编排、取数与页签切换。
 */
import type {
  ModelingBinding,
  ModelingVersion,
  ModelingVersionSummary,
} from '@dt/contracts'
import { DtButton, DtSegmented, useToast } from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRunOps } from '../scripts/useRunOps'
import ModelingBatchBar from '../components/ModelingBatchBar.vue'

import * as modeling from '@/api/modeling'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useViewMode } from '@/composables/useViewMode'

import BindDialog from './components/BindDialog.vue'
import BindingTable from './components/BindingTable.vue'
import VersionDetailDialog from './components/VersionDetailDialog.vue'
import VersionTable from './components/VersionTable.vue'
import VersionNameDialog from './components/VersionNameDialog.vue'
import { useBindingOps } from './scripts/useBindingOps'
import { useVersionOps } from './scripts/useVersionOps'
import { useVersionBatch } from './scripts/useVersionBatch'
import { useBindingBatch } from './scripts/useBindingBatch'
import ModelSearch from './components/ModelSearch.vue'
import { reloadModelingPage } from '../scripts/reloadModelingPage'

// 初始每页条数
const PAGE_SIZE = 20
const TABS = [
  { value: 'versions', label: '模型版本' },
  { value: 'bindings', label: '公式绑定' },
]

const route = useRoute()
const router = useRouter()
const workflowId = computed(() => {
  const value = route.query['pipeline_id']
  return typeof value === 'string' ? value : undefined
})
const runOps = useRunOps(refresh)
const activeTab = ref('versions')
const versionView = useViewMode('modeling-versions')
const bindingView = useViewMode('modeling-bindings')
// 绑定弹窗要入口契约（签名），列表那份没有——同详情一样现取
const binding = ref<ModelingVersion | null>(null)
// 详情要签名与指纹，列表那份没有——点开时按 id 现取一次
const detail = ref<ModelingVersion | null>(null)
const renaming = ref<ModelingVersion | null>(null)
const versionRead = useRacedFetch()
const toast = useToast()
const versionQuery = ref('')
const bindingQuery = ref('')

const versions = useAsyncList<ModelingVersionSummary>(
  (query, signal) =>
    modeling.listModelingVersions(
      { ...query, q: versionQuery.value, pipelineId: workflowId.value },
      signal,
    ),
  PAGE_SIZE,
)
const bindings = useAsyncList<ModelingBinding>(
  (query, signal) =>
    modeling.listModelingBindings({ ...query, q: bindingQuery.value }, signal),
  PAGE_SIZE,
)

function refresh(): void {
  void refreshBatch()
}

const ops = useBindingOps(refresh)
// 版本级动作单独一组：下线与注册的对象是版本，爆炸半径也与绑定那几个不同
const versionOps = useVersionOps(refresh)
const versionBulk = useVersionBatch(
  () => versions.items.value,
  () =>
    `${workflowId.value ?? ''}:${versionQuery.value}:${versions.pager.value.page}:${versions.pager.value.size}`,
  refreshBatch,
  (): boolean => isWriting.value || versions.loading.value,
)
const bindingBulk = useBindingBatch(
  () => bindings.items.value,
  () =>
    `${workflowId.value ?? ''}:${bindingQuery.value}:${bindings.pager.value.page}:${bindings.pager.value.size}`,
  refreshBatch,
  (): boolean => isWriting.value || bindings.loading.value,
)
const isWriting = computed(
  () =>
    versionOps.isBusy.value ||
    ops.isBusy.value ||
    runOps.busyId.value !== '' ||
    versionBulk.batch.isBusy.value ||
    bindingBulk.batch.isBusy.value ||
    versionBulk.batch.isBlocked.value ||
    bindingBulk.batch.isBlocked.value,
)
async function refreshBatch(): Promise<void> {
  await Promise.all([
    reloadModelingPage(versions),
    reloadModelingPage(bindings),
  ])
}
async function searchVersions(query: string): Promise<void> {
  versionQuery.value = query.trim()
  await versions.reloadFromFirstPage()
}
async function searchBindings(query: string): Promise<void> {
  bindingQuery.value = query.trim()
  await bindings.reloadFromFirstPage()
}
watch(workflowId, () => {
  versionRead.cancel()
  detail.value = null
  binding.value = null
  renaming.value = null
  void versions.reloadFromFirstPage()
})

/** 版本 id → 「名称 v版本号」。绑定表里显示它，而不是一串 id。 */
const versionLabels = computed(
  () =>
    new Map(
      versions.items.value.map((row) => [
        row.id,
        `${row.name} v${row.version}`,
      ]),
    ),
)

async function openDetail(row: ModelingVersionSummary): Promise<void> {
  await readVersion(row, (version) => {
    detail.value = version
  })
}

async function readVersion(
  row: ModelingVersionSummary,
  show: (version: ModelingVersion) => void,
): Promise<void> {
  await versionRead.run(
    (signal) => modeling.getModelingVersion(row.id, signal),
    {
      ok: show,
      fail: (caught) => toast.error(describeError(caught)),
      settled: () => {},
    },
  )
}

async function saveName(name: string, description: string): Promise<void> {
  const version = renaming.value
  if (version === null || isWriting.value) return
  const result = await versionOps.rename(version.id, name, description)
  if (result !== null) renaming.value = null
}

async function register(fxCode: string): Promise<void> {
  const version = detail.value
  if (version === null || isWriting.value) return
  const done = await versionOps.register(version.id, fxCode)
  if (done !== null) detail.value = null
}

async function submitBind(fxCode: string): Promise<void> {
  const version = binding.value
  if (version === null || isWriting.value) return
  if (await ops.bind(fxCode, version.id)) binding.value = null
}

async function openBinding(row: ModelingVersionSummary): Promise<void> {
  if (isWriting.value) return
  await readVersion(row, (version) => {
    if (!isWriting.value) binding.value = version
  })
}

async function openRename(row: ModelingVersionSummary): Promise<void> {
  if (isWriting.value) return
  await readVersion(row, (version) => {
    if (!isWriting.value) renaming.value = version
  })
}

onMounted(() => {
  void versions.reload()
  void bindings.reload()
})
onBeforeUnmount(versionRead.cancel)
</script>

<template>
  <AppShell
    title="训练模型与公式"
    subtitle="成功训练自动保存模型，可直接发布调用或绑定台账公式"
    back-to="/modeling/pipelines"
  >
    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div
      class="dt-ml-models flex h-full min-h-0 flex-col gap-3 overflow-hidden"
    >
      <DtSegmented
        v-model="activeTab"
        class="shrink-0"
        :options="TABS"
        variant="tabs"
        aria-label="模型分区"
      />

      <!-- ⚠ 用 v-show：搜索词、勾选与进行中的批量状态都在子组件里，切走不能丢 -->
      <section v-show="activeTab === 'versions'" class="dt-ml-models__block">
        <ModelingBatchBar
          v-if="versionBulk.selection.value"
          :selected-count="versionBulk.batch.selectedCount.value"
          :state="versionBulk.batch.state.value"
          scope-label="当前页模型版本"
          @clear="versionBulk.batch.clear"
          @stop="versionBulk.batch.stop"
        >
          <DtButton
            size="sm"
            variant="soft"
            :disabled="
              !versionBulk.batch.canRun.value ||
              isWriting ||
              versions.loading.value
            "
            @click="void versionBulk.retire()"
          >
            批量下线模型
          </DtButton>
          <DtButton
            size="sm"
            variant="soft"
            intent="danger"
            :disabled="
              !versionBulk.batch.canRun.value ||
              isWriting ||
              versions.loading.value
            "
            @click="void versionBulk.remove()"
          >
            批量删除模型
          </DtButton>
        </ModelingBatchBar>
        <VersionTable
          v-model:view="versionView"
          :selection="versionBulk.selection.value"
          :actions-disabled="isWriting"
          :rows="versions.items.value"
          :is-loading="versions.loading.value"
          :error="versions.error.value"
          :pagination="versions.pager.value"
          @update:selected-ids="versionBulk.batch.selectedIds.value = $event"
          @update:page="(page) => void versions.goToPage(page)"
          @update:size="(size) => void versions.setSize(size)"
          @detail="(row) => void openDetail(row)"
          @bind="(row) => void openBinding(row)"
          @retire="(row) => !isWriting && void versionOps.retire(row)"
          @remove="(row) => !isWriting && void versionOps.remove(row)"
          @deploy="(row) => !isWriting && void runOps.publish(row.run_id)"
          @rename="(row) => void openRename(row)"
        >
          <template #toolbar>
            <!-- 从画布跳来时带着工作流筛选，不摆出来的话用户看不出列表被收窄了 -->
            <DtButton
              v-if="workflowId"
              size="sm"
              variant="soft"
              icon="close"
              title="清除筛选，显示全部工作流的模型版本"
              @click="void router.replace({ query: {} })"
            >
              仅当前工作流
            </DtButton>
            <ModelSearch
              label="搜索模型版本"
              :disabled="
                versionBulk.batch.isBusy.value || bindingBulk.batch.isBusy.value
              "
              @search="void searchVersions($event)"
            />
          </template>
        </VersionTable>
      </section>

      <section v-show="activeTab === 'bindings'" class="dt-ml-models__block">
        <ModelingBatchBar
          v-if="bindingBulk.selection.value"
          :selected-count="bindingBulk.batch.selectedCount.value"
          :state="bindingBulk.batch.state.value"
          scope-label="当前页公式绑定"
          @clear="bindingBulk.batch.clear"
          @stop="bindingBulk.batch.stop"
        >
          <DtButton
            size="sm"
            variant="soft"
            :disabled="
              !bindingBulk.batch.canRun.value ||
              isWriting ||
              bindings.loading.value
            "
            @click="void bindingBulk.toggle(true)"
          >
            批量启用绑定
          </DtButton>
          <DtButton
            size="sm"
            variant="soft"
            :disabled="
              !bindingBulk.batch.canRun.value ||
              isWriting ||
              bindings.loading.value
            "
            @click="void bindingBulk.toggle(false)"
          >
            批量停用绑定
          </DtButton>
          <DtButton
            size="sm"
            variant="soft"
            intent="danger"
            :disabled="
              !bindingBulk.batch.canRun.value ||
              isWriting ||
              bindings.loading.value
            "
            @click="void bindingBulk.unbind()"
          >
            批量解除绑定
          </DtButton>
        </ModelingBatchBar>
        <BindingTable
          v-model:view="bindingView"
          :selection="bindingBulk.selection.value"
          :actions-disabled="isWriting"
          :rows="bindings.items.value"
          :version-labels="versionLabels"
          :is-loading="bindings.loading.value"
          :error="bindings.error.value"
          :pagination="bindings.pager.value"
          @update:selected-ids="bindingBulk.batch.selectedIds.value = $event"
          @update:page="(page) => void bindings.goToPage(page)"
          @update:size="(size) => void bindings.setSize(size)"
          @toggle="
            (row, isOn) =>
              !isWriting && void ops.update(row.id, { is_enabled: isOn })
          "
          @unbind="(row) => !isWriting && void ops.unbind(row.id)"
        >
          <template #toolbar>
            <span v-if="workflowId" class="text-caption text-text-secondary">
              公式绑定不按工作流筛选，这里是全部工作流的
            </span>
            <ModelSearch
              label="搜索公式绑定"
              :disabled="
                versionBulk.batch.isBusy.value || bindingBulk.batch.isBusy.value
              "
              @search="void searchBindings($event)"
            />
          </template>
        </BindingTable>
      </section>
    </div>

    <VersionDetailDialog
      :version="detail"
      :is-busy="isWriting"
      @register="(code) => void register(code)"
      @close="detail = null"
    />

    <BindDialog
      :version="binding"
      :is-busy="isWriting"
      @submit="(code) => void submitBind(code)"
      @close="binding = null"
    />
    <VersionNameDialog
      :version="renaming"
      :is-busy="isWriting"
      @submit="(name, description) => void saveName(name, description)"
      @close="renaming = null"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.dt-ml-models {
  &__block {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    min-height: 0;
    overflow: hidden;

    :deep(.dt-data-view.is-fill) {
      overflow: hidden;
    }

    :deep(.dt-data-view.is-fill .dt-data-view__panel),
    :deep(.dt-data-view.is-fill .dt-data-view__grid) {
      min-height: 0;
    }
  }
}
</style>
