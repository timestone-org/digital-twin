<script setup lang="ts">
/** @fileoverview 原生可访问折叠分区，支持受控状态与可选内容卸载。 */
import { computed, ref, useId } from 'vue'
import DtIcon from '../DtIcon/DtIcon.vue'

const props = withDefaults(
  defineProps<{
    title: string
    open?: boolean | undefined
    defaultOpen?: boolean
    unmountOnClose?: boolean
  }>(),
  { open: undefined, defaultOpen: true, unmountOnClose: false },
)
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const localOpen = ref<boolean>()
const isOpen = computed(
  () => props.open ?? localOpen.value ?? props.defaultOpen,
)
const bodyId = useId()

/** 切换受控或本地展开状态。 */
function toggle(): void {
  const next = !isOpen.value
  if (props.open === undefined) localOpen.value = next
  emit('update:open', next)
}
</script>

<template>
  <details class="dt-disclosure" :open="isOpen">
    <summary
      class="dt-disclosure__summary"
      :aria-expanded="isOpen"
      :aria-controls="bodyId"
      @click.prevent="toggle"
    >
      <span class="dt-disclosure__title"
        ><slot name="title">{{ title }}</slot></span
      >
      <DtIcon :name="isOpen ? 'chevron-down' : 'chevron-right'" :size="14" />
    </summary>
    <div
      v-if="isOpen || !unmountOnClose"
      :id="bodyId"
      class="dt-disclosure__body"
    >
      <slot />
    </div>
  </details>
</template>

<style scoped lang="scss">
.dt-disclosure {
  min-width: 0;
  border-bottom: 1px solid var(--border-subtle);

  &:last-child {
    border-bottom: 0;
  }

  &__summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    color: var(--text-secondary);
    font-size: var(--font-size-compact);
    font-weight: 500;
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    &:hover {
      color: var(--text-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: -2px;
      border-radius: var(--radius-sm);
    }
  }

  &__title {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  &__body {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 12px;
    padding: 0 12px 12px;
  }
}
</style>
