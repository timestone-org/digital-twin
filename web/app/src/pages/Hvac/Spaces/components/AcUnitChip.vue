<script setup lang="ts">
/**
 * @fileoverview 房间容器里的一台空调。整块是个按钮：点它就是选中/取消选中，
 * 选中的那些可以一起改派到别的房间。
 * ⚠ 用 `<button>` 而不是带 click 的 div：键盘要能 Tab 到、空格能按下，
 * 读屏也要知道这是可切换的（aria-pressed）。
 */
import type { AcUnit } from '@dt/contracts'
import { DtIcon } from '@dt/ui'

const props = defineProps<{
  unit: AcUnit
  isSelected: boolean
  isSelectable: boolean
}>()

const emit = defineEmits<{ toggle: [unit: AcUnit] }>()
</script>

<template>
  <button
    type="button"
    class="ac-chip"
    :class="{ 'is-selected': props.isSelected }"
    :disabled="!props.isSelectable"
    :aria-pressed="props.isSelected"
    :title="`${props.unit.serial} · ${props.unit.name}`"
    @click="emit('toggle', props.unit)"
  >
    <DtIcon
      class="ac-chip__mark"
      :name="props.isSelected ? 'check' : 'snowflake'"
      :size="14"
    />
    <span class="ac-chip__text">
      <span class="ac-chip__serial">{{ props.unit.serial }}</span>
      <span class="ac-chip__name">{{ props.unit.name }}</span>
    </span>
  </button>
</template>

<style scoped lang="scss">
.ac-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: var(--fx-transition);

  &:hover:not(:disabled) {
    border-color: var(--border-hover);
  }

  &:focus-visible {
    outline: none;
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.18);
  }

  &:disabled {
    cursor: default;
  }

  &.is-selected {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.12);
  }

  &__mark {
    flex: none;
    color: var(--accent-primary);
  }

  &__text {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  &__serial {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__name {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
