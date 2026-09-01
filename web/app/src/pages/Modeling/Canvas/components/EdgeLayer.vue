<script setup lang="ts">
/**
 * @fileoverview 画布上所有边的那一层 SVG，外加正在拉的那条橡皮筋。
 *
 * ⚠ 这一层必须 `pointer-events: none`，只给线本身开：整片 SVG 铺在节点上面，
 * 不关掉的话节点全点不中，而表象是「卡片突然没反应了」。
 */
import { computed } from 'vue'

import type { DrawnEdge } from '../scripts/useCanvasWiring'
import { curveOf } from '../scripts/useCanvasWiring'

const props = defineProps<{
  edges: readonly DrawnEdge[]
  pending: DrawnEdge | null
  selectedIds: readonly string[]
}>()

defineEmits<{
  pick: [id: string, event: PointerEvent]
}>()

const selected = computed(() => new Set(props.selectedIds))
</script>

<template>
  <svg class="dt-ml-edges" aria-hidden="true">
    <path
      v-for="edge in props.edges"
      :key="edge.id"
      class="dt-ml-edges__line"
      :class="{ 'dt-ml-edges__line--on': selected.has(edge.id) }"
      :d="curveOf(edge.from, edge.to)"
      @pointerdown="$emit('pick', edge.id, $event)"
    />
    <path
      v-if="props.pending"
      class="dt-ml-edges__line dt-ml-edges__line--pending"
      :d="curveOf(props.pending.from, props.pending.to)"
    />
  </svg>
</template>

<style scoped lang="scss">
.dt-ml-edges {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  width: 100%;
  height: 100%;
  // ⚠ 见文件头：这一层不能吃掉落在节点上的指针事件
  pointer-events: none;

  &__line {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 2;
    // 线本身要能点中，才删得掉
    pointer-events: stroke;
    cursor: pointer;

    &--on {
      stroke: var(--accent-primary);
      stroke-width: 3;
    }

    &--pending {
      stroke: var(--accent-primary);
      stroke-dasharray: 6 4;
      pointer-events: none;
    }
  }
}
</style>
