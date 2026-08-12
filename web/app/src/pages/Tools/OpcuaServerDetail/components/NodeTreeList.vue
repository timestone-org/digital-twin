<script setup lang="ts">
/**
 * @fileoverview 地址空间的缩进树列表。
 *
 * ⚠ 「父节点不在本页」的标记不许省：那一支是被分页截断后挂到根上的，
 * 不标出来会让人以为层级本来就是平的。
 */
import type { NodeTreeItem } from '../nodeTree'
import { DtIcon, DtTag } from '@dt/ui'

defineProps<{ rows: readonly NodeTreeItem[]; selectedId: string | null }>()
const emit = defineEmits<{ select: [nodeId: string] }>()
</script>

<template>
  <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
    <li v-for="item in rows" :key="item.node.id">
      <button
        type="button"
        class="node-row"
        :class="{ 'is-active': item.node.id === selectedId }"
        :style="{ paddingLeft: `${item.depth * 1.1 + 0.5}rem` }"
        @click="emit('select', item.node.id)"
      >
        <DtIcon
          :name="item.node.node_class === 'object' ? 'layout-grid' : 'table'"
          :size="12"
        />
        <span class="truncate">{{ item.node.browse_name }}</span>
        <DtTag v-if="item.isOrphan" intent="warning" size="sm">
          父节点不在本页
        </DtTag>
      </button>
    </li>
  </ul>
</template>

<style scoped lang="scss">
.node-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  padding: 0.25rem 0.5rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--surface-hover);
  }

  &.is-active {
    background: var(--surface-active);
    color: var(--text-primary);
  }
}
</style>
