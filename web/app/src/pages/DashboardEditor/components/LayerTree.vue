<script setup lang="ts">
/**
 * @fileoverview 图层树：按父子关系递归列出节点，管选中、显隐与删除。
 * ⚠ `v-for` 的 key 用节点 id：用索引的话，删掉中间一层会让其余行的展开态与
 * 选中态整体错位，而错位一眼看不出是错的。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { DtButton, DtIcon } from '@dt/ui'
import { computed } from 'vue'

defineOptions({ name: 'LayerTree' })

const props = defineProps<{
  nodes: readonly DashboardNodePayload[]
  parentId: string | null
  selectedId: string | null
  getManifest: (moduleType: string) => ModuleManifest | undefined
  depth?: number
}>()

const emit = defineEmits<{
  select: [nodeId: string]
  toggle: [nodeId: string, isVisible: boolean]
  remove: [nodeId: string]
}>()

/** 递归层数上限，与运行时同一个数量级；异常深的树停在这里。 */
const MAX_DEPTH = 24

const level = computed(() => props.depth ?? 0)

const children = computed(() =>
  props.nodes
    .filter((node) => node.parentId === props.parentId)
    .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id)),
)

function titleOf(node: DashboardNodePayload): string {
  return props.getManifest(node.moduleType)?.displayName ?? node.moduleType
}

function iconOf(node: DashboardNodePayload): string {
  return props.getManifest(node.moduleType)?.icon ?? 'layout-grid'
}
</script>

<template>
  <ul class="m-0 list-none p-0">
    <li v-for="node in children" :key="node.id">
      <div
        class="dt-layer__row"
        :class="{ 'dt-layer__row--on': node.id === selectedId }"
        :style="{ paddingLeft: `${level * 12 + 6}px` }"
        @click="emit('select', node.id)"
      >
        <DtIcon :name="iconOf(node)" :size="14" />
        <span class="flex-1 truncate">{{ titleOf(node) }}</span>
        <DtButton
          size="sm"
          variant="ghost"
          :icon="node.isVisible ? 'eye' : 'eye-off'"
          :aria-label="node.isVisible ? '隐藏这个节点' : '显示这个节点'"
          @click.stop="emit('toggle', node.id, !node.isVisible)"
        />
        <DtButton
          size="sm"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这个节点"
          @click.stop="emit('remove', node.id)"
        />
      </div>
      <LayerTree
        v-if="level < MAX_DEPTH"
        :nodes="nodes"
        :parent-id="node.id"
        :selected-id="selectedId"
        :get-manifest="getManifest"
        :depth="level + 1"
        @select="emit('select', $event)"
        @toggle="(id, visible) => emit('toggle', id, visible)"
        @remove="emit('remove', $event)"
      />
    </li>
  </ul>
</template>

<style scoped lang="scss">
.dt-layer__row {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--surface-raised);
  }

  &--on {
    background: var(--surface-raised);
    color: var(--accent-on-surface);
  }
}
</style>
