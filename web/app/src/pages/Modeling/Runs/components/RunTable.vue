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
  ModelingRunStatus,
  ModelingRunSummary,
} from '@dt/contracts'
import { DtDataView, DtTag } from '@dt/ui'
import { RouterLink } from 'vue-router'

import { formatDateTime } from '@/utils/datetime'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'pipeline', label: '流水线', card: 'title' },
  { key: 'status', label: '状态', width: '7rem' },
  { key: 'trigger', label: '触发', width: '6rem' },
  { key: 'row_count', label: '取到的行数', width: '9rem', align: 'right' },
  { key: 'duration', label: '耗时', width: '7rem', align: 'right' },
  { key: 'created_at', label: '发起时间', width: '10rem' },
  { key: 'why', label: '失败原因' },
]

const EMPTY = {
  title: '还没有跑过',
  hint: '到某条流水线的画布上摆好算子、连上线，然后点右上角的「运行」。',
}

const STATUS_LABELS: Record<ModelingRunStatus, string> = {
  pending: '排队中',
  running: '运行中',
  cancelling: '取消中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
}

const STATUS_INTENTS: Record<
  ModelingRunStatus,
  'neutral' | 'info' | 'success' | 'danger' | 'warning'
> = {
  pending: 'neutral',
  running: 'info',
  cancelling: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: '手动',
  api: '接口',
}

const props = defineProps<{
  rows: readonly ModelingRunSummary[]
  pipelineNames: ReadonlyMap<string, string>
  isLoading: boolean
  error: string | null
}>()

const view = defineModel<DtDataViewMode>('view', { required: true })

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
    :layout="{
      fixedLayout: true,
      minWidth: '72rem',
      cardColumns: 2,
      cardMinWidth: '24rem',
    }"
  >
    <template #toolbar><slot name="toolbar" /></template>
    <template #cell-pipeline="{ row }">
      <RouterLink
        class="dt-ml-runs__link"
        :to="`/modeling/pipelines/${row.pipeline_id}?run_id=${row.id}`"
      >
        {{ props.pipelineNames.get(row.pipeline_id) ?? row.pipeline_id }}
      </RouterLink>
    </template>
    <template #cell-status="{ row }">
      <DtTag :intent="STATUS_INTENTS[row.status]" size="sm">
        {{ STATUS_LABELS[row.status] }}
      </DtTag>
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
