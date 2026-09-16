<script setup lang="ts">
/** @fileoverview 部件详情的分区标题与辅助说明。 */
defineProps<{ title: string; hint: string }>()
</script>

<template>
  <header class="twin-part-section-head">
    <h3>{{ title }}</h3>
    <span v-if="hint">{{ hint }}</span>
  </header>
</template>

<style scoped lang="scss">
.twin-part-section-head {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  min-height: 44px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--tp-accent) 5%, var(--surface-panel));

  h3 {
    margin: 0;
    color: var(--text-title);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  span {
    color: var(--text-secondary);
    font-size: 11px;
  }
}
</style>
