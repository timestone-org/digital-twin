<script setup lang="ts">
/** @fileoverview 计量节点卡片与输入输出端口。 */
import { DtButton } from '@dt/ui'
import type { GraphNode } from '../scripts/types'
const props = defineProps<{
  node: GraphNode
  selected: boolean
  readonly: boolean
}>()
const emit = defineEmits<{
  keyPort: [id: string, side: 'in' | 'out']
  down: [event: PointerEvent]
  port: [id: string, side: 'in' | 'out', event: PointerEvent]
  select: []
}>()
</script>
<template>
  <div
    class="hierarchy-node"
    :class="{ selected, junction: node.kind === 'junction' }"
    :style="{ left: `${node.position.x}px`, top: `${node.position.y}px` }"
    :data-node-id="node.id"
    role="group"
    tabindex="0"
    :aria-label="`${node.code} ${node.name}`"
    :data-selected="selected"
    @pointerdown.stop="emit('down', $event)"
    @keydown.enter.stop="emit('select')"
    @keydown.space.prevent.stop="emit('select')"
  >
    <DtButton
      v-if="!readonly"
      class="port port-in"
      variant="ghost"
      size="sm"
      :aria-label="`${props.node.code} 输入端口`"
      data-port="in"
      :data-node-id="node.id"
      @pointerdown.stop="emit('port', node.id, 'in', $event)"
      @keydown.enter.prevent.stop="emit('keyPort', node.id, 'in')"
      @keydown.space.prevent.stop="emit('keyPort', node.id, 'in')"
    >
      ●
    </DtButton>
    <div class="node-code">
      {{ node.code }}
    </div>
    <template v-if="node.kind === 'meter'">
      <div class="node-parameter">
        {{ node.parameter || '圆内下栏' }}
      </div>
      <div class="node-name">
        {{ node.name }}
      </div>
    </template>
    <span v-else class="junction-label"> 汇流点 </span>
    <DtButton
      v-if="!readonly"
      class="port port-out"
      variant="ghost"
      size="sm"
      :aria-label="`${props.node.code} 输出端口`"
      data-port="out"
      :data-node-id="node.id"
      @pointerdown.stop="emit('port', node.id, 'out', $event)"
      @keydown.enter.prevent.stop="emit('keyPort', node.id, 'out')"
      @keydown.space.prevent.stop="emit('keyPort', node.id, 'out')"
    >
      ●
    </DtButton>
  </div>
</template>
<style scoped lang="scss">
.hierarchy-node {
  position: absolute;
  width: 208px;
  height: 148px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
  color: var(--text-primary);
  cursor: move;
  user-select: none;
  text-align: center;
  box-shadow: 0 3px 10px var(--surface-sunken);
}
.selected {
  border-color: var(--accent-primary);
  outline: 2px solid var(--accent-primary);
}
.junction {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: 28px;
}
.node-code {
  padding: 12px 8px 6px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.junction .node-code {
  padding: 0;
}
.node-parameter {
  color: var(--text-secondary);
  padding: 0 8px 10px;
  min-height: 32px;
}
.node-name {
  border-top: 1px solid var(--border-subtle);
  padding: 12px;
  white-space: pre-line;
  line-height: 1.4;
  overflow: hidden;
  max-height: 62px;
}
.junction-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.port {
  position: absolute;
  left: 88px;
  min-width: 30px;
  width: 30px;
  height: 24px;
  padding: 0;
  color: var(--accent-primary);
  cursor: crosshair;
}
.port-in {
  top: -17px;
}
.port-out {
  bottom: -17px;
}
</style>
