<script setup lang="ts">
/** @fileoverview 点位候选行：展示身份、描述及来源，发出选择事件。 */
import { computed } from 'vue'
import type { CollectPoint, PointMatchOut } from '@dt/contracts'
import { DtTag } from '@dt/ui'
const props = defineProps<{
  point: CollectPoint | PointMatchOut
  sourceName: string
  disabled: boolean
}>()
defineEmits<{ pick: [] }>()
const source = computed(() =>
  'source_name' in props.point ? props.point.source_name : props.sourceName,
)
</script>

<template>
  <button
    type="button"
    class="dt-pick__item"
    :disabled="disabled"
    @click="$emit('pick')"
  >
    <span class="min-w-0 flex-1">
      <span class="block break-words"
        >{{ point.name
        }}<span v-if="point.unit"> · {{ point.unit }}</span></span
      >
      <span
        v-if="point.description"
        class="block text-xs text-text-secondary break-words"
        >{{ point.description }}</span
      >
    </span>
    <span v-if="source" class="dt-pick__source">{{ source }}</span>
    <DtTag
      v-if="'is_exact' in point && point.is_exact"
      size="sm"
      intent="success"
      >精确匹配</DtTag
    >
    <DtTag size="sm" intent="neutral" class="dt-pick__code">{{
      point.code
    }}</DtTag>
  </button>
</template>

<style scoped lang="scss">
.dt-pick__item {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-panel);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: var(--accent-primary);
  }
}

.dt-pick__source {
  flex-shrink: 0;
  max-width: 10rem;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}

.dt-pick__item:disabled {
  opacity: 0.6;
  cursor: wait;
}
.dt-pick__code {
  max-width: 100%;
  height: auto;
  min-height: 20px;
  overflow-wrap: anywhere;
  white-space: normal;
}
</style>
