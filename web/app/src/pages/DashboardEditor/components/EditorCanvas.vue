<script setup lang="ts">
/**
 * @fileoverview 编辑器画布：一次 `transform: scale` 把整个设计坐标系等比缩进视口，
 * 节点按 `editorLayout` 算好的绝对矩形摆上去，选中、拖动与缩放都在这里发生。
 *
 * ⚠ ResizeObserver 与拖动的 window 监听都必须在卸载时摘掉：大屏一开就是几天，
 * 漏一次就持续累积一份（拖动那部分收在 `useCanvasDrag`）。
 * ⚠ 模块内容整块 `pointer-events: none`：不关的话模块自己的按钮会吃掉 pointerdown，
 * 表现是「有些模块拖不动」，而拖不动的是哪几个取决于它们内部长什么样。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import {
  ModuleRenderer,
  computeStageGeometry,
  type DesignSize,
  type GetModuleManifest,
} from '@dt/runtime'
import { computed, onMounted, onUnmounted, ref, type CSSProperties } from 'vue'

import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import type { EditorFrame } from '@/features/dashboard/editorLayout'
import { useCanvasDrag } from '../useCanvasDrag'

const props = defineProps<{
  design: DesignSize
  frames: readonly EditorFrame[]
  nodes: readonly DashboardNodePayload[]
  selectedId: string | null
  getManifest: GetModuleManifest
}>()

const emit = defineEmits<{
  select: [nodeId: string | null]
  change: [nodeId: string, geometry: NodeGeometry, isContinuous: boolean]
}>()

const viewport = ref<HTMLElement | null>(null)
const viewportSize = ref<DesignSize>({ width: 0, height: 0 })
let observer: ResizeObserver | null = null

const stage = computed(() =>
  computeStageGeometry(viewportSize.value, props.design),
)

const drag = useCanvasDrag({
  scale: () => stage.value.scale,
  onChange: (nodeId, geometry, isContinuous) =>
    emit('change', nodeId, geometry, isContinuous),
})

const nodeById = computed(
  () => new Map(props.nodes.map((node) => [node.id, node])),
)

const stageStyle = computed<CSSProperties>(() => ({
  width: `${props.design.width}px`,
  height: `${props.design.height}px`,
  transform:
    `translate(${stage.value.offsetX}px, ${stage.value.offsetY}px) ` +
    `scale(${stage.value.scale})`,
}))

function frameStyle(frame: EditorFrame): CSSProperties {
  return {
    left: `${frame.left}px`,
    top: `${frame.top}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    zIndex: frame.depth * 100 + frame.zIndex,
  }
}

/** 设计态预览：清单声明的演示配置只铺没配过的键，不落库、不参与保存。 */
function configOf(node: DashboardNodePayload): Record<string, unknown> {
  const manifest: ModuleManifest | undefined = props.getManifest(node.moduleType)
  return { ...(manifest?.preview?.config ?? {}), ...node.configJson }
}

/** 画布上的一格：矩形与它的节点配好对，模板里不必再回查、也不必兜底。 */
const items = computed(() =>
  props.frames.flatMap((frame) => {
    const node = nodeById.value.get(frame.id)
    return node === undefined ? [] : [{ frame, node, config: configOf(node) }]
  }),
)

function geometryOf(node: DashboardNodePayload): NodeGeometry {
  return { x: node.x, y: node.y, w: node.w, h: node.h }
}

function grab(
  event: PointerEvent,
  node: DashboardNodePayload,
  mode: 'move' | 'resize',
): void {
  emit('select', node.id)
  drag.start(event, mode, node.id, geometryOf(node))
}

onMounted(() => {
  const element = viewport.value
  if (element === null) return
  observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect
    if (rect === undefined) return
    viewportSize.value = { width: rect.width, height: rect.height }
  })
  observer.observe(element)
  viewportSize.value = {
    width: element.clientWidth,
    height: element.clientHeight,
  }
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div
    ref="viewport"
    class="dt-canvas relative h-full min-h-0 w-full overflow-hidden"
    @pointerdown.self="emit('select', null)"
  >
    <div class="dt-canvas__stage absolute origin-top-left" :style="stageStyle">
      <div
        v-for="item in items"
        :key="item.frame.id"
        class="dt-canvas__node absolute"
        :class="{
          'dt-canvas__node--selected': item.frame.id === selectedId,
          'dt-canvas__node--hidden': !item.frame.isVisible,
        }"
        :style="frameStyle(item.frame)"
        @pointerdown.stop="grab($event, item.node, 'move')"
      >
        <ModuleRenderer
          class="dt-canvas__module"
          :module-type="item.node.moduleType"
          :config="item.config"
          :bindings="item.node.bindings"
          :node-id="item.node.id"
          :get-manifest="getManifest"
        />
        <button
          v-if="item.frame.id === selectedId"
          type="button"
          class="dt-canvas__handle"
          aria-label="缩放这个节点"
          @pointerdown.stop="grab($event, item.node, 'resize')"
        ></button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-canvas {
  background: var(--surface-sunken);
}

.dt-canvas__stage {
  background: var(--surface-base);
  box-shadow: 0 0 0 1px var(--border-default);
}

.dt-canvas__node {
  outline: 1px dashed transparent;
  cursor: move;
}

.dt-canvas__node:hover {
  outline-color: var(--border-hover);
}

.dt-canvas__node--selected {
  outline: 2px solid var(--accent-primary);
}

// 隐藏节点在设计态仍要看得见、点得中：不画出来就没法把它改回可见
.dt-canvas__node--hidden {
  opacity: 0.4;
  outline-color: var(--border-strong);
}

// ⚠ 见文件头：模块自己的交互会吃掉 pointerdown，整块关掉指针事件
.dt-canvas__module {
  pointer-events: none;
}

.dt-canvas__handle {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 12px;
  height: 12px;
  border: 1px solid var(--surface-base);
  border-radius: 2px;
  background: var(--accent-primary);
  cursor: nwse-resize;
}
</style>
