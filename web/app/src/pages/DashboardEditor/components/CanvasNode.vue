<script setup lang="ts">
/**
 * @fileoverview 画布上的一格：只读预览 + 选中框 + 拖拽面 + 8 向缩放手柄。
 * 指针的算术全在上层，本组件只把原始事件转上去。
 * ⚠ 预览整块 `pointer-events: none`：不关的话模块自己的按钮会吃掉 pointerdown，
 * 表现是「有些模块拖不动」，而拖不动的是哪几个取决于它们内部长什么样。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import { ModuleRenderer, type GetModuleManifest } from '@dt/runtime'
import { computed, type CSSProperties } from 'vue'

import type { ResizeDir } from '@/features/dashboard/canvasSnap'
import type { EditorFrame } from '@/features/dashboard/editorLayout'

const props = defineProps<{
  frame: EditorFrame
  node: DashboardNodePayload
  getManifest: GetModuleManifest
  isSelected: boolean
  /** 单选时才给手柄：多选状态下拖手柄改谁的尺寸没有定义。 */
  hasHandles: boolean
  /** 钉位节点只许动一条边：贴顶的给下边、贴底的给上边；不钉位为 null。 */
  pinnedEdge: 'top' | 'bottom' | null
  zIndex: number
}>()

const emit = defineEmits<{
  grab: [event: PointerEvent]
  resize: [dir: ResizeDir, event: PointerEvent]
  menu: [event: MouseEvent]
}>()

interface Handle {
  id: string
  dir: ResizeDir
  place: string
  cursor: string
}

const HANDLES: readonly Handle[] = [
  {
    id: 'nw',
    dir: { x: -1, y: -1 },
    place: 'left-0 top-0',
    cursor: 'nwse-resize',
  },
  {
    id: 'n',
    dir: { x: 0, y: -1 },
    place: 'left-1/2 top-0',
    cursor: 'ns-resize',
  },
  {
    id: 'ne',
    dir: { x: 1, y: -1 },
    place: 'left-full top-0',
    cursor: 'nesw-resize',
  },
  {
    id: 'e',
    dir: { x: 1, y: 0 },
    place: 'left-full top-1/2',
    cursor: 'ew-resize',
  },
  {
    id: 'se',
    dir: { x: 1, y: 1 },
    place: 'left-full top-full',
    cursor: 'nwse-resize',
  },
  {
    id: 's',
    dir: { x: 0, y: 1 },
    place: 'left-1/2 top-full',
    cursor: 'ns-resize',
  },
  {
    id: 'sw',
    dir: { x: -1, y: 1 },
    place: 'left-0 top-full',
    cursor: 'nesw-resize',
  },
  {
    id: 'w',
    dir: { x: -1, y: 0 },
    place: 'left-0 top-1/2',
    cursor: 'ew-resize',
  },
]

const handles = computed<readonly Handle[]>(() => {
  if (!props.isSelected || !props.hasHandles) return []
  if (props.pinnedEdge === null) return HANDLES
  const wanted = props.pinnedEdge === 'top' ? 1 : -1
  return HANDLES.filter(
    (handle) => handle.dir.x === 0 && handle.dir.y === wanted,
  )
})

const boxStyle = computed<CSSProperties>(() => ({
  left: `${props.frame.left}px`,
  top: `${props.frame.top}px`,
  width: `${props.frame.width}px`,
  height: `${props.frame.height}px`,
  zIndex: props.zIndex,
}))

/** 设计态预览：清单声明的演示配置只铺没配过的键，不落库、不参与保存。 */
const config = computed<Record<string, unknown>>(() => ({
  ...(props.getManifest(props.node.moduleType)?.preview?.config ?? {}),
  ...props.node.configJson,
}))
</script>

<template>
  <div
    class="dt-node absolute"
    :class="{
      'dt-node--selected': isSelected,
      'dt-node--hidden': !frame.isVisible,
      'dt-node--pinned': pinnedEdge !== null,
    }"
    :style="boxStyle"
  >
    <ModuleRenderer
      class="dt-node__module"
      :module-type="node.moduleType"
      :config="config"
      :bindings="node.bindings"
      :node-id="node.id"
      :get-manifest="getManifest"
    />
    <div
      class="dt-node__surface absolute inset-0"
      @pointerdown="emit('grab', $event)"
      @contextmenu.prevent.stop="emit('menu', $event)"
    ></div>
    <span
      v-for="handle in handles"
      :key="handle.id"
      class="dt-node__handle absolute"
      :class="handle.place"
      :style="{ cursor: handle.cursor }"
      @pointerdown.stop="emit('resize', handle.dir, $event)"
    ></span>
  </div>
</template>

<style scoped lang="scss">
.dt-node {
  outline: 1px dashed transparent;
}

.dt-node:hover {
  outline-color: var(--border-hover);
}

.dt-node--selected {
  outline: 2px solid var(--accent-primary);
}

// 隐藏节点在设计态仍要看得见、点得中：不画出来就没法把它改回可见
.dt-node--hidden {
  opacity: 0.4;
  outline-color: var(--border-strong);
}

// ⚠ 见文件头：模块自己的交互会吃掉 pointerdown，整块关掉指针事件
.dt-node__module {
  pointer-events: none;
}

.dt-node__surface {
  cursor: move;
}

// 钉位节点只能改高，拖动面不给「可移动」的暗示
.dt-node--pinned .dt-node__surface {
  cursor: default;
}

.dt-node__handle {
  z-index: 2;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  margin-top: -5px;
  border: 1px solid var(--accent-primary);
  border-radius: 2px;
  background: var(--surface-base);
}
</style>
