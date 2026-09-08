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
import type {
  ModelingPipelineSummary,
  ModelingRunSummary,
  ModelingVersion,
} from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'
import { DtButton, DtNotice, DtSelect, useToast } from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import * as modeling from '@/api/modeling'
import { BizError } from '@/api/client'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'

import PublishVersionDialog from './components/PublishVersionDialog.vue'
import RunTable from './components/RunTable.vue'
import { usePublishedRuns } from './scripts/usePublishedRuns'

// 一次取满：运行是业务级资源，量级在几百
const PAGE_SIZE = 200
// 「全部流水线」那一档。⚠ 用空串而不是 undefined：DtSelect 的值要能参与比较
const ALL = ''

const view = useViewMode('modeling-runs')
const pipelineId = ref(ALL)
const pipelines = ref<ModelingPipelineSummary[]>([])
const publishing = ref<ModelingRunSummary | null>(null)
const isPublishing = ref(false)
const toast = useToast()
const published = usePublishedRuns()
let isAlive = true

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

function notifyPublished(created: ModelingVersion): void {
  if (created.is_servable) {
    toast.success(
      `已发布「${created.name}」v${created.version}，可以去模型服务开通。`,
    )
    return
  }
  toast.warning(
    `版本已发布，但不能开成服务：${created.unservable_reason ?? '模型不可服务'}`,
  )
}

function wasAlreadyPublished(caught: unknown): boolean {
  return (
    caught instanceof BizError &&
    caught.code === ERROR_CODES.modelingRunAlreadyPublished
  )
}

function settleAsPublished(runId: string): void {
  published.add(runId)
  publishing.value = null
  toast.info('这次运行已经发布过模型版本，状态已刷新。')
}

async function reconcileFailedPublish(runId: string): Promise<boolean> {
  await published.reload()
  if (!isAlive || !published.runIds.value.has(runId)) return false
  settleAsPublished(runId)
  return true
}

async function publishVersion(draft: {
  name: string
  description: string | null
}): Promise<void> {
  const run = publishing.value
  if (run === null || isPublishing.value) return
  isPublishing.value = true
  try {
    const created = await modeling.publishModelingVersion({
      run_id: run.id,
      ...draft,
    })
    if (!isAlive) return
    published.add(run.id)
    publishing.value = null
    notifyPublished(created)
  } catch (caught) {
    if (!isAlive) return
    if (wasAlreadyPublished(caught)) {
      settleAsPublished(run.id)
      return
    }
    if (await reconcileFailedPublish(run.id)) return
    if (!isAlive) return
    toast.error(describeError(caught))
  } finally {
    if (isAlive) isPublishing.value = false
  }
}

watch(pipelineId, () => {
  void runs.reload()
})

onMounted(async () => {
  const page = await modeling.listModelingPipelines({
    page: 1,
    size: PAGE_SIZE,
  })
  if (!isAlive) return
  pipelines.value = page.items
  await Promise.all([runs.reload(), published.reload()])
})

onBeforeUnmount(() => {
  isAlive = false
  published.cancel()
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
      <DtNotice v-if="published.error.value" intent="warning">
        模型版本状态加载失败，暂时不能发布：{{ published.error.value }}
        <DtButton size="xs" variant="ghost" @click="void published.reload()">
          重新加载发布状态
        </DtButton>
      </DtNotice>
      <RunTable
        v-model:view="view"
        :rows="runs.items.value"
        :pipeline-names="names"
        :published-run-ids="published.runIds.value"
        :can-publish="
          !published.loading.value && published.error.value === null
        "
        :is-loading="runs.loading.value"
        :error="runs.error.value"
        @publish="publishing = $event"
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

    <PublishVersionDialog
      :run="publishing"
      :pipeline-name="
        publishing === null
          ? ''
          : (names.get(publishing.pipeline_id) ?? publishing.pipeline_id)
      "
      :is-busy="isPublishing"
      @submit="(draft) => void publishVersion(draft)"
      @close="publishing = null"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.dt-ml-runs {
  &__filter {
    min-width: 12rem;
  }
}
</style>
