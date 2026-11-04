<script setup lang="ts">
/**
 * @fileoverview 跨流水线的运行记录表。
 *
 * ⚠ 失败要**说出原因**：一次运行可能因为取数取不到、也可能因为某个算子的参数
 * 配错了，两者的补救办法完全不同。只标一个「失败」等于让用户去逐个节点找。
 */
import type {
  DtDataColumn,
  DtDataViewMode,
  ModelingRunSummary,
} from '@dt/contracts'
import { DtDataView } from '@dt/ui'
import type { DtDataViewSelection, DtPaginationState } from '@dt/ui'
import { RouterLink } from 'vue-router'

import RunActions from './RunActions.vue'
import RunStatus from './RunStatus.vue'
import { formatDateTime } from '@/utils/datetime'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'pipeline', label: '工作流', card: 'title' },
  { key: 'status', label: '状态', width: '7.5rem' },
  { key: 'trigger', label: '触发', width: '4.5rem' },
  { key: 'row_count', label: '取到的行数', width: '6rem', align: 'right' },
  { key: 'duration', label: '耗时', width: '5.5rem', align: 'right' },
  { key: 'created_at', label: '发起时间', width: '10rem' },
  { key: 'why', label: '失败原因' },
  {
    key: 'actions',
    label: '操作',
    width: '11rem',
    align: 'right',
    card: 'actions',
  },
]

const EMPTY = {
  title: '还没有训练记录',
  hint: '打开工作流配置数据和算子，然后点击「开始训练」或「训练并发布」。',
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: '手动',
  api: '接口',
  schedule: '定时',
}

const props = defineProps<{
  rows: readonly ModelingRunSummary[]
  pipelineNames: ReadonlyMap<string, string>
  publishedRunIds: ReadonlySet<string>
  canPublish: boolean
  isLoading: boolean
  error: string | null
  pagination?: DtPaginationState
  selection?: DtDataViewSelection<ModelingRunSummary> | undefined
}>()

const view = defineModel<DtDataViewMode>('view', { required: true })

defineEmits<{
  detail: [row: ModelingRunSummary]
  publish: [row: ModelingRunSummary]
  remove: [row: ModelingRunSummary]
  'update:page': [page: number]
  'update:size': [size: number]
  'update:selectedIds': [ids: string[]]
  retry: []
}>()

/** 耗时。还没跑完时给空，不显示成 0 秒。 */
function duration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} 毫秒`
  return `${(ms / 1000).toFixed(1)} 秒`
}
</script>

<template>
  <DtDataView
    v-model:view="view"
    :columns="COLUMNS"
    :rows="props.rows"
    :loading="props.isLoading"
    :error="props.error"
    :empty="EMPTY"
    :pagination="props.pagination"
    :selection="props.selection"
    :layout="{
      fixedLayout: true,
      minWidth: '64rem',
      cardColumns: 2,
      cardMinWidth: '24rem',
    }"
    @update:page="$emit('update:page', $event)"
    @update:size="$emit('update:size', $event)"
    @update:selected-ids="$emit('update:selectedIds', $event)"
    @retry="$emit('retry')"
  >
    <template #toolbar><slot name="toolbar" /></template>
    <template #cell-pipeline="{ row }">
      <RouterLink
        class="dt-ml-runs__link block truncate"
        :to="`/modeling/pipelines/${row.pipeline_id}?run_id=${row.id}`"
        :title="props.pipelineNames.get(row.pipeline_id) ?? row.pipeline_id"
      >
        {{ props.pipelineNames.get(row.pipeline_id) ?? row.pipeline_id }}
      </RouterLink>
    </template>
    <template #cell-status="{ row }">
      <RunStatus
        :run="row"
        :is-saved-model="props.publishedRunIds.has(row.id)"
      />
    </template>
    <template #cell-trigger="{ row }">
      {{ TRIGGER_LABELS[row.trigger] ?? row.trigger }}
    </template>
    <template #cell-row_count="{ row }">
      <span :title="row.is_source_truncated ? '取数被行数上限截断过' : ''">
        {{ row.row_count ?? '—' }}{{ row.is_source_truncated ? '+' : '' }}
      </span>
    </template>
    <template #cell-duration="{ row }">{{
      duration(row.duration_ms)
    }}</template>
    <template #cell-created_at="{ row }">
      {{ formatDateTime(row.created_at) }}
    </template>
    <template #cell-why="{ row }">
      <span class="dt-ml-runs__why" :title="row.error_text ?? ''">
        {{ row.error_text ?? '' }}
      </span>
    </template>
    <template #cell-actions="{ row }">
      <RunActions
        :run="row"
        :can-publish="props.canPublish"
        @detail="$emit('detail', $event)"
        @publish="$emit('publish', $event)"
        @remove="$emit('remove', $event)"
      />
    </template>
  </DtDataView>
</template>

<style scoped lang="scss">
.dt-ml-runs {
  &__link {
    color: var(--accent-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  &__why {
    display: block;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
