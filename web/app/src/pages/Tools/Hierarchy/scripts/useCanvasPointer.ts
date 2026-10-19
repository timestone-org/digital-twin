/** @fileoverview 层级图 useCanvasPointer 的生命周期装配。 */
import type { Ref } from 'vue'
import { Controller, createState } from './canvasPointerState'
import type { HierarchyEditor } from './useHierarchyDocument'
export function useCanvasPointer(
  editor: Ref<HierarchyEditor>,
  frame: Ref<HTMLElement | null>,
  canEdit: () => boolean,
) {
  const state = createState(editor, frame, canEdit)
  const controller = new Controller(state)
  return {
    nodes: state.nodes,
    snap: state.snap,
    showGuides: state.showGuides,
    guides: state.guides,
    connection: state.connection,
    cursor: state.cursor,
    selectionBox: state.selectionBox,
    nodeDown: controller.nodeDown,
    backgroundDown: controller.backgroundDown,
    portDown: controller.portDown,
    keyPort: controller.keyPort,
    move: controller.move,
    finish: controller.finish,
    cancel: controller.cancel,
  }
}
