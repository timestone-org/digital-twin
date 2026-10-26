/** @fileoverview 层级图 useHierarchyDocument 的生命周期装配。 */
import { Controller, createState } from './hierarchyDocumentState'
export function useHierarchyDocument() {
  const state = createState()
  const controller = new Controller(state)
  return {
    document: state.document,
    selectedIds: state.selectedIds,
    edgeId: state.edgeId,
    drafts: state.drafts,
    selected: state.selected,
    editing: state.editing,
    hasDrafts: state.hasDrafts,
    past: state.past,
    future: state.future,
    install: controller.install,
    commit: controller.commit,
    select: controller.select,
    selectEdge: controller.selectEdge,
    applyDrafts: controller.applyDrafts,
    patchDraft: controller.patchDraft,
    discardDrafts: controller.discardDrafts,
    add: controller.add,
    connect: controller.connect,
    remove: controller.remove,
    move: controller.move,
    align: controller.align,
    nudge: controller.nudge,
    undo: controller.undo,
  }
}
export type { NodeDraft } from './hierarchyDocumentState'
export type HierarchyEditor = ReturnType<typeof useHierarchyDocument>
