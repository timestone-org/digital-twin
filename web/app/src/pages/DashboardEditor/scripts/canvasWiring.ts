/**
 * @fileoverview 画布装配的共享类型与纯工厂：props/emits 契约、装配运行态、
 * 指针落点解析与视口透传。接线壳在 `useCanvasWiring.ts`，指针手势在
 * `canvasWiringHandlers.ts`。
 */
import type { ComputedRef, CSSProperties, Ref } from 'vue'
import type { DashboardNodePayload } from '@dt/contracts'
import type {
  DesignSize,
  GetModuleManifest,
  ModuleRect,
  NodeBox,
} from '@dt/runtime'

import type {
  EditorGridConfig,
  GuideLine,
  ResizeDir,
  SnapConfig,
} from '@/features/dashboard/canvasSnap'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import type { EditorFrame } from '@/features/dashboard/editorLayout'
import type { DragReadout, DropTarget } from './canvasDrag'
import {
  dropTargetOf,
  type CanvasItem,
  type CanvasPlacement,
} from './canvasLayers'
import type { CanvasViewportView, ClientPoint } from './canvasViewport'
import type { ContextMenuOpenAt } from './useEditorContextMenu'
import type { PaletteDrop } from './usePaletteDrop'

/** 装配要读的画布 props（组件另有 cardChrome 这类纯透传项，不进装配）。 */
export interface CanvasWiringProps {
  design: DesignSize
  frames: readonly EditorFrame[]
  nodes: readonly DashboardNodePayload[]
  selectedIds: readonly string[]
  getManifest: GetModuleManifest
  snap: SnapConfig
  grid: EditorGridConfig
  zoom: CanvasZoom
}

/** 画布组件的 emits；SFC 直接用它声明，装配层拿到的就是同一份契约。 */
export interface CanvasEmit {
  (event: 'select', nodeId: string | null, additive: boolean): void
  (event: 'marquee', ids: string[], additive: boolean): void
  (
    event: 'change',
    nodeId: string,
    geometry: NodeGeometry,
    isContinuous: boolean,
  ): void
  (
    event: 'change-batch',
    changes: Map<string, NodeGeometry>,
    isContinuous: boolean,
  ): void
  (
    event: 'drop-node',
    nodeId: string,
    parentId: string | null,
    geometry: NodeGeometry,
  ): void
  (
    event: 'add-at',
    moduleType: string,
    at: { parentId: string | null; x: number; y: number },
  ): void
  (event: 'update:zoom', zoom: CanvasZoom): void
  (event: 'canvas-menu', at: ContextMenuOpenAt, nodeId: string | null): void
}

export interface CanvasWiring {
  viewportRef: Ref<HTMLElement | null>
  stageRef: Ref<HTMLElement | null>
  fitScale: ComputedRef<number>
  effScale: ComputedRef<number>
  isPanMode: ComputedRef<boolean>
  stageStyle: ComputedRef<CSSProperties>
  wrapStyle: ComputedRef<CSSProperties>
  items: ComputedRef<CanvasItem[]>
  guides: Ref<GuideLine[]>
  readout: Ref<DragReadout | null>
  marqueeBox: Ref<NodeBox | null>
  highlight: ComputedRef<ModuleRect | null>
  gridStyle: ComputedRef<CSSProperties>
  palette: PaletteDrop
  onWheel: (event: WheelEvent) => void
  onViewportDown: (event: PointerEvent) => void
  onBackgroundDown: (event: PointerEvent) => void
  onNodeGrab: (placement: CanvasPlacement, event: PointerEvent) => void
  onNodeResize: (
    placement: CanvasPlacement,
    dir: ResizeDir,
    event: PointerEvent,
  ) => void
  onMenu: (event: MouseEvent, placement: CanvasPlacement | null) => void
  centerOn: (nodeId: string) => void
}

/** 从模块库或右键落点取层时还没有拖动子树，不排除任何节点。 */
export const NO_EXCLUSION: ReadonlySet<string> = new Set<string>()

/** 装配的内部运行态：props/emit 加上各件共享的视口、落位表与落点解析。 */
export interface WiringCtx {
  props: CanvasWiringProps
  emit: CanvasEmit
  viewport: CanvasViewportView
  placements: ComputedRef<CanvasPlacement[]>
  selected: ComputedRef<ReadonlySet<string>>
  dropTargetAt: (
    at: ClientPoint,
    excluded: ReadonlySet<string>,
  ) => DropTarget | null
}

/** 指针落点 → 所在层；算不出指针坐标时为 null。 */
export function dropTargetAtOf(
  props: CanvasWiringProps,
  viewport: CanvasViewportView,
  placements: ComputedRef<CanvasPlacement[]>,
): WiringCtx['dropTargetAt'] {
  return (at, excluded) => {
    const point = viewport.pointerDesign(at)
    if (point === null) return null
    return dropTargetOf({
      placements: placements.value,
      at: point,
      excluded,
      design: props.design,
    })
  }
}

/** 视口件的原样透传。 */
export function viewportSliceOf(
  viewport: CanvasViewportView,
): Pick<
  CanvasWiring,
  | 'viewportRef'
  | 'stageRef'
  | 'fitScale'
  | 'effScale'
  | 'isPanMode'
  | 'stageStyle'
  | 'wrapStyle'
  | 'onWheel'
> {
  return {
    viewportRef: viewport.viewportRef,
    stageRef: viewport.stageRef,
    fitScale: viewport.fitScale,
    effScale: viewport.effScale,
    isPanMode: viewport.isPanMode,
    stageStyle: viewport.stageStyle,
    wrapStyle: viewport.wrapStyle,
    onWheel: viewport.onWheel,
  }
}
