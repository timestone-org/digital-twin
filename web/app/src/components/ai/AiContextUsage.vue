<script setup lang="ts">
/** @fileoverview 助手上下文使用百分比与自动压缩状态。 */
import { computed } from 'vue'
import type { AssistantContextUsage } from '@dt/contracts'
import { DtProgress } from '@dt/ui'
import { contextUsageText } from '@/features/ai/contextUsage'

const props = defineProps<{ usage: AssistantContextUsage | null }>()

const text = computed(() => contextUsageText(props.usage))
</script>

<template>
  <div class="ai-context" :title="text.detail">
    <div class="ai-context__labels">
      <span>{{ text.label }}</span>
      <span class="ai-context__status" role="status">{{ text.status }}</span>
    </div>
    <DtProgress
      v-if="usage !== null"
      :value="usage.percent"
      :intent="usage.percent >= 80 ? 'warning' : 'primary'"
      size="sm"
      aria-label="上下文使用率"
      :aria-valuetext="text.detail"
    />
  </div>
</template>

<style scoped lang="scss">
.ai-context {
  flex-shrink: 0;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);

  &__labels {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.25rem 0.5rem;
    margin-bottom: 0.25rem;
  }

  &__status {
    color: var(--text-disabled);
  }
}
</style>
