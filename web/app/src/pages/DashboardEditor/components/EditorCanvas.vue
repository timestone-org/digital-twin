<script setup lang="ts">
/**
 * @fileoverview 编辑器画布：设计坐标系整块一次 `transform: scale`，节点按排版好的
 * 绝对矩形摆上去；点选、框选、拖动缩放、换父、缩放平移与模块库拖放都在这里装配，
 * 几何算术全在 `canvasDrag` / `canvasLayers` / `canvasViewport` 三个纯模块里。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { DesignSize, GetModuleManifest, NodeBox } from '@dt/runtime'
import { computed } from 'vue'

import type {
  EditorGridConfig,
  ResizeDir,
  SnapConfig,
} from '@/features/dashboard/canvasSnap'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import { topMostIds, type NodeGeometry } from '@/features/dashboard/editorDoc'
import type { EditorFrame } from '@/features/dashboard/editorLayout'
import type { DragKind, DropTarget } from '../canvasDrag'
import {
  buildPlacements,
  buildSession,
  contentRectOf,
  dropTargetOf,
  marqueeHits,
  renderItems,
  type CanvasPlacement,
} from '../canvasLayers'
import {
  gridBackgroundStyle,
  rectStyleOf,
  type ClientPoint,
} from '../canvasViewport'
import { useCanvasDrag } from '../useCanvasDrag'
import { useCanvasViewport } from '../useCanvasViewport'
import { useMarquee } from '../useMarquee'
import { usePaletteDrop } from '../usePaletteDrop'
import CanvasGuides from './CanvasGuides.vue'
import CanvasNode from './CanvasNode.vue'

const props = defineProps<{
  design: DesignSize
  frames: readonly EditorFrame[]
  nodes: readonly DashboardNodePayload[]
  selectedIds: readonly string[]
  getManifest: GetModuleManifest
  snap: SnapConfig
  grid: EditorGridConfig
  zoom: CanvasZoom
}>()

const emit = defineEmits<{
  select: [nodeId: string | null, additive: boolean]
  marquee: [ids: string[], additive: boolean]
  change: [nodeId: string, geometry: NodeGeometry, isContinuous: boolean]
  'change-batch': [changes: Map<string, NodeGeometry>, isContinuous: boolean]
  'drop-node': [nodeId: string, parentId: string | null, geometry: NodeGeometry]
  'add-at': [
    moduleType: string,
    at: { parentId: string | null; x: number; y: number },
  ]
  'update:zoom': [zoom: CanvasZoom]
  'canvas-menu': [at: { x: number; y: number }, nodeId: string | null]
}>()

const viewport = useCanvasViewport({
  design: () => props.design,
  zoom: () => props.zoom,
  onZoom: (zoom) => emit('update:zoom', zoom),
})
const { viewportRef, stageRef, fitScale, isPanMode, stageStyle, wrapStyle } =
  viewport

const placements = computed(() =>
  buildPlacements({
    nodes: props.nodes,
    frames: props.frames,
    design: props.design,
    getManifest: props.getManifest,
  }),
)
const selected = computed(() => new Set(props.selectedIds))
const items = computed(() => renderItems(placements.value, props.selectedIds))

function dropTargetAt(
  at: ClientPoint,
  excluded: ReadonlySet<string>,
): DropTarget | null {
  const point = viewport.pointerDesign(at)
  if (point === null) return null
  const placed = placements.value
  const { design } = props
  return dropTargetOf({ placements: placed, at: point, excluded, design })
}

const drag = useCanvasDrag({
  scale: () => viewport.effScale.value,
  dropTargetAt,
  onChange: (nodeId, geometry, isContinuous) =>
    emit('change', nodeId, geometry, isContinuous),
  onChangeBatch: (changes, isContinuous) =>
    emit('change-batch', changes, isContinuous),
  onReparent: (nodeId, parentId, geometry) =>
    emit('drop-node', nodeId, parentId, geometry),
  onCollapse: (nodeId) => emit('select', nodeId, false),
})
const { guides } = drag

const marquee = useMarquee({
  pointerDesign: viewport.pointerDesign,
  hitIds: (box: NodeBox) =>
    topMostIds(props.nodes, marqueeHits(placements.value, box)).slice(),
  onMarquee: (ids, additive) => emit('marquee', ids, additive),
  onClear: () => emit('select', null, false),
})
const { box: marqueeBox } = marquee

function startDrag(
  placement: CanvasPlacement,
  event: PointerEvent,
  kind: DragKind,
  dir: ResizeDir,
): void {
  const input = { placements: placements.value, placement, doc: props }
  drag.start(buildSession({ ...input, kind, dir, event }))
}

function onNodeGrab(placement: CanvasPlacement, event: PointerEvent): void {
  const nodeId = placement.node.id
  // 右键：保持既有多选（在其上唤起菜单），未选中的先单选
  if (event.button === 2) {
    if (!selected.value.has(nodeId)) emit('select', nodeId, false)
    return
  }
  if (event.button !== 0) return
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    emit('select', nodeId, true)
    return
  }
  if (!selected.value.has(nodeId)) emit('select', nodeId, false)
  // 钉位节点不许移动，点选照做
  if (placement.isPinned) return
  startDrag(placement, event, 'move', { x: 0, y: 0 })
}

function onNodeResize(
  placement: CanvasPlacement,
  dir: ResizeDir,
  event: PointerEvent,
): void {
  if (event.button !== 0) return
  startDrag(placement, event, 'resize', dir)
}

function onMenu(event: MouseEvent, placement: CanvasPlacement | null): void {
  const nodeId = placement?.node.id ?? null
  if (nodeId !== null && !selected.value.has(nodeId)) {
    emit('select', nodeId, false)
  }
  emit('canvas-menu', { x: event.clientX, y: event.clientY }, nodeId)
}

function onBackgroundDown(event: PointerEvent): void {
  if (event.button !== 0 || isPanMode.value) return
  marquee.start(event)
}

function onViewportDown(event: PointerEvent): void {
  // 平移期间不该再触发框选或拖动节点，所以在捕获阶段就拦下
  if (!viewport.startPan(event)) return
  event.preventDefault()
  event.stopPropagation()
}

const palette = usePaletteDrop({
  dropTargetAt,
  pointerDesign: viewport.pointerDesign,
  snap: () => props.snap,
  grid: () => props.grid,
  onAdd: (moduleType, at) => emit('add-at', moduleType, at),
})

/** 拖动或拖放经过的容器：画一圈高亮提示这一松手会落进去。 */
const highlight = computed(() =>
  contentRectOf(
    placements.value,
    drag.hoverContainerId.value ?? palette.containerId.value,
  ),
)

