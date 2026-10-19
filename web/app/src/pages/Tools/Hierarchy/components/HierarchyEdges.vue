<script setup lang="ts">
/** @fileoverview 编辑画布连接、箭头与选择框图层。 */
import type { GraphEdge } from '../scripts/types'
defineProps<{
  edges: (GraphEdge & { path: string; label: string })[]
  edgeId: string
  marker: string
  pending: string
  box: { x: number; y: number; width: number; height: number } | null
}>()
const emit = defineEmits<{ select: [id: string] }>()
</script>
<template>
  <svg class="connections" aria-label="上下游连接">
    <defs>
      <marker
        :id="marker"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto"
      >
        <path d="M1 1 L9 5 L1 9 Z" class="edge-arrow" />
      </marker>
    </defs>
    <g
      v-for="edge in edges"
      :key="edge.id"
      role="button"
      tabindex="0"
      :aria-label="`连接 ${edge.label}`"
      @keydown.enter.prevent.stop="emit('select', edge.id)"
      @keydown.space.prevent.stop="emit('select', edge.id)"
      @pointerdown.stop="emit('select', edge.id)"
    >
      <path :d="edge.path" class="edge-hit" />
      <path
        :d="edge.path"
        class="edge-line"
        :marker-end="`url(#${marker})`"
        :class="{ active: edgeId === edge.id }"
      />
    </g>
    <path v-if="pending" :d="pending" class="pending-line" />
    <rect v-if="box" v-bind="box" class="selection-box" />
  </svg>
</template>
<style scoped lang="scss">
.connections {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: visible;
}
.edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 20;
  cursor: pointer;
  pointer-events: stroke;
}
.edge-line {
  fill: none;
  stroke: var(--text-secondary);
  stroke-width: 1.5;
  pointer-events: none;
}
.edge-line.active {
  stroke: var(--accent-primary);
  stroke-width: 3;
}
.edge-arrow {
  fill: var(--text-secondary);
}
.pending-line {
  stroke: var(--accent-primary);
  stroke-dasharray: 5 4;
  fill: none;
}
.selection-box {
  fill: var(--surface-panel);
  stroke: var(--accent-primary);
  opacity: 0.6;
}
</style>
