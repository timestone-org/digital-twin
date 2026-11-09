<script setup lang="ts">
/** @fileoverview 有序列的优先级列表与上下移动操作。 */
const props = defineProps<{
  items: readonly { key: string; name: string }[]
  isReadonly: boolean
}>()
const emit = defineEmits<{ move: [key: string, direction: number] }>()
</script>
<template>
  <div class="dt-ml-cols__priority">
    <p class="dt-ml-cols__note">排序优先级（从上到下）</p>
    <ol aria-label="排序优先级">
      <li v-for="(column, index) in props.items" :key="column.key">
        <span>{{ index + 1 }}. {{ column.name }}</span>
        <div>
          <button
            type="button"
            class="dt-ml-cols__act"
            :aria-label="`上移 ${column.name}`"
            :disabled="props.isReadonly || index === 0"
            @click="emit('move', column.key, -1)"
          >
            上移
          </button>
          <button
            type="button"
            class="dt-ml-cols__act"
            :aria-label="`下移 ${column.name}`"
            :disabled="props.isReadonly || index === props.items.length - 1"
            @click="emit('move', column.key, 1)"
          >
            下移
          </button>
        </div>
      </li>
    </ol>
  </div>
</template>
<style scoped lang="scss">
.dt-ml-cols {
  &__act {
    height: var(--ctl-h-sm);
    padding: 0 0.5rem;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__priority {
    margin-top: 0.5rem;
    ol {
      display: grid;
      gap: 0.25rem;
      list-style: none;
      margin: 0.25rem 0 0;
      padding: 0;
      max-height: 12rem;
      overflow-y: auto;
    }
    li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.25rem 0;
    }
    li > span {
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: var(--font-size-compact);
    }
    li > div {
      display: flex;
      flex-shrink: 0;
      gap: 0.25rem;
    }
  }

  &__note {
    margin: 0.25rem 0 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
