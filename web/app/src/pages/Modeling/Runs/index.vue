<script setup lang="ts">
/**
 * @fileoverview 跨流水线的运行记录。
 *
 * ⚠ 这一页存在的理由：一次训练跑在 worker 上，用户离开画布之后就再也找不到
 * 它了——「跑过的运行只能从画布里的历史抽屉看」是那条病症
 * （docs/MODELING_PLATFORM_DESIGN.md D20）。
 * ⚠ 点进去是**只读回看**那张图：运行记录里冻结的是当时那份图，不是流水线现在
 * 那份。拿现在这份去配当时的结果，参数与结果会对不上而两边都不报错。
 */
import type { ModelingPipelineSummary, ModelingRunSummary } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { computed, onMounted, ref, watch } from 'vue'

import * as modeling from '@/api/modeling'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'

import RunTable from './components/RunTable.vue'

// 一次取满：运行是业务级资源，量级在几百
const PAGE_SIZE = 200
// 「全部流水线」那一档。⚠ 用空串而不是 undefined：DtSelect 的值要能参与比较
const ALL = ''

const view = useViewMode('modeling-runs')
const pipelineId = ref(ALL)
const pipelines = ref<ModelingPipelineSummary[]>([])

const runs = useAsyncList<ModelingRunSummary>(
  (query) =>
    modeling.listModelingRuns(
      pipelineId.value === ALL ? null : pipelineId.value,
      query,
    ),
  PAGE_SIZE,
)

const options = computed(() => [
  { value: ALL, label: '全部流水线' },
  ...pipelines.value.map((row) => ({ value: row.id, label: row.name })),
])

/** 流水线 id → 名字。表里显示它，而不是一串 id。 */
const names = computed(
  () => new Map(pipelines.value.map((row) => [row.id, row.name])),
)

watch(pipelineId, () => {
  void runs.reload()
})

onMounted(async () => {
  const page = await modeling.listModelingPipelines({
    page: 1,
    size: PAGE_SIZE,
  })
  pipelines.value = page.items
  void runs.reload()
})
</script>

<template>
  <AppShell
    title="运行记录"
    subtitle="跨流水线 · 点进去只读回看当时那张图"
    back-to="/modeling/pipelines"
  >
    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <RunTable
        v-model:view="view"
        :rows="runs.items.value"
        :pipeline-names="names"
        :is-loading="runs.loading.value"
        :error="runs.error.value"
      >
        <template #toolbar>
          <DtSelect
            v-model="pipelineId"
            size="sm"
            :options="options"
            class="dt-ml-runs__filter"
          />
        </template>
      </RunTable>
    </div>
  </AppShell>
</template>

<style scoped lang="scss">
.dt-ml-runs {
  &__filter {
    min-width: 12rem;
  }
}
</style>
