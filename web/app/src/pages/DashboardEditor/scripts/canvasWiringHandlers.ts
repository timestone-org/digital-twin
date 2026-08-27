/**
 * @fileoverview 画布指针手势的纯工厂：节点抓取/8 向缩放起手、空白框选与平移、
 * 右键菜单（含空白处的粘贴落点换算）。共享类型在 `canvasWiring.ts`。
 */
import type { ResizeDir } from '@/features/dashboard/canvasSnap'
import type { CanvasDrag, DragKind } from './canvasDrag'
import { buildSession, type CanvasPlacement } from './canvasLayers'
import { NO_EXCLUSION, type CanvasWiring, type WiringCtx } from './canvasWiring'
import type { PastePoint } from './editorArrange'
import type { CanvasMarquee } from './useMarquee'

/** 节点上的两种起手：点选/多选/右键让位，以及 8 向缩放。 */
export function grabHandlersOf(
  ctx: WiringCtx,
  drag: CanvasDrag,
): Pick<CanvasWiring, 'onNodeGrab' | 'onNodeResize'> {
  const { props, emit } = ctx

  function startDrag(
    placement: CanvasPlacement,
    event: PointerEvent,
    kind: DragKind,
    dir: ResizeDir,
  ): void {
    const placements = ctx.placements.value
    drag.start(
      buildSession({ placements, placement, doc: props, kind, dir, event }),
    )
  }

  return {
    onNodeGrab: (placement, event) => {
      const nodeId = placement.node.id
      // 右键：保持既有多选（在其上唤起菜单），未选中的先单选
      if (event.button === 2) {
        if (!ctx.selected.value.has(nodeId)) emit('select', nodeId, false)
        return
      }
      if (event.button !== 0) return
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        emit('select', nodeId, true)
        return
      }
      if (!ctx.selected.value.has(nodeId)) emit('select', nodeId, false)
      // 钉位节点不许移动，点选照做
      if (placement.pinnedEdge !== null) return
      startDrag(placement, event, 'move', { x: 0, y: 0 })
    },
    onNodeResize: (placement, dir, event) => {
      if (event.button !== 0) return
      startDrag(placement, event, 'resize', dir)
    },
  }
}

/** 空白与视口的两种起手：框选，以及空格/中键平移（捕获阶段拦下）。 */
export function surfaceHandlersOf(
  ctx: WiringCtx,
  marquee: CanvasMarquee,
): Pick<CanvasWiring, 'onBackgroundDown' | 'onViewportDown'> {
  return {
    onBackgroundDown: (event) => {
      if (event.button !== 0 || ctx.viewport.isPanMode.value) return
      marquee.start(event)
    },
    onViewportDown: (event) => {
      // 平移期间不该再触发框选或拖动节点，所以在捕获阶段就拦下
      if (!ctx.viewport.startPan(event)) return
      event.preventDefault()
      event.stopPropagation()
    },
  }
}

/** 空白处右键的粘贴落点：命中层与该层局部坐标；换算不出来给 null。 */
function pasteAtOf(ctx: WiringCtx, event: MouseEvent): PastePoint | null {
  const target = ctx.dropTargetAt(event, NO_EXCLUSION)
  const point = ctx.viewport.pointerDesign(event)
  if (target === null || point === null) return null
  return {
    parentId: target.parentId,
    x: point.x - target.originX,
    y: point.y - target.originY,
    layer: target.layer,
  }
}

/** 右键菜单：未选中的落点节点先单选，空白处附带画布坐标系的粘贴落点。 */
export function menuHandlerOf(ctx: WiringCtx): CanvasWiring['onMenu'] {
  return (event, placement) => {
    const nodeId = placement?.node.id ?? null
    if (nodeId !== null && !ctx.selected.value.has(nodeId)) {
      ctx.emit('select', nodeId, false)
    }
    ctx.emit(
      'canvas-menu',
      {
        x: event.clientX,
        y: event.clientY,
        pasteAt: nodeId === null ? pasteAtOf(ctx, event) : null,
      },
      nodeId,
    )
  }
}
