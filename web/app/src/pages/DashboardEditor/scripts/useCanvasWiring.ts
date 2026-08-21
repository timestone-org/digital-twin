/**
 * @fileoverview 画布组件的装配壳：把视口、拖动缩放、框选与模块库拖放接成一个出口，
 * `EditorCanvas.vue` 只剩 props/emits 与模板。共享类型与纯工厂在 `canvasWiring.ts`，
 * 指针手势在 `canvasWiringHandlers.ts`。
 */
import { computed, type ComputedRef } from 'vue'
import type { ModuleRect, NodeBox } from '@dt/runtime'

import { topMostIds } from '@/features/dashboard/editorDoc'
import type { CanvasDrag } from './canvasDrag'
import {
  buildPlacements,
  contentRectOf,
  marqueeHits,
  renderItems,
} from './canvasLayers'
import { gridBackgroundStyle } from './canvasViewport'
import {
  dropTargetAtOf,
  viewportSliceOf,
  type CanvasEmit,
  type CanvasWiring,
  type CanvasWiringProps,
  type WiringCtx,
} from './canvasWiring'
import {
  grabHandlersOf,
  menuHandlerOf,
  surfaceHandlersOf,
} from './canvasWiringHandlers'
import { useCanvasDrag } from './useCanvasDrag'
import { useCanvasViewport } from './useCanvasViewport'
import { useMarquee, type CanvasMarquee } from './useMarquee'
import { usePaletteDrop, type PaletteDrop } from './usePaletteDrop'

export type {
  CanvasEmit,
  CanvasWiring,
  CanvasWiringProps,
} from './canvasWiring'

function dragOf(ctx: WiringCtx): CanvasDrag {
  const { emit } = ctx
  return useCanvasDrag({
    scale: () => ctx.viewport.effScale.value,
    dropTargetAt: ctx.dropTargetAt,
    onChange: (nodeId, geometry, isContinuous) =>
      emit('change', nodeId, geometry, isContinuous),
    onChangeBatch: (changes, isContinuous) =>
      emit('change-batch', changes, isContinuous),
    onReparent: (nodeId, parentId, geometry) =>
      emit('drop-node', nodeId, parentId, geometry),
    onCollapse: (nodeId) => emit('select', nodeId, false),
  })
}

function marqueeOf(ctx: WiringCtx): CanvasMarquee {
  const { props, emit } = ctx
  return useMarquee({
    pointerDesign: ctx.viewport.pointerDesign,
    hitIds: (box: NodeBox) =>
      topMostIds(props.nodes, marqueeHits(ctx.placements.value, box)).slice(),
    onMarquee: (ids, additive) => emit('marquee', ids, additive),
    onClear: () => emit('select', null, false),
  })
}

function paletteOf(ctx: WiringCtx): PaletteDrop {
  const { props, emit } = ctx
  return usePaletteDrop({
    dropTargetAt: ctx.dropTargetAt,
    pointerDesign: ctx.viewport.pointerDesign,
    snap: () => props.snap,
    grid: () => props.grid,
    onAdd: (moduleType, at) => emit('add-at', moduleType, at),
  })
}

/** 拖动或拖放经过的容器：画一圈高亮提示这一松手会落进去。 */
function highlightOf(
  ctx: WiringCtx,
  drag: CanvasDrag,
  palette: PaletteDrop,
): ComputedRef<ModuleRect | null> {
  return computed(() =>
    contentRectOf(
      ctx.placements.value,
      drag.hoverContainerId.value ?? palette.containerId.value,
    ),
  )
}

export function useCanvasWiring(
  props: CanvasWiringProps,
  emit: CanvasEmit,
): CanvasWiring {
  const viewport = useCanvasViewport({
    design: () => props.design,
    zoom: () => props.zoom,
    onZoom: (zoom) => emit('update:zoom', zoom),
  })
  const placements = computed(() =>
    buildPlacements({
      nodes: props.nodes,
      frames: props.frames,
      design: props.design,
      getManifest: props.getManifest,
    }),
  )
  const ctx: WiringCtx = {
    props,
    emit,
    viewport,
    placements,
    selected: computed(() => new Set(props.selectedIds)),
    dropTargetAt: dropTargetAtOf(props, viewport, placements),
  }
  const drag = dragOf(ctx)
  const marquee = marqueeOf(ctx)
  const palette = paletteOf(ctx)
  return {
    ...viewportSliceOf(viewport),
    items: computed(() => renderItems(placements.value, props.selectedIds)),
    guides: drag.guides,
    readout: drag.readout,
    marqueeBox: marquee.box,
    highlight: highlightOf(ctx, drag, palette),
    gridStyle: computed(() =>
      gridBackgroundStyle(props.design, props.grid, props.snap),
    ),
    palette,
    ...grabHandlersOf(ctx, drag),
    ...surfaceHandlersOf(ctx, marquee),
    onMenu: menuHandlerOf(ctx),
    centerOn: (nodeId) => {
      // 图层树与右键菜单的「定位」：把节点滚进视口中央
      const frame = props.frames.find((item) => item.id === nodeId)
      if (frame !== undefined) viewport.centerOn(frame)
    },
  }
}
