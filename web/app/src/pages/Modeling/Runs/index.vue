<script setup lang="ts">
/** @fileoverview 按工作流查看训练历史结果、直接发布与清理记录。 */
import type { ModelingPipelineSummary, ModelingRunSummary } from '@dt/contracts'
import { DtIconButton, DtSelect } from '@dt/ui'
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
import { useAsyncList } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useViewMode } from '@/composables/useViewMode'
import RunTable from './components/RunTable.vue'
import { useRunOps } from '../scripts/useRunOps'

const RunResultsDialog = defineAsyncComponent(
  () => import('./components/RunResultsDialog.vue'),
)

const viewingRun = ref<ModelingRunSummary | null>(null)
const route = useRoute()
const initialId = route.query['pipeline_id']
const pipelineId = ref(typeof initialId === 'string' ? initialId : '')
const pipelines = ref<ModelingPipelineSummary[]>([])
const pipelineRead = useRacedFetch()
const view = useViewMode('modeling-runs')
const runs = useAsyncList<ModelingRunSummary>((query, signal) =>
  modeling.listModelingRuns(pipelineId.value || null, query, signal),
)
const ops = useRunOps(() => void runs.reload())
const options = computed(() => [
  { value: '', label: '全部工作流' },
  ...pipelines.value.map((row) => ({ value: row.id, label: row.name })),
])
const names = computed(
  () => new Map(pipelines.value.map((row) => [row.id, row.name])),
)
const savedModels = computed(
  () =>
    new Set(
      runs.items.value
        .filter((row) => row.published_version_id)
        .map((row) => row.id),
    ),
)
async function reload(): Promise<void> {
  await runs.reloadFromFirstPage()
}
watch(
  () => route.query['pipeline_id'],
  (value) => {
    viewingRun.value = null
    pipelineId.value = typeof value === 'string' ? value : ''
    void reload()
  },
)
onMounted(() => {
  void pipelineRead.run(() => modeling.listModelingPipelines({ size: 200 }), {
    ok: (page) => {
      pipelines.value = page.items
    },
    fail: () => {},
    settled: () => {},
  })
  void runs.reload()
})
onBeforeUnmount(pipelineRead.cancel)
</script>

<template>
  <AppShell
    title="训练记录"
    subtitle="查看每次训练的配置、结果和模型；训练成功后可直接发布"
    back-to="/modeling/pipelines"
  >
    <div class="flex h-full min-h-0 flex-col gap-3">
      <RunTable
        v-model:view="view"
        :rows="runs.items.value"
        :pipeline-names="names"
        :published-run-ids="savedModels"
        :can-publish="ops.busyId.value === ''"
        :is-loading="runs.loading.value"
        :error="runs.error.value"
        :pagination="runs.pager.value"
        @update:page="void runs.goToPage($event)"
        @update:size="void runs.setSize($event)"
        @retry="void runs.reload()"
        @detail="viewingRun = $event"
        @publish="void ops.publish($event.id)"
        @remove="void ops.remove($event)"
      >
        <template #toolbar>
          <DtSelect
            v-model="pipelineId"
            label="筛选工作流"
            class="modeling-run-filter"
            size="sm"
            :options="options"
            @update:model-value="void reload()"
          >
            <template #actions>
              <DtIconButton
                size="sm"
                variant="ghost"
                icon="refresh-cw"
                label="刷新训练状态"
                :loading="runs.loading.value"
                @click="void runs.reload()"
              />
            </template>
          </DtSelect>
        </template>
      </RunTable>
    </div>
    <RunResultsDialog
      v-if="viewingRun"
      :run="viewingRun"
      :pipeline-name="names.get(viewingRun?.pipeline_id ?? '') ?? ''"
      @close="viewingRun = null"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.modeling-run-filter {
  width: 26rem;
  max-width: 100%;
}
</style>
