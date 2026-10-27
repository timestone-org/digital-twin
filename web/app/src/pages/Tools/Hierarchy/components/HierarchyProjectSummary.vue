<script setup lang="ts">
/** @fileoverview 项目卡片与表格共用的名称、节点数量和版本摘要。 */
import type { HierarchySummary } from '@dt/contracts'

withDefaults(
  defineProps<{
    project: HierarchySummary
    part?: 'all' | 'title' | 'meta'
  }>(),
  { part: 'all' },
)
</script>

<template>
  <span
    class="project-summary"
    :class="{ 'project-summary--table': part === 'meta' }"
  >
    <span v-if="part !== 'meta'" class="project-summary__title">{{
      project.title
    }}</span>
    <span v-if="part === 'all'" class="project-summary__meta"
      >{{ project.node_count }} 个 · v{{ project.revision }}</span
    >
    <template v-else-if="part === 'meta'">
      <span class="project-summary__count">{{ project.node_count }} 个</span>
      <span class="project-summary__revision">v{{ project.revision }}</span>
    </template>
  </span>
</template>

<style scoped lang="scss">
.project-summary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  line-height: 1.5;
}
.project-summary__title {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--project-title-color, var(--accent-on-surface));
}
.project-summary--table {
  align-items: flex-start;
  gap: 3px;
  font-variant-numeric: tabular-nums;
}
.project-summary__count {
  font-size: 12px;
  color: var(--text-primary);
}
.project-summary__revision {
  max-width: 100%;
  overflow: hidden;
  padding: 0 5px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  text-overflow: ellipsis;
}
.project-summary__meta {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}
</style>
