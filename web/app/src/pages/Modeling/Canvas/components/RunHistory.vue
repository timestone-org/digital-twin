<script setup lang="ts">
/**
 * @fileoverview 运行历史：选一次运行回看。
 *
 * ⚠ 选中一条历史运行会把画布切成**只读**，因为那时画布上显示的是当时冻结的
 * 那份图，改它没有意义也存不回去（MODELING_DESIGN §9.2）。
 */
import type { ModelingRunStatus, ModelingRunSummary } from '@dt/contracts'
import { DtEmpty, DtTag } from '@dt/ui'

import { formatDateTime } from '@/utils/datetime'

const props = defineProps<{
  runs: readonly ModelingRunSummary[]
  currentId: string | null
}>()

const emit = defineEmits<{ pick: [runId: string] }>()

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

/** 耗时。还没跑完时给空，不显示成 0 秒。 */
function duration(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 1000) return `${ms} 毫秒`
  return `${(ms / 1000).toFixed(1)} 秒`
}
</script>

<template>
  <div class="dt-ml-runs">
    <DtEmpty
      v-if="props.runs.length === 0"
      inline
      title="还没有跑过"
      hint="摆好算子、连上线，然后点右上角的「运行」。"
    />
    <button
      v-for="run in props.runs"
      :key="run.id"
      type="button"
      class="dt-ml-runs__item"
      :class="{ 'dt-ml-runs__item--on': run.id === props.currentId }"
      @click="emit('pick', run.id)"
    >
      <span class="dt-ml-runs__head">
        <DtTag :intent="STATUS_INTENTS[run.status]" size="sm">
          {{ STATUS_LABELS[run.status] }}
        </DtTag>
        <span class="dt-ml-runs__when">
          {{ formatDateTime(run.started_at ?? run.created_at) }}
        </span>
      </span>
      <span class="dt-ml-runs__meta">
        <span v-if="run.row_count !== null">{{ run.row_count }} 行</span>
        <span v-if="duration(run.duration_ms)">
          {{ duration(run.duration_ms) }}
        </span>
        <span v-if="run.created_by_name">{{ run.created_by_name }}</span>
      </span>
      <span v-if="run.error_text" class="dt-ml-runs__error">
        {{ run.error_text }}
      </span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-runs {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;

  &__item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    text-align: left;
    cursor: pointer;

    &--on {
      border-color: var(--accent-primary);
    }
  }

  &__head {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  &__when {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__meta {
    display: flex;
    gap: 0.75rem;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__error {
    overflow: hidden;
    color: var(--state-danger);
    font-size: var(--ctl-hint-fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
