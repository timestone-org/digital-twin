<script setup lang="ts">
/** @fileoverview 点位替换前后值和目标点位校验结果。 */
import { computed } from 'vue'
import type { PointReplacement } from '../scripts/batchConfig'
import type { PointValidation } from '../scripts/pointBatchValidation'
const props = defineProps<{
  plan: readonly PointReplacement[]
  results: readonly PointValidation[]
}>()
const rows = computed(() =>
  props.plan.map((row) => ({
    ...row,
    validation: props.results.find((result) => result.key === row.after),
  })),
)
</script>
<template>
  <div class="flex max-h-56 flex-col gap-2 overflow-x-hidden overflow-y-auto">
    <article
      v-for="row in rows"
      :key="row.bindingId"
      class="rounded-sm border border-border-subtle p-2 text-xs"
    >
      <strong>{{ row.label }}</strong>
      <p class="break-all text-text-secondary">原：{{ row.before }}</p>
      <p class="break-all">新：{{ row.after }}</p>
      <p
        :class="
          row.validation?.valid ? 'text-state-success' : 'text-state-warning'
        "
      >
        {{ row.validation?.message ?? '待校验' }}
      </p>
    </article>
  </div>
</template>
