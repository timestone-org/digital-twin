<script setup lang="ts">
/**
 * @fileoverview 模型库：已发布的版本、它们绑到哪条台账公式上，以及启停与换绑。
 * 见 docs/MODELING_DESIGN.md §6。
 *
 * 两张表各自成件（`components/`），这一页只做编排与取数。
 */
import type { ModelingBinding, ModelingVersionSummary } from '@dt/contracts'
import { computed, onMounted, ref } from 'vue'

import * as modeling from '@/api/modeling'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'

import BindDialog from './components/BindDialog.vue'
import BindingTable from './components/BindingTable.vue'
import VersionTable from './components/VersionTable.vue'
import { useBindingOps } from './scripts/useBindingOps'

// 后端 size 的上限。版本与绑定都是业务级资源，一次取满即可
const PAGE_SIZE = 200

const versionView = useViewMode('modeling-versions')
const bindingView = useViewMode('modeling-bindings')
const binding = ref<ModelingVersionSummary | null>(null)

const versions = useAsyncList<ModelingVersionSummary>(
  (query) => modeling.listModelingVersions(query),
  PAGE_SIZE,
)
const bindings = useAsyncList<ModelingBinding>(
  (query) => modeling.listModelingBindings(query),
  PAGE_SIZE,
)

const ops = useBindingOps(() => {
  void versions.reload()
  void bindings.reload()
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
</script>

<template>
  <AppShell
    title="模型库"
    subtitle="已发布的版本 · 绑到台账公式"
    back-to="/modeling/pipelines"
  >
    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div
      class="dt-ml-models flex h-full min-h-0 flex-col gap-5 overflow-y-auto"
    >
      <section class="dt-ml-models__block">
        <h2 class="dt-ml-models__title">模型版本</h2>
        <VersionTable
          v-model:view="versionView"
          :rows="versions.items.value"
          :is-loading="versions.loading.value"
          :error="versions.error.value"
          @bind="(row) => (binding = row)"
          @retire="(row) => void ops.retire(row)"
        />
      </section>

      <section class="dt-ml-models__block">
        <h2 class="dt-ml-models__title">公式绑定</h2>
        <BindingTable
          v-model:view="bindingView"
          :rows="bindings.items.value"
          :version-labels="versionLabels"
          :is-loading="bindings.loading.value"
          :error="bindings.error.value"
          @toggle="(row, isOn) => void ops.update(row.id, { is_enabled: isOn })"
          @unbind="(row) => void ops.unbind(row.id)"
        />
      </section>
    </div>

    <BindDialog
      :version="binding"
      :is-busy="ops.isBusy.value"
      @submit="(code) => void submitBind(code)"
      @close="binding = null"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.dt-ml-models {
  &__block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  &__title {
    margin: 0;
    color: var(--text-title);
    font-size: var(--ctl-fs-md);
  }
}
</style>