const gridStyle = computed(() =>
  gridBackgroundStyle(props.design, props.grid, props.snap),
)

/** 把某个节点滚进视口中央：图层树的「居中」用。 */
function centerOn(nodeId: string): void {
  const frame = props.frames.find((item) => item.id === nodeId)
  if (frame !== undefined) viewport.centerOn(frame)
}

// stageRef 给保存后截图用：舞台元素是设计坐标系的根
defineExpose({ centerOn, fitScale, stageRef })
</script>

<template>
  <div
    ref="viewportRef"
    class="dt-canvas"
    :class="{ 'dt-canvas--pan': isPanMode, 'dt-canvas--fit': zoom === null }"
    @wheel="viewport.onWheel"
    @pointerdown.capture="onViewportDown"
  >
    <div class="dt-canvas__wrap" :style="wrapStyle">
      <div
        ref="stageRef"
        class="dt-canvas__stage"
        :style="stageStyle"
        @dragover="palette.onDragOver"
        @dragleave="palette.onDragLeave"
        @drop="palette.onDrop"
      >
        <div
          class="dt-canvas__grid absolute inset-0"
          :style="gridStyle"
          @pointerdown.self="onBackgroundDown"
          @contextmenu.self.prevent="onMenu($event, null)"
        ></div>
        <div
          v-if="highlight !== null"
          class="dt-canvas__drop"
          :style="rectStyleOf(highlight)"
        ></div>
        <CanvasNode
          v-for="item in items"
          :key="item.placement.node.id"
          :frame="item.placement.frame"
          :node="item.placement.node"
          :get-manifest="getManifest"
          :is-selected="item.isSelected"
          :has-handles="selectedIds.length === 1"
          :pinned-edge="item.pinnedEdge"
          :z-index="item.zIndex"
          @grab="onNodeGrab(item.placement, $event)"
          @resize="(dir, event) => onNodeResize(item.placement, dir, event)"
          @menu="onMenu($event, item.placement)"
        />
        <CanvasGuides :guides="guides" :marquee="marqueeBox" :design="design" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-canvas {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--surface-sunken);
}

// 适应窗口档舞台恰好铺满视口，开滚动只会因为亚像素多出两条滚动条
.dt-canvas--fit {
  overflow: hidden;
}

.dt-canvas--pan {
  cursor: grab;
}

// 居中用 margin:auto：flex 居中在内容超出视口时会裁掉上/左边缘且滚不回去
.dt-canvas__wrap {
  position: relative;
  flex: none;
  margin: auto;
}

.dt-canvas__stage {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  background: var(--surface-base);
  box-shadow: 0 0 0 1px var(--border-default);
}

.dt-canvas__drop {
  position: absolute;
  z-index: 90;
  pointer-events: none;
  border: 1px dashed var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
}
</style>
