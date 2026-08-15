<script setup lang="ts">
/**
 * @fileoverview 钻取面板上的一张子项卡片：图标、名字、下级条数与几行摘要读数。
 * 纯展示，读数已经在上游格式化好——卡片自己不碰实时值，免得同一份格式化写两遍。
 */
import { DtIcon } from '@dt/ui'

/** 摘要上的一行：标签加已经格式化好的读数。 */
export interface TwinHierCardRow {
  key: string
  label: string
  text: string
}

defineProps<{
  name: string
  icon: string
  /** 直接下级条数；0 = 这是一个叶子层。 */
  childCount: number
  summary: readonly TwinHierCardRow[]
}>()

const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="twin-hier-card"
    data-test="drill-card"
    @click="emit('select')"
  >
    <span class="twin-hier-card__head">
      <DtIcon :name="icon" :size="13" />
      <span class="twin-hier-card__name">{{ name }}</span>
      <span v-if="childCount > 0" class="twin-hier-card__pill">
        {{ childCount }} 项
      </span>
      <DtIcon v-else name="chevron-right" :size="12" />
    </span>
    <span v-for="row in summary" :key="row.key" class="twin-hier-card__row">
      <span class="twin-hier-card__label">{{ row.label }}</span>
      <span class="twin-hier-card__value">{{ row.text }}</span>
    </span>
  </button>
</template>

<style scoped lang="scss">
.twin-hier-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);

  &:hover {
    border-color: var(--accent-primary);
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-primary);
    font-size: 12px;
  }

  &__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__pill {
    padding: 0 6px;
    font-size: 10px;
    color: var(--text-secondary);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
  }

  &__row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  &__label {
    font-size: 11px;
    color: var(--text-secondary);
  }

  &__value {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
}
</style>
