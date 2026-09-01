<script setup lang="ts">
/**
 * @fileoverview 一个已训练模型的结果视图：算法、特征列、超参。
 */
import { DtNotice, DtTag } from '@dt/ui'

import type { ModelPreview } from '../scripts/preview'

const props = defineProps<{ preview: ModelPreview }>()

const TASK_LABELS: Record<string, string> = {
  regression: '回归',
  classification: '分类',
}
</script>

<template>
  <div class="dt-ml-model">
    <DtNotice v-if="!props.preview.isFitted" intent="warning">
      这一步还没有训练出模型，下游用不了
    </DtNotice>
    <dl class="dt-ml-model__facts">
      <dt>算法</dt>
      <dd>{{ props.preview.algo }}</dd>
      <dt>任务</dt>
      <dd>{{ TASK_LABELS[props.preview.task] ?? props.preview.task }}</dd>
      <dt>目标列</dt>
      <dd>{{ props.preview.targetKey || '—' }}</dd>
      <dt>特征列</dt>
      <dd class="dt-ml-model__keys">
        <DtTag
          v-for="key in props.preview.featureKeys"
          :key="key"
          intent="neutral"
          size="sm"
          mono
        >
          {{ key }}
        </DtTag>
        <span v-if="props.preview.featureKeys.length === 0">—</span>
      </dd>
    </dl>
    <h4 class="dt-ml-model__title">超参</h4>
    <dl class="dt-ml-model__facts">
      <template v-for="[key, value] in props.preview.hyperParams" :key="key">
        <dt>{{ key }}</dt>
        <dd>{{ value }}</dd>
      </template>
    </dl>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-model {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__facts {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.375rem 0.75rem;
    margin: 0;

    dt {
      color: var(--text-secondary);
    }

    dd {
      margin: 0;
      color: var(--text-primary);
    }
  }

  &__keys {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  &__title {
    margin: 0;
    color: var(--text-title);
    font-size: var(--ctl-fs-sm);
  }
}
</style>
