<script setup lang="ts">
/**
 * @fileoverview 模型库：已发布的版本、它们绑到哪条台账公式上，以及启停与换绑。
 * 见 docs/MODELING_DESIGN.md §6。
 *
 * 两张表各自成件（`components/`），这一页只做编排与取数。
 */
import type {
  ModelingBinding,
  ModelingVersion,
  ModelingVersionSummary,
} from '@dt/contracts'
import { useToast } from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import * as modeling from '@/api/modeling'
import { AppShell } from '@/components/layout'
import ModelingNav from '../components/ModelingNav.vue'
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

// 初始每页条数
const PAGE_SIZE = 200

const versionView = useViewMode('modeling-versions')
const bindingView = useViewMode('modeling-bindings')
const binding = ref<ModelingVersionSummary | null>(null)
// 详情要签名与指纹，列表那份没有——点开时按 id 现取一次
const detail = ref<ModelingVersion | null>(null)
const renaming = ref<ModelingVersion | null>(null)
const versionRead = useRacedFetch()
const toast = useToast()

const versions = useAsyncList<ModelingVersionSummary>(
  (query) => modeling.listModelingVersions(query),
  PAGE_SIZE,
)
const bindings = useAsyncList<ModelingBinding>(
  (query) => modeling.listModelingBindings(query),
  PAGE_SIZE,
)

function refresh(): void {
  void versions.reload()
  void bindings.reload()
}

const ops = useBindingOps(refresh)
// 版本级动作单独一组：下线与注册的对象是版本，爆炸半径也与绑定那几个不同
const versionOps = useVersionOps(refresh)

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
  if (version === null) return
  const result = await versionOps.rename(version.id, name, description)
  if (result !== null) renaming.value = null
}

async function register(fxCode: string): Promise<void> {
  const version = detail.value
  if (version === null) return
  const done = await versionOps.register(version.id, fxCode)
  if (done !== null) detail.value = null
}

async function submitBind(fxCode: string): Promise<void> {
  const version = binding.value
  if (version === null) return
  await ops.bind(fxCode, version.id)
  binding.value = null
}

onMounted(() => {
  void versions.reload()
  void bindings.reload()
})
onBeforeUnmount(versionRead.cancel)
</script>

<template>
  <AppShell
    title="模型库"
    subtitle="已发布的版本 · 绑到台账公式"
    back-to="/modeling/instances"
  >
    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div
      class="dt-ml-models flex h-full min-h-0 flex-col gap-4 overflow-hidden"
    >
      <ModelingNav />
      <section class="dt-ml-models__block">
        <VersionTable
          v-model:view="versionView"
          :rows="versions.items.value"
          :is-loading="versions.loading.value"
          :error="versions.error.value"
          :pagination="versions.pager.value"
          @update:page="(page) => void versions.goToPage(page)"
          @update:size="(size) => void versions.setSize(size)"
          @detail="(row) => void openDetail(row)"
          @bind="(row) => (binding = row)"
          @retire="(row) => void versionOps.retire(row)"
          @rename="
            (row) =>
              void readVersion(row, (version) => {
                renaming = version
              })
          "
        >
          <template #toolbar>
            <h2 class="dt-ml-models__title">模型版本</h2>
          </template>
        </VersionTable>
      </section>

      <section class="dt-ml-models__block">
        <BindingTable
          v-model:view="bindingView"
          :rows="bindings.items.value"
          :version-labels="versionLabels"
          :is-loading="bindings.loading.value"
          :error="bindings.error.value"
          :pagination="bindings.pager.value"
          @update:page="(page) => void bindings.goToPage(page)"
          @update:size="(size) => void bindings.setSize(size)"
          @toggle="(row, isOn) => void ops.update(row.id, { is_enabled: isOn })"
          @unbind="(row) => void ops.unbind(row.id)"
        >
          <template #toolbar>
            <h2 class="dt-ml-models__title">公式绑定</h2>
          </template>
        </BindingTable>
      </section>
    </div>

    <VersionDetailDialog
      :version="detail"
      :is-busy="versionOps.isBusy.value"
      @register="(code) => void register(code)"
      @close="detail = null"
    />

    <BindDialog
      :version="binding"
      :is-busy="ops.isBusy.value"
      @submit="(code) => void submitBind(code)"
      @close="binding = null"
    />
    <VersionNameDialog
      :version="renaming"
      :is-busy="versionOps.isBusy.value"
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

  &__title {
    margin: 0;
    color: var(--text-title);
    font-size: var(--ctl-fs-md);
  }
}
</style>
