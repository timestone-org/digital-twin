/**
 * @fileoverview 模块库拖进画布：跟着指针记住落点所在的容器（画高亮用），
 * 松手时把模块类型与**目标层**的局部坐标交出去。
 * ⚠ 只认自定义 MIME：认 text/plain 的话，从别处拖进来的任意文本都会被当成一次添加。
 */
import { ref, type Ref } from 'vue'

import {
  snapPoint,
  type EditorGridConfig,
  type SnapConfig,
} from '@/features/dashboard/canvasSnap'
import { MODULE_DRAG_MIME } from '@/features/dashboard/moduleLibrary'
import type { DropTarget } from './canvasDrag'
import type { ClientPoint } from './canvasViewport'

/** 从模块库拖进来的节点还不在树上，落点不排除任何子树。 */
const NO_EXCLUSION: ReadonlySet<string> = new Set<string>()

export interface PaletteDropOptions {
  dropTargetAt: (
    at: ClientPoint,
    excluded: ReadonlySet<string>,
  ) => DropTarget | null
  pointerDesign: (at: ClientPoint) => { x: number; y: number } | null
  snap: () => SnapConfig
  grid: () => EditorGridConfig
  onAdd: (
    moduleType: string,
    at: { parentId: string | null; x: number; y: number },
  ) => void
}

export interface PaletteDrop {
  /** 指针底下的容器；不在容器上时为 null。 */
  containerId: Ref<string | null>
  onDragOver: (event: DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent) => void
}

export function usePaletteDrop(options: PaletteDropOptions): PaletteDrop {
  const containerId = ref<string | null>(null)

  function onDragOver(event: DragEvent): void {
    if (event.dataTransfer === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    containerId.value =
      options.dropTargetAt(event, NO_EXCLUSION)?.parentId ?? null
  }

  function onDragLeave(): void {
    containerId.value = null
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault()
    containerId.value = null
    const moduleType = event.dataTransfer?.getData(MODULE_DRAG_MIME) ?? ''
    const target = options.dropTargetAt(event, NO_EXCLUSION)
    const point = options.pointerDesign(event)
    if (moduleType === '' || target === null || point === null) return
    const at = snapPoint(point.x - target.originX, point.y - target.originY, {
      design: target.layer,
      grid: options.grid(),
      snap: options.snap(),
      free: event.altKey,
    })
    options.onAdd(moduleType, {
      parentId: target.parentId,
      x: at.x,
      y: at.y,
    })
  }

  return { containerId, onDragOver, onDragLeave, onDrop }
}
