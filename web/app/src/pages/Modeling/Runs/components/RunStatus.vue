<script setup lang="ts">
/** @fileoverview 训练状态与该次模型的发布状态。 */
import type {
  DtIntent,
  ModelingRunStatus,
  ModelingRunSummary,
} from '@dt/contracts'
import { DtTag } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{ run: ModelingRunSummary; isSavedModel: boolean }>()
const LABELS: Record<ModelingRunStatus, string> = {
  pending: '排队中',
  running: '运行中',
  cancelling: '取消中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
}
const INTENTS: Record<ModelingRunStatus, DtIntent> = {
  pending: 'neutral',
  running: 'info',
  cancelling: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}
const publication = computed(() => {
  switch (props.run.publication_status) {
    case 'published':
      return '已发布'
    case 'pending':
      return '发布中'
    case 'failed':
      return '发布失败'
    default:
      return props.isSavedModel ? '模型已保存' : ''
  }
})
const publicationHint = computed(
  () =>
    props.run.publication_error ||
    (props.run.publication_status === 'published'
      ? '本次训练的模型曾完成发布，当前调用版本请在“已发布模型”查看。'
      : publication.value),
)
</script>

<template>
  <div class="run-status">
    <DtTag :intent="INTENTS[run.status]" size="sm">{{
      LABELS[run.status]
    }}</DtTag>
    <span
      v-if="publication"
      class="run-status__publication"
      :class="{
        'run-status__publication--pending':
          run.publication_status === 'pending',
        'run-status__publication--failed': run.publication_status === 'failed',
      }"
      :title="publicationHint"
      >{{ publication }}</span
    >
  </div>
</template>

<style scoped lang="scss">
.run-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  min-width: 0;

  &__publication {
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
    color: var(--text-secondary);
  }
  &__publication--pending {
    color: var(--state-info);
  }
  &__publication--failed {
    color: var(--state-danger);
  }
}
</style>
