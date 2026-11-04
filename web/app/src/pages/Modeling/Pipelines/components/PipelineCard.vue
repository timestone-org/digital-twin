<script setup lang="ts">
/** @fileoverview 工作流卡片的说明、配置摘要与底部操作区。 */
import type { ModelingPipelineSummary } from '@dt/contracts'
import { DtCard, DtTag } from '@dt/ui'
import { RouterLink } from 'vue-router'
import { formatDateTime } from '@/utils/datetime'

defineProps<{ row: ModelingPipelineSummary }>()
</script>

<template>
  <DtCard class="pipeline-card" padding="md">
    <div class="pipeline-card__body">
      <div class="pipeline-card__heading">
        <RouterLink
          class="pipeline-card__name"
          :to="`/modeling/pipelines/${row.id}`"
          :title="row.name"
          >{{ row.name }}</RouterLink
        >
        <DtTag class="pipeline-card__code" size="sm" mono :title="row.code">{{
          row.code
        }}</DtTag>
      </div>
      <p class="pipeline-card__description" :title="row.description ?? ''">
        {{ row.description || '尚未填写工作流说明' }}
      </p>
      <dl class="pipeline-card__facts">
        <div>
          <dt>算子配置</dt>
          <dd>{{ row.node_count }} 个算子</dd>
        </div>
        <div>
          <dt>引用台账</dt>
          <dd
            class="pipeline-card__sources"
            :title="row.source_table_codes.join('、')"
          >
            {{ row.source_table_codes.join('、') || '未引用台账' }}
          </dd>
        </div>
      </dl>
      <p class="pipeline-card__updated">
        最近更新 {{ formatDateTime(row.updated_at) }}
      </p>
    </div>
    <template #footer><slot name="actions" /></template>
  </DtCard>
</template>

<style scoped lang="scss">
.pipeline-card {
  display: flex;
  min-width: 0;
  height: 100%;
  flex-direction: column;

  &__body {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 1rem;
  }
  &__heading {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
  &__name {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    color: var(--text-title);
    font-size: var(--font-size-section);
    font-weight: 600;
    line-height: var(--line-height-heading);
    overflow-wrap: anywhere;
  }
  &__name:hover {
    color: var(--accent-primary);
  }
  &__code {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  &__description {
    display: -webkit-box;
    min-height: 2.8em;
    margin: 0;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    color: var(--text-secondary);
    font-size: var(--font-size-body);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  &__facts {
    display: grid;
    grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.3fr);
    gap: 1rem;
    margin: 0;
  }
  &__facts div {
    min-width: 0;
  }
  &__facts dt {
    margin-bottom: 0.375rem;
    color: var(--text-disabled);
    font-size: var(--font-size-caption);
  }
  &__facts dd {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--font-size-body);
  }
  &__sources {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow-wrap: anywhere;
  }
  &__updated {
    margin: auto 0 0;
    color: var(--text-disabled);
    font-size: var(--font-size-caption);
  }
  :deep(.dt-card__ft) {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-subtle);
  }
}
</style>
