<script setup lang="ts">
/**
 * @fileoverview 编辑器画布：设计坐标系整块一次 `transform: scale`，节点按排版好的
 * 绝对矩形摆上去。装配（视口/拖动/框选/拖放/菜单落点）在 `useCanvasWiring`，
 * 这里只剩 props/emits 与模板。
 */
import type { CardChrome, DashboardNodePayload } from '@dt/contracts'
import type { DesignSize, GetModuleManifest } from '@dt/runtime'
import { DtIcon } from '@dt/ui'

import type {
  EditorGridConfig,
  SnapConfig,
} from '@/features/dashboard/canvasSnap'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import type { EditorFrame } from '@/features/dashboard/editorLayout'
import { rectStyleOf } from '../scripts/canvasViewport'
import { useCanvasWiring, type CanvasEmit } from '../scripts/useCanvasWiring'
import CanvasGuides from './CanvasGuides.vue'
import CanvasNode from './CanvasNode.vue'

const props = defineProps<{
  design: DesignSize
  frames: readonly EditorFrame[]
  nodes: readonly DashboardNodePayload[]
  selectedIds: readonly string[]
  getManifest: GetModuleManifest
  /** 大屏级卡片外观缺省，透传给每一格；不传设计态就与运行态两套观感。 */
  cardChrome: CardChrome
  snap: SnapConfig
  grid: EditorGridConfig
  zoom: CanvasZoom
}>()

const emit = defineEmits<CanvasEmit>()

const {
  viewportRef,
  stageRef,
  fitScale,
  effScale,
  isPanMode,
  stageStyle,
  wrapStyle,
  items,
  guides,
  readout,
  marqueeBox,
  highlight,
  gridStyle,
  palette,
  onWheel,
  onViewportDown,
  onBackgroundDown,
  onNodeGrab,
  onNodeResize,
  onMenu,
  centerOn,
} = useCanvasWiring(props, emit)

// stageRef 给保存后截图用：舞台元素是设计坐标系的根
defineExpose({ centerOn, fitScale, stageRef })
</script>

<template>
  <div
    ref="viewportRef"
    class="dt-canvas"
    :class="{ 'dt-canvas--pan': isPanMode, 'dt-canvas--fit': zoom === null }"
    @wheel="onWheel"
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
          :card-chrome="cardChrome"
          :is-selected="item.isSelected"
          :has-handles="selectedIds.length === 1"
          :pinned-edge="item.pinnedEdge"
          :z-index="item.zIndex"
          @grab="onNodeGrab(item.placement, $event)"
          @resize="(dir, event) => onNodeResize(item.placement, dir, event)"
          @menu="onMenu($event, item.placement)"
        />
        <CanvasGuides
          :guides="guides"
          :marquee="marqueeBox"
          :design="design"
          :readout="readout"
          :scale="effScale"
        />
      </div>
      <!-- 空态引导挂在缩放变换之外：文字不随画布缩放，任何倍率下都可读 -->
      <div v-if="nodes.length === 0" class="dt-canvas__empty">
        <DtIcon name="layout-grid" :size="26" />
        <p class="dt-canvas__empty-title">从左侧模块库拖入模块开始搭建</p>
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

// 不吃指针：拖放、框选与右键都要照常落在底下的舞台上
.dt-canvas__empty {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
  pointer-events: none;
}

.dt-canvas__empty-title {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
