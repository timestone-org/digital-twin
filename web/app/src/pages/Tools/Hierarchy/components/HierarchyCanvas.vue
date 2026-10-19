<script setup lang="ts">
/** @fileoverview 层级图自绘编辑画布与视口工具。 */
import { computed, ref, toRef, useId } from 'vue'
import { DtButton, DtCheckbox } from '@dt/ui'
import { canvasPoint, edgePath, fitViewport } from '../scripts/canvasGeometry'
import { editorSize } from '../scripts/geometry'
import { useCanvasPointer } from '../scripts/useCanvasPointer'
import type { HierarchyEditor } from '../scripts/useHierarchyDocument'
import type { NodeKind } from '../scripts/types'
import HierarchyNode from './HierarchyNode.vue'
import HierarchyEdges from './HierarchyEdges.vue'
const props = defineProps<{ editor: HierarchyEditor; readonly: boolean }>()
const emit = defineEmits<{ save: [] }>()
const edgeMarker = useId()
const frame = ref<HTMLElement | null>(null)
const pointer = useCanvasPointer(
  toRef(props, 'editor'),
  frame,
  () => !props.readonly,
)
const { nodes, guides, selectionBox, connection, snap, showGuides } = pointer
const view = computed(
  () => props.editor.document.value?.viewport ?? { x: 0, y: 0, zoom: 1 },
)
const transform = computed(
  () =>
    `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.zoom})`,
)
const edges = computed(() => {
  const byId = new Map(nodes.value.map((node) => [node.id, node]))
  return (props.editor.document.value?.edges ?? []).flatMap((edge) => {
    const source = byId.get(edge.source),
      target = byId.get(edge.target)
    return source && target
      ? [
          {
            ...edge,
            path: edgePath(source, target),
            label: `${source.code} → ${target.code}`,
          },
        ]
      : []
  })
})
const pendingPath = computed(() => {
  const source = nodes.value.find((node) => node.id === connection.value),
    end = pointer.cursor.value
  return source && end
    ? `M${source.position.x + 104} ${source.position.y + editorSize(source).height} L${end.x} ${end.y}`
    : ''
})
function onPort(id: string, side: 'in' | 'out', event: PointerEvent) {
  pointer.portDown(id, side, event)
}
function setView(value: typeof view.value) {
  const document = props.editor.document.value
  if (document) props.editor.commit({ ...document, viewport: value }, false)
}
function zoom(factor: number, x?: number, y?: number) {
  const bounds = frame.value?.getBoundingClientRect()
  if (!bounds) return
  const atX = x ?? bounds.width / 2,
    atY = y ?? bounds.height / 2
  const scale = Math.max(0.05, Math.min(4, view.value.zoom * factor)),
    ratio = scale / view.value.zoom
  setView({
    x: atX - (atX - view.value.x) * ratio,
    y: atY - (atY - view.value.y) * ratio,
    zoom: scale,
  })
}
function wheel(event: WheelEvent) {
  const bounds = frame.value?.getBoundingClientRect()
  if (bounds)
    zoom(
      event.deltaY > 0 ? 0.9 : 1.1,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    )
}
function fit(selected = false) {
  const bounds = frame.value?.getBoundingClientRect()
  if (bounds)
    setView(
      fitViewport(
        selected
          ? nodes.value.filter((node) =>
              props.editor.selectedIds.value.includes(node.id),
            )
          : nodes.value,
        bounds.width,
        bounds.height,
      ),
    )
}
function focus(id: string) {
  const node = nodes.value.find((item) => item.id === id),
    bounds = frame.value?.getBoundingClientRect()
  if (!node || !bounds) return
  props.editor.select([id])
  setView({
    x: bounds.width / 2 - node.position.x - 104,
    y: bounds.height / 2 - node.position.y - 74,
    zoom: 1,
  })
}
function add(kind: NodeKind, event?: DragEvent) {
  const bounds = frame.value?.getBoundingClientRect()
  if (!bounds || props.readonly) return
  const point = canvasPoint(
    event ?? {
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    },
    bounds,
    view.value,
  )
  props.editor.add(kind, { x: point.x - 104, y: point.y - 74 })
}
function drop(event: DragEvent) {
  const kind = event.dataTransfer?.getData('application/hierarchy-node')
  if (kind === 'meter' || kind === 'junction') add(kind, event)
}
function typing(event: KeyboardEvent) {
  return (
    event.target instanceof HTMLElement &&
    event.target.closest('input,textarea,[contenteditable="true"]') !== null
  )
}
function keydown(event: KeyboardEvent) {
  if (typing(event)) return
  if (event.key === 'Escape') {
    pointer.cancel()
    return
  }
  if (props.readonly) return
  if (event.metaKey || event.ctrlKey) {
    const actions: Record<string, () => void> = {
      s: () => emit('save'),
      z: () => props.editor.undo(event.shiftKey),
      y: () => props.editor.undo(true),
    }
    const action = actions[event.key.toLowerCase()]
    if (action) {
      event.preventDefault()
      action()
    }
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    props.editor.remove()
    return
  }
  nudge(event)
}
function nudge(event: KeyboardEvent) {
  const amount = event.shiftKey ? 10 : 1
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-amount, 0],
    ArrowRight: [amount, 0],
    ArrowUp: [0, -amount],
    ArrowDown: [0, amount],
  }
  const direction = directions[event.key]
  if (direction) {
    event.preventDefault()
    props.editor.nudge(...direction)
  }
}
defineExpose({ fit, focus, add })
</script>
<template>
  <div
    ref="frame"
    class="hierarchy-canvas"
    tabindex="0"
    aria-label="层级图编辑画布"
    @pointerdown.self="pointer.backgroundDown"
    @pointermove="pointer.move"
    @pointerup="pointer.finish"
    @pointercancel="pointer.cancel"
    @wheel.prevent="wheel"
    @keydown="keydown"
    @dragover.prevent
    @drop.prevent="drop"
  >
    <div class="canvas-world" :style="{ transform }">
      <HierarchyEdges
        :edges="edges"
        :edge-id="editor.edgeId.value"
        :marker="edgeMarker"
        :pending="pendingPath"
        :box="selectionBox"
        @select="editor.selectEdge"
      />
      <HierarchyNode
        v-for="node in nodes"
        :key="node.id"
        :node="node"
        :selected="editor.selectedIds.value.includes(node.id)"
        :readonly="readonly"
        @down="pointer.nodeDown(node, $event)"
        @select="editor.select([node.id])"
        @port="onPort"
        @key-port="pointer.keyPort"
      />
    </div>
    <div
      v-for="guide in guides"
      :key="guide.axis"
      class="guide"
      :class="guide.axis"
      :style="
        guide.axis === 'x'
          ? { left: `${guide.value * view.zoom + view.x}px` }
          : { top: `${guide.value * view.zoom + view.y}px` }
      "
    />
    <div v-if="!nodes.length" class="canvas-empty">
      <p>添加计量节点或汇流点，然后连接上下游。</p>
      <DtButton v-if="!readonly" @click="add('meter')"> 添加计量节点 </DtButton>
    </div>
    <div class="canvas-controls" @pointerdown.stop>
      <DtCheckbox v-model="snap" label="网格吸附" />
      <DtCheckbox v-model="showGuides" label="对齐辅助线" />
      <DtButton
        size="sm"
        variant="ghost"
        aria-label="缩小画布"
        @click="zoom(0.8)"
      >
        −
      </DtButton>
      <span> {{ Math.round(view.zoom * 100) }}% </span>
      <DtButton
        size="sm"
        variant="ghost"
        aria-label="放大画布"
        @click="zoom(1.25)"
      >
        ＋
      </DtButton>
      <DtButton size="sm" variant="ghost" @click="fit()"> 适应全部 </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        :disabled="!editor.selectedIds.value.length"
        @click="fit(true)"
      >
        定位选中
      </DtButton>
    </div>
    <div class="canvas-hint">
      {{
        connection
          ? '点击目标输入端口完成连接 · Esc 取消'
          : '拖动节点 · 输出口连向输入口 · Shift 框选 / 多选 · 方向键微调'
      }}
    </div>
  </div>
</template>
<style scoped lang="scss">
.hierarchy-canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  outline: none;
  background-color: var(--surface-sunken);
  background-image: radial-gradient(var(--border-default) 1px, transparent 1px);
  background-size: 20px 20px;
}
.canvas-world {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  pointer-events: none;
}
.canvas-world :deep(.hierarchy-node) {
  pointer-events: auto;
}
.canvas-controls {
  position: absolute;
  bottom: 12px;
  right: 12px;
  display: flex;
  flex-wrap: wrap;
  max-width: calc(100% - 24px);
  white-space: nowrap;
  align-items: center;
  gap: 6px;
  background: var(--surface-panel);
  padding: 6px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  font-size: 12px;
}
.canvas-hint {
  position: absolute;
  top: 12px;
  left: 12px;
  font-size: 12px;
  color: var(--text-secondary);
  pointer-events: none;
}
.canvas-empty {
  position: absolute;
  top: 42%;
  width: 100%;
  text-align: center;
  color: var(--text-secondary);
}
.guide {
  position: absolute;
  background: var(--accent-primary);
  pointer-events: none;
}
.guide.x {
  top: 0;
  bottom: 0;
  width: 1px;
}
.guide.y {
  left: 0;
  right: 0;
  height: 1px;
}
</style>
